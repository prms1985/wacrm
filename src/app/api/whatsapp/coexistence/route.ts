import { requireWhatsAppOnboarding } from '@/lib/managed/access';
import { credentialStore } from '@/lib/managed/credentials';
import { NextRequest, NextResponse } from 'next/server';
import {
  requireRole,
  toErrorResponse,
  UnauthorizedError,
  ForbiddenError,
} from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  CoexistenceError,
  coexistenceSetup,
  exchangeCoexistenceCode,
  findCoexistencePhone,
  subscribeCoexistenceWaba,
} from '@/lib/whatsapp/coexistence/meta';
import {
  createOnboardingState,
  ONBOARDING_COOKIE,
  ONBOARDING_TTL,
  verifyOnboardingState,
} from '@/lib/whatsapp/coexistence/state';
import {
  drainCoexistenceEvents,
  startCoexistenceSync,
} from '@/lib/whatsapp/coexistence/service';
import { readCappedBody } from '@/lib/whatsapp/webhook-body';

export const maxDuration = 120;

function failure(error: unknown) {
  if (error instanceof CoexistenceError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  if (error instanceof UnauthorizedError || error instanceof ForbiddenError)
    return toErrorResponse(error);
  return NextResponse.json(
    {
      error:
        'WhatsApp connection could not be completed. Refresh Settings and check your Meta configuration.',
    },
    { status: 500 }
  );
}

export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const setup = coexistenceSetup();
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('whatsapp_coexistence')
      .select(
        'phone_number_id,display_phone,connected_at,disconnected_at,history_status,contacts_status,history_progress,history_error,contacts_error,last_event_at'
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const { count } = error
      ? { count: 0 }
      : await db
          .from('whatsapp_coexistence_events')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', ctx.accountId)
          .is('processed_at', null);
    return NextResponse.json(
      {
        ready: setup.ready && !error,
        setup: {
          appId: setup.appId,
          configId: setup.configId,
          version: setup.version,
          missing: setup.missing,
        },
        migrationRequired: !!error,
        connection: data,
        pendingEvents: count ?? 0,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  let connecting = false;
  try {
    const ctx = await requireWhatsAppOnboarding();
    if (request.headers.get('origin') !== new URL(request.url).origin)
      throw new CoexistenceError(
        'Open WhatsApp Settings in AiBA to start this connection.',
        403
      );
    const limit = checkRateLimit(
      `whatsapp-coexistence:${ctx.accountId}`,
      RATE_LIMITS.whatsappAdmin
    );
    if (!limit.success) return rateLimitResponse(limit);
    const raw = await readCappedBody(request, 16000);
    if (raw === null)
      throw new CoexistenceError('Connection request is too large.', 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new CoexistenceError('Invalid connection request.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new CoexistenceError('Invalid connection request.');
    const setup = coexistenceSetup();
    if (!setup.ready)
      throw new CoexistenceError(
        'Configure Meta Embedded Signup and the webhook verification token before connecting.',
        503
      );
    if (body.action === 'start') {
      const session = createOnboardingState(ctx.accountId, ctx.userId);
      const response = NextResponse.json({ state: session.state });
      response.cookies.set(ONBOARDING_COOKIE, session.cookie, {
        httpOnly: true,
        secure: request.nextUrl.protocol === 'https:',
        sameSite: 'strict',
        maxAge: ONBOARDING_TTL,
        path: '/api/whatsapp/coexistence',
      });
      return response;
    }
    const db = supabaseAdmin();
    if (body.action === 'sync') {
      await startCoexistenceSync(db, ctx.accountId);
      return NextResponse.json({ accepted: true });
    }
    if (body.action === 'process') {
      await db
        .from('whatsapp_coexistence_events')
        .update({ attempts: 0 })
        .eq('account_id', ctx.accountId)
        .is('processed_at', null);
      return NextResponse.json(await drainCoexistenceEvents(db, ctx.accountId));
    }
    connecting = true;
    if (
      !verifyOnboardingState(
        request.cookies.get(ONBOARDING_COOKIE)?.value,
        body.state,
        ctx.accountId,
        ctx.userId
      )
    )
      throw new CoexistenceError(
        'Your connection session expired. Start Connect WhatsApp Business again.',
        403
      );
    if (
      typeof body.code !== 'string' ||
      !body.code ||
      body.code.length > 8192 ||
      typeof body.waba_id !== 'string' ||
      !/^\d+$/.test(body.waba_id) ||
      (body.phone_number_id &&
        (typeof body.phone_number_id !== 'string' ||
          !/^\d+$/.test(body.phone_number_id)))
    )
      throw new CoexistenceError(
        'Meta did not return the required account information. Start signup again.'
      );
    const token = await exchangeCoexistenceCode(body.code);
    const phone = await findCoexistencePhone(
      token,
      body.waba_id,
      body.phone_number_id
    );
    // Tokens are encrypted before the transaction; no credentials are
    // returned to the browser. The RPC enforces account/number uniqueness.
    const { error } = await db.rpc('connect_whatsapp_coexistence', {
      p_account_id: ctx.accountId,
      p_user_id: ctx.userId,
      p_phone_id: phone.id,
      p_display_phone: phone.display,
      p_waba_id: body.waba_id,
      p_access_token: encrypt(token),
      p_verify_token: encrypt(setup.verifyToken),
    });
    if (error)
      throw new CoexistenceError(
        error.code === '23505'
          ? 'This number is already connected, or your account has another number. Review the existing connection before reconnecting.'
          : 'Could not save the connection. Apply migration 066 and check database access.',
        error.code === '23505' ? 409 : 503
      );
    try {
      await subscribeCoexistenceWaba(token, body.waba_id);
    } catch (error) {
      await credentialStore()
        .from('whatsapp_config')
        .update({ status: 'disconnected', subscribed_apps_at: null })
        .eq('account_id', ctx.accountId)
        .eq('connection_mode', 'coexistence');
      await db
        .from('whatsapp_coexistence')
        .update({ disconnected_at: new Date().toISOString() })
        .eq('account_id', ctx.accountId);
      throw error;
    }
    await startCoexistenceSync(db, ctx.accountId);
    const response = NextResponse.json({ connected: true });
    response.cookies.set(ONBOARDING_COOKIE, '', {
      path: '/api/whatsapp/coexistence',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const response = failure(error);
    if (connecting)
      response.cookies.set(ONBOARDING_COOKIE, '', {
        path: '/api/whatsapp/coexistence',
        maxAge: 0,
      });
    return response;
  }
}
