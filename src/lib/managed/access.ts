import type { AccountContext } from '@/lib/auth/account';
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
} from '@/lib/auth/account';
import { createClient } from '@/lib/supabase/server';
import type { AccountRole } from '@/lib/auth/roles';
import type { ManagedCapability } from './catalog';
import { credentialStore } from './credentials';
import { throwManagedDatabaseError } from './errors';

export async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();
  const { data, error } = await supabase.rpc('is_platform_admin');
  if (error) throwManagedDatabaseError(error, 'check platform administrator');
  if (data !== true)
    throw new ForbiddenError('Platform administrator access is required');
  return { supabase, userId: user.id };
}

export async function requireManagedPermission(
  capability: ManagedCapability,
  minRole: AccountRole = 'agent'
): Promise<AccountContext> {
  const ctx = await requireRole(minRole);
  const { data, error } = await ctx.supabase.rpc('managed_user_can', {
    p_account_id: ctx.accountId,
    p_capability: capability,
  });
  if (error) throwManagedDatabaseError(error, 'verify subscription access');
  if (data !== true)
    throw new ForbiddenError(
      'Your subscription does not allow this action. Contact your service administrator.'
    );
  return ctx;
}

// Target accounts are accepted ONLY after checking the separate platform role.
// A tenant never selects another account by supplying a URL or cookie.
export async function configurationContext(
  request: Request | undefined,
  capability: ManagedCapability
): Promise<AccountContext> {
  if (request && !['GET', 'HEAD'].includes(request.method))
    assertSameOrigin(request);
  const target = request
    ? new URL(request.url).searchParams.get('account_id')
    : null;
  if (!target) {
    const ctx = await requireManagedPermission(capability, 'admin');
    return { ...ctx, supabase: credentialStore() };
  }
  const platform = await requirePlatformAdmin();
  const db = credentialStore();
  const { data: account, error } = await db
    .from('accounts')
    .select('id,name')
    .eq('id', target)
    .maybeSingle();
  if (error || !account)
    throw new ForbiddenError('Client workspace was not found');
  return {
    supabase: db,
    userId: platform.userId,
    accountId: account.id,
    role: 'owner',
    account,
  };
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    throw new ForbiddenError('Open this action from your platform');
  }
}

export async function requireWhatsAppOnboarding() {
  const ctx = await requireRole('admin');
  const [subscription, connection, platform] = await Promise.all([
    credentialStore()
      .from('managed_subscriptions')
      .select('status')
      .eq('account_id', ctx.accountId)
      .maybeSingle(),
    credentialStore()
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', ctx.accountId)
      .maybeSingle(),
    ctx.supabase.rpc('is_platform_admin'),
  ]);
  if (subscription.error || connection.error || platform.error)
    throw new Error('Could not verify onboarding access');
  if (
    subscription.data &&
    platform.data !== true &&
    !(subscription.data.status === 'pending' && !connection.data)
  )
    throw new ForbiddenError(
      'Your service team manages changes to this WhatsApp connection'
    );
  return ctx;
}
