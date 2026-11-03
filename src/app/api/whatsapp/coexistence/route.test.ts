import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOnboardingState,
  ONBOARDING_COOKIE,
} from '@/lib/whatsapp/coexistence/state';

const h = vi.hoisted(() => ({
  role: 'admin',
  signedIn: true,
  rpc: vi.fn(),
  exchange: vi.fn(),
  phone: vi.fn(),
  subscribe: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireRole: vi.fn(async () => {
      if (!h.signedIn) throw new UnauthorizedError();
      if (!['admin', 'owner'].includes(h.role)) throw new ForbiddenError();
      return { accountId: 'account-1', userId: 'user-1' };
    }),
    toErrorResponse: (e: Error) =>
      Response.json(
        { error: 'Access denied' },
        { status: e instanceof UnauthorizedError ? 401 : 403 }
      ),
  };
});
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: h.rpc }),
}));
vi.mock('@/lib/whatsapp/coexistence/service', () => ({
  startCoexistenceSync: h.sync,
  drainCoexistenceEvents: vi.fn(),
}));
vi.mock('@/lib/whatsapp/coexistence/meta', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/whatsapp/coexistence/meta')>()),
  coexistenceSetup: () => ({
    ready: true,
    appId: '123',
    configId: '456',
    secret: 'secret',
    verifyToken: 'verify',
    version: 'v24.0',
    missing: [],
  }),
  exchangeCoexistenceCode: h.exchange,
  findCoexistencePhone: h.phone,
  subscribeCoexistenceWaba: h.subscribe,
}));

import { POST } from './route';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTests();
  h.role = 'admin';
  h.signedIn = true;
  h.rpc.mockResolvedValue({ error: null });
  h.exchange.mockResolvedValue('plaintext-token');
  h.phone.mockResolvedValue({ id: '111', display: '+919999999999' });
  h.subscribe.mockResolvedValue(undefined);
  h.sync.mockResolvedValue(undefined);
});
function request(
  body: Record<string, unknown>,
  cookie?: string,
  origin = 'http://localhost'
) {
  return new NextRequest('http://localhost/api/whatsapp/coexistence', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(cookie ? { Cookie: `${ONBOARDING_COOKIE}=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
function connectRequest(overrides: Record<string, unknown> = {}) {
  const session = createOnboardingState('account-1', 'user-1');
  return request(
    {
      action: 'connect',
      code: 'code',
      state: session.state,
      waba_id: '333',
      ...overrides,
    },
    session.cookie
  );
}

describe('Coexistence onboarding route', () => {
  it('requires sign-in and administrator permissions before exchanging a token', async () => {
    h.signedIn = false;
    expect((await POST(connectRequest())).status).toBe(401);
    h.signedIn = true;
    h.role = 'agent';
    expect((await POST(connectRequest())).status).toBe(403);
    expect(h.exchange).not.toHaveBeenCalled();
  });
  it('rejects cross-origin connection attempts', async () => {
    expect(
      (
        await POST(
          request({ action: 'start' }, undefined, 'https://attacker.test')
        )
      ).status
    ).toBe(403);
  });
  it('returns an HttpOnly session cookie without exposing server credentials', async () => {
    const response = await POST(request({ action: 'start' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(['state']);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=strict');
  });
  it('rejects a forged state before calling Meta', async () => {
    const response = await POST(connectRequest({ state: 'x'.repeat(43) }));
    expect(response.status).toBe(403);
    expect(h.exchange).not.toHaveBeenCalled();
  });
  it('exchanges the code, encrypts credentials, commits the account and starts sync', async () => {
    const response = await POST(connectRequest());
    expect(response.status).toBe(200);
    const args = h.rpc.mock.calls[0][1];
    expect(args).toMatchObject({
      p_account_id: 'account-1',
      p_user_id: 'user-1',
      p_phone_id: '111',
      p_waba_id: '333',
    });
    expect(args.p_access_token).not.toBe('plaintext-token');
    expect(args.p_verify_token).not.toBe('verify');
    expect(h.subscribe).toHaveBeenCalledWith('plaintext-token', '333');
    expect(h.sync).toHaveBeenCalled();
    expect(await response.json()).toEqual({ connected: true });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  it('does not subscribe or import a number rejected by the database ownership guard', async () => {
    h.rpc.mockResolvedValue({ error: { code: '23505' } });
    expect((await POST(connectRequest())).status).toBe(409);
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.sync).not.toHaveBeenCalled();
  });
});

// Resource tests keep their original role/tenant fixtures. Managed authorization
// is covered separately by access.test.ts and database.test.ts.
vi.mock('@/lib/managed/access', async () => {
  const auth = await import('@/lib/auth/account');
  return {
    requireManagedPermission: (
      _capability: string,
      role: 'admin' | 'agent' = 'agent'
    ) => auth.requireRole(role),
    configurationContext: () => auth.requireRole('admin'),
    requireWhatsAppOnboarding: () => auth.requireRole('admin'),
  };
});
