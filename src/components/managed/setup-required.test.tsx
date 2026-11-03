import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, it, expect, vi } from 'vitest';
const h = vi.hoisted(() => ({ role: 'owner' }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountRole: h.role,
    user: { id: '20000000-0000-0000-0000-000000000001' },
  }),
}));
import { ManagedSetupRequired } from './setup-required';
beforeEach(() => {
  h.role = 'owner';
});
describe('subscription setup screen', () => {
  it('provides installation and retry actions instead of a generic server error', () => {
    const html = renderToStaticMarkup(
      <ManagedSetupRequired
        code="database_migrations_required"
        message="Database setup is required."
        retry={async () => {}}
      />
    );
    expect(html).toContain('Database setup required');
    expect(html).toContain('/api/managed/setup');
    expect(html).toContain('Check setup again');
    expect(html).not.toContain('Internal server error');
  });
  it('directs operators rather than offering installation controls to viewers', () => {
    h.role = 'viewer';
    const html = renderToStaticMarkup(
      <ManagedSetupRequired
        code="database_migrations_required"
        message="Database setup is required."
        retry={async () => {}}
      />
    );
    expect(html).toContain('Your service administrator');
    expect(html).not.toContain('/api/managed/setup');
    expect(html).not.toContain('INSERT INTO');
  });
});
