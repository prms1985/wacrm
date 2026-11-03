import { describe, it, expect, vi } from 'vitest';
import { ManagedSetupError, throwManagedDatabaseError } from './errors';
import { toErrorResponse } from '@/lib/auth/account';

describe('managed setup errors', () => {
  it.each(['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'])(
    'identifies missing schema (%s)',
    (code) => {
      try {
        throwManagedDatabaseError({ code }, 'load subscription');
      } catch (error) {
        expect(error).toMatchObject({
          code: 'database_migrations_required',
          status: 503,
        });
      }
    }
  );
  it('returns actionable setup instructions', async () => {
    const response = toErrorResponse(
      new ManagedSetupError('database_migrations_required')
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe('database_migrations_required');
    expect(body.error).toContain('065, 066, 067 and 068');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('does not turn an outage into migration instructions or expose connection details', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      throwManagedDatabaseError(
        { code: '08006', message: 'a secret connection string' },
        'read plan'
      );
    } catch (error) {
      expect(error).toMatchObject({ code: 'service_unavailable' });
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      'a secret connection string'
    );
    log.mockRestore();
  });
});
