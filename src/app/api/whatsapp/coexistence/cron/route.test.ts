import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ drain: vi.fn() }));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/whatsapp/coexistence/service', () => ({
  drainCoexistenceEvents: h.drain,
}));
import { GET } from './route';

beforeEach(() => {
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'cron-secret');
  h.drain.mockReset().mockResolvedValue({ processed: 3 });
});
afterEach(() => vi.unstubAllEnvs());
describe('Coexistence retry cron', () => {
  it('requires the configured scheduler secret', async () => {
    expect((await GET(new Request('http://localhost/cron'))).status).toBe(401);
    expect(h.drain).not.toHaveBeenCalled();
  });
  it('fails closed when no scheduler secret is configured', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '');
    expect((await GET(new Request('http://localhost/cron'))).status).toBe(503);
    expect(h.drain).not.toHaveBeenCalled();
  });
  it('drains persisted events for an authenticated scheduler', async () => {
    const response = await GET(
      new Request('http://localhost/cron', {
        headers: { 'x-cron-secret': 'cron-secret' },
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 3 });
  });
});
