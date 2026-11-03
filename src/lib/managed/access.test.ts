import { beforeEach, describe, it, expect, vi } from 'vitest';
const h = vi.hoisted(() => ({
  user: { id: 'operator' } as { id: string } | null,
  platform: false,
  allowed: false,
  rpcError: false,
  status: 'pending' as string | null,
  connected: false,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    rpc: async (name: string) => ({
      data: name === 'is_platform_admin' ? h.platform : h.allowed,
      error: h.rpcError ? { message: 'offline' } : null,
    }),
  }),
}));
vi.mock('@/lib/managed/credentials', () => ({
  credentialStore: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data:
            table === 'accounts'
              ? { id: 'target', name: 'Target client' }
              : table === 'managed_subscriptions'
                ? h.status
                  ? { status: h.status }
                  : null
                : h.connected
                  ? { id: 'connection' }
                  : null,
          error: null,
        }),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/auth/account', async () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireRole: async () => {
      if (!h.user) throw new UnauthorizedError();
      return {
        accountId: 'own',
        userId: h.user.id,
        role: 'owner',
        account: { id: 'own', name: 'Own' },
        supabase: {
          rpc: async (name: string) => ({
            data: name === 'is_platform_admin' ? h.platform : h.allowed,
            error: h.rpcError ? { message: 'offline' } : null,
          }),
        },
      };
    },
  };
});
import {
  requirePlatformAdmin,
  requireManagedPermission,
  configurationContext,
  requireWhatsAppOnboarding,
  assertSameOrigin,
} from './access';
beforeEach(() => {
  h.user = { id: 'operator' };
  h.platform = false;
  h.allowed = false;
  h.rpcError = false;
  h.status = 'pending';
  h.connected = false;
});
describe('managed request authorization', () => {
  it('rejects unauthenticated platform access', async () => {
    h.user = null;
    await expect(requirePlatformAdmin()).rejects.toThrow();
  });
  it('does not accept workspace ownership as platform access', async () => {
    await expect(
      configurationContext(
        new Request('https://crm.test/api/ai/config?account_id=target'),
        'ai.configure'
      )
    ).rejects.toThrow(/Platform administrator/);
  });
  it('authorizes the platform before resolving a target client', async () => {
    h.platform = true;
    const ctx = await configurationContext(
      new Request('https://crm.test/api/ai/config?account_id=target'),
      'ai.configure'
    );
    expect(ctx.accountId).toBe('target');
    expect(ctx.userId).toBe('operator');
  });
  it('rejects a disabled feature even for an owner', async () => {
    await expect(
      requireManagedPermission('ai.configure', 'admin')
    ).rejects.toThrow(/subscription/);
  });
  it('fails closed when permissions cannot be verified', async () => {
    h.rpcError = true;
    await expect(requireManagedPermission('inbox.reply')).rejects.toMatchObject(
      { code: 'service_unavailable', status: 503 }
    );
  });
  it('allows the first pending onboarding connection', async () => {
    expect((await requireWhatsAppOnboarding()).accountId).toBe('own');
  });
  it('requires service staff for a connection change', async () => {
    h.connected = true;
    await expect(requireWhatsAppOnboarding()).rejects.toThrow(/service team/);
  });
  it('does not permit onboarding to reconnect an active client', async () => {
    h.status = 'active';
    await expect(requireWhatsAppOnboarding()).rejects.toThrow(/service team/);
  });
  it('rejects browser requests from another origin', () => {
    expect(() =>
      assertSameOrigin(
        new Request('https://crm.test/api/admin/clients', {
          headers: { Origin: 'https://attacker.test' },
        })
      )
    ).toThrow();
  });
});
