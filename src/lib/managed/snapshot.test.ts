import { beforeEach, describe, it, expect, vi } from 'vitest';
const h = vi.hoisted(() => ({
  failures: {} as Record<string, { code: string; message?: string }>,
}));
vi.mock('./credentials', () => ({
  credentialStore: () => ({
    from: (table: string) => {
      const result = () => ({
        data:
          table === 'managed_usage' || table === 'managed_payments' ? [] : null,
        error: h.failures[table] ?? null,
        count: 0,
      });
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  }),
}));
import { managedSnapshot } from './snapshot';
beforeEach(() => {
  h.failures = {};
});
describe('subscription readiness', () => {
  it('reports missing managed tables as setup-required', async () => {
    h.failures.managed_subscriptions = { code: 'PGRST205' };
    await expect(managedSnapshot('account')).rejects.toMatchObject({
      code: 'database_migrations_required',
      status: 503,
    });
  });
  it('recognizes the pre-066 WhatsApp schema', async () => {
    h.failures.whatsapp_config = { code: '42703' };
    await expect(managedSnapshot('account')).rejects.toMatchObject({
      code: 'database_migrations_required',
    });
  });
  it('distinguishes insufficient server privileges from missing migrations', async () => {
    h.failures.managed_subscriptions = { code: '42501' };
    await expect(managedSnapshot('account')).rejects.toMatchObject({
      code: 'server_configuration_required',
    });
  });
  it('keeps a configured standalone account independent', async () => {
    const data = await managedSnapshot('account');
    expect(data.subscription).toBeNull();
    expect(data.payments).toEqual([]);
  });
});
