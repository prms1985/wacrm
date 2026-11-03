export class ManagedAccessError extends Error {
  readonly status = 403;
  readonly code = 'subscription_restricted';
}

export type ManagedSetupIssue =
  | 'database_migrations_required'
  | 'server_configuration_required'
  | 'service_unavailable';

export class ManagedSetupError extends Error {
  readonly status = 503;
  constructor(readonly code: ManagedSetupIssue) {
    super(
      code === 'database_migrations_required'
        ? 'Database setup is required. Apply migrations 065, 066, 067 and 068 in order, then retry.'
        : code === 'server_configuration_required'
          ? 'The server configuration is incomplete. Ask your administrator to check the Supabase server credentials.'
          : 'Your service plan could not be loaded. Retry or contact your platform administrator.'
    );
    this.name = 'ManagedSetupError';
  }
}

export function throwManagedDatabaseError(
  error: { code?: string; message?: string },
  operation: string
): never {
  console.error('[managed]', operation, { code: error.code ?? 'unknown' });
  if (
    ['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(
      error.code ?? ''
    )
  ) {
    throw new ManagedSetupError('database_migrations_required');
  }
  if (
    ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error.code ?? '') ||
    error.message === 'Invalid API key'
  ) {
    throw new ManagedSetupError('server_configuration_required');
  }
  throw new ManagedSetupError('service_unavailable');
}
