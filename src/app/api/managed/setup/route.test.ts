import { describe, it, expect, vi, beforeEach } from 'vitest';
const h = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/lib/auth/account', () => ({
  requireRole: async (role: string) => {
    if (!h.allowed || role !== 'admin') throw new Error('Forbidden');
    return {};
  },
  toErrorResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
import { GET } from './route';
beforeEach(() => {
  h.allowed = true;
});
describe('setup SQL download', () => {
  it('requires an administrator account without relying on missing platform functions', async () => {
    h.allowed = false;
    expect((await GET()).status).toBe(403);
  });
  it('downloads reviewable SQL without executing it or promoting the current user', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    const sql = await response.text();
    expect(sql).toContain('NOTIFY pgrst');
    expect(sql).not.toContain('INSERT INTO public.platform_users');
  });
});
