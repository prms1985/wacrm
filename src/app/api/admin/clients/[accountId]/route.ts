import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { assertSameOrigin, requirePlatformAdmin } from '@/lib/managed/access';
import { managedSnapshot } from '@/lib/managed/snapshot';
import {
  normalizeCapabilities,
  parseAmountMinor,
  SUBSCRIPTION_STATUSES,
} from '@/lib/managed/catalog';
import { credentialStore } from '@/lib/managed/credentials';
import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';
import { buildSystemPrompt } from '@/lib/ai/defaults';
import { ingestDocument, retrieveKnowledge } from '@/lib/ai/knowledge';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type Context = { params: Promise<{ accountId: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { accountId } = await params;
    const { data: account, error } = await supabase
      .from('accounts')
      .select('id,name')
      .eq('id', accountId)
      .maybeSingle();
    if (error || !account)
      return NextResponse.json(
        { error: 'Client workspace not found' },
        { status: 404 }
      );
    return NextResponse.json(
      { ...(await managedSnapshot(accountId, true)), account },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    const { supabase, userId } = await requirePlatformAdmin();
    const { accountId } = await params;
    const body = await request.json();
    const limit = checkRateLimit(
      `managed-admin:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    let result;
    switch (body.action) {
      case 'subscription': {
        if (!SUBSCRIPTION_STATUSES.includes(body.status))
          return NextResponse.json(
            { error: 'Invalid subscription status' },
            { status: 400 }
          );
        const start = new Date(body.period_start),
          end = new Date(body.period_end);
        if (
          !Number.isFinite(start.getTime()) ||
          !Number.isFinite(end.getTime())
        )
          return NextResponse.json(
            { error: 'Enter valid period dates' },
            { status: 400 }
          );
        result = await supabase.rpc('managed_subscription_admin', {
          p_account_id: accountId,
          p_plan_id: body.plan_id,
          p_industry_id: body.industry_id,
          p_status: body.status,
          p_period_start: start.toISOString(),
          p_period_end: end.toISOString(),
          p_extra: normalizeCapabilities(body.extra_capabilities ?? []),
        });
        break;
      }
      case 'business':
        result = await supabase.rpc('managed_save_business', {
          p_account_id: accountId,
          p_name: body.business_name,
          p_description: body.description ?? '',
          p_support: body.support_contact,
          p_hours: body.operating_hours ?? '',
        });
        break;
      case 'payment':
        result = await supabase.rpc('managed_record_payment', {
          p_account_id: accountId,
          p_reference: body.reference,
          p_amount: parseAmountMinor(body.amount),
          p_currency: body.currency,
        });
        break;
      case 'draft':
        result = await supabase.rpc('managed_save_ai_draft', {
          p_account_id: accountId,
          p_prompt: body.system_prompt,
          p_enabled: body.auto_reply_enabled === true,
          p_reply_limit: body.reply_limit,
          p_expected_version: body.version ?? null,
        });
        break;
      case 'publish':
        result = await supabase.rpc('managed_publish_ai', {
          p_account_id: accountId,
          p_expected_version: body.version,
        });
        break;
      case 'test': {
        if (
          typeof body.message !== 'string' ||
          !body.message.trim() ||
          body.message.length > 2000
        )
          return NextResponse.json(
            { error: 'Enter a test message, up to 2000 characters' },
            { status: 400 }
          );
        const db = credentialStore();
        const [draft, business, config] = await Promise.all([
          db
            .from('managed_ai_drafts')
            .select('system_prompt')
            .eq('account_id', accountId)
            .single(),
          db
            .from('managed_business_profiles')
            .select('business_name,description,support_contact,operating_hours')
            .eq('account_id', accountId)
            .single(),
          loadAiConfig(db, accountId, { requireActive: false }),
        ]);
        if (draft.error || business.error || !config)
          return NextResponse.json(
            {
              error:
                'Save business information, AI credentials and a draft before testing',
            },
            { status: 400 }
          );
        const reservation = await db.rpc('reserve_managed_usage', {
          p_account_id: accountId,
          p_metric: 'ai_generations',
          p_preview: true,
        });
        if (reservation.error)
          return NextResponse.json(
            { error: reservation.error.message },
            { status: 403 }
          );
        const prompt = [
          draft.data.system_prompt,
          `Business information: ${JSON.stringify(business.data)}`,
        ].join('\n');
        const knowledge = await retrieveKnowledge(
          db,
          accountId,
          config,
          body.message
        );
        const reply = await generateReply({
          config: { ...config, accountId: undefined },
          messages: [{ role: 'user', content: body.message }],
          systemPrompt: buildSystemPrompt({
            userPrompt: prompt,
            mode: 'auto_reply',
            knowledge,
          }),
        });
        return NextResponse.json({
          reply: reply.handoff
            ? 'The receptionist would transfer this enquiry to staff.'
            : reply.text,
        });
      }
      case 'knowledge': {
        if (
          typeof body.title !== 'string' ||
          !body.title.trim() ||
          body.title.length > 200 ||
          typeof body.content !== 'string' ||
          !body.content.trim() ||
          body.content.length > 100000
        )
          return NextResponse.json(
            {
              error:
                'Enter a title and knowledge content, up to 100,000 characters',
            },
            { status: 400 }
          );
        const db = credentialStore();
        const { data: subscription } = await db
          .from('managed_subscriptions')
          .select('account_id')
          .eq('account_id', accountId)
          .single();
        if (!subscription)
          return NextResponse.json(
            { error: 'Enroll this workspace first' },
            { status: 400 }
          );
        const { data: document, error } = await db
          .from('ai_knowledge_documents')
          .insert({
            account_id: accountId,
            created_by: userId,
            title: body.title.trim(),
            content: body.content,
          })
          .select('id')
          .single();
        if (error || !document)
          throw new Error('Could not save business knowledge');
        await ingestDocument(
          db,
          accountId,
          { embeddingsApiKey: null },
          document.id,
          body.content
        );
        return NextResponse.json({ success: true });
      }
      case 'delete_knowledge': {
        if (typeof body.id !== 'string')
          return NextResponse.json(
            { error: 'Choose a knowledge document' },
            { status: 400 }
          );
        const db = credentialStore();
        const { data: deleted, error } = await db
          .from('ai_knowledge_documents')
          .delete()
          .eq('account_id', accountId)
          .eq('id', body.id)
          .select('id')
          .maybeSingle();
        if (error) throw new Error('Could not remove knowledge document');
        if (!deleted)
          return NextResponse.json(
            { error: 'Document not found in this client workspace' },
            { status: 404 }
          );
        const recorded = await db
          .from('platform_audit_log')
          .insert({
            account_id: accountId,
            actor_id: userId,
            action: 'knowledge.removed',
            details: { document_id: body.id },
          });
        if (recorded.error)
          throw new Error('Document removed, but activity recording failed');
        return NextResponse.json({ success: true });
      }
      default:
        return NextResponse.json(
          { error: 'Unknown client action' },
          { status: 400 }
        );
    }
    if (result.error)
      return NextResponse.json(
        { error: result.error.message },
        { status: result.error.code === '42501' ? 403 : 400 }
      );
    return NextResponse.json({ success: true, result: result.data });
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error &&
        /Invalid capability|valid amount/.test(error.message))
    )
      return NextResponse.json({ error: error.message }, { status: 400 });
    return toErrorResponse(error);
  }
}
