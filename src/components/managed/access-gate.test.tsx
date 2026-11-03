import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedAccountData } from '@/lib/managed/types';

const h = vi.hoisted(() => ({
  path: '/agents',
  data: null as ManagedAccountData | null,
  loading: false,
  error: null as string | null,
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => h.path,
  useRouter: () => ({ replace: h.replace }),
}));
vi.mock('@/hooks/use-managed-access', () => ({
  useManagedAccess: () => ({
    data: h.data,
    loading: h.loading,
    error: h.error,
    refresh: vi.fn(),
  }),
}));
import { ManagedAccessGate } from './access-gate';

function render() {
  return renderToStaticMarkup(
    <ManagedAccessGate>
      <p>Private feature content</p>
    </ManagedAccessGate>
  );
}
function client(status = 'active') {
  h.data = {
    account: { id: 'client', name: 'Client' },
    subscription: {
      status,
      period_start: '2020-01-01T00:00:00Z',
      period_end: '2099-01-01T00:00:00Z',
    },
    capabilities: {},
    platformAdmin: false,
  } as ManagedAccountData;
}
beforeEach(() => {
  h.path = '/agents';
  h.data = null;
  h.loading = false;
  h.error = null;
});
describe('managed page guard', () => {
  it('does not mount feature content before access resolves', () => {
    h.loading = true;
    expect(render()).toContain('Checking service access');
    expect(render()).not.toContain('Private feature content');
  });
  it('offers recovery without exposing content when access cannot be verified', () => {
    h.path = '/dashboard';
    h.error = 'Service unavailable';
    const html = render();
    expect(html).toContain('Retry access check');
    expect(html).not.toContain('Private feature content');
  });
  it('keeps subscription setup errors and recovery available', () => {
    h.path = '/subscription';
    h.error = 'Setup required';
    expect(render()).toContain('Private feature content');
  });
  it('keeps pending clients out of workspace pages while redirecting', () => {
    client('pending');
    h.path = '/dashboard';
    const html = render();
    expect(html).toContain('onboarding');
    expect(html).not.toContain('Private feature content');
  });
  it('denies direct entry to managed configuration and administration', () => {
    client();
    expect(render()).toContain('managed by your service team');
    expect(render()).not.toContain('Private feature content');
    h.path = '/admin/clients';
    expect(render()).toContain('Platform administrator access required');
    expect(render()).not.toContain('Private feature content');
  });
  it('opens administration only for the explicit platform role', () => {
    client('pending');
    h.data!.platformAdmin = true;
    h.path = '/admin/clients';
    expect(render()).toContain('Private feature content');
  });
});
