'use client';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { Panel } from './shared';

export function ManagedSetupRequired({
  code,
  message,
  retry,
}: {
  code: string | null;
  message: string;
  retry: () => Promise<void>;
}) {
  const { accountRole, user } = useAuth();
  const administrator = accountRole === 'owner' || accountRole === 'admin';
  const migrations = code === 'database_migrations_required';
  const title = migrations
    ? 'Database setup required'
    : code === 'server_configuration_required'
      ? 'Server setup required'
      : 'Service temporarily unavailable';
  const userId = user?.id;
  const bootstrap =
    userId && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(userId)
      ? `INSERT INTO public.platform_users(user_id)\nSELECT id FROM auth.users WHERE id = '${userId}'::uuid\nON CONFLICT(user_id) DO UPDATE SET enabled = true;`
      : null;
  return (
    <div className="mx-auto max-w-3xl">
      <Panel
        title={title}
        description={
          administrator
            ? message
            : 'Your service administrator needs to complete the platform setup.'
        }
      >
        {administrator && migrations && (
          <>
            <p className="text-muted-foreground text-sm">
              The application is connected, but its managed-service database
              migrations have not been installed.
            </p>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm">
              <li>
                Open your Supabase project and select{' '}
                <strong>SQL Editor</strong>.
              </li>
              <li>
                Download the setup SQL below, review it, and run it. It installs
                migrations <strong>065–068</strong> in order and refreshes the
                schema cache.
              </li>
              <li>
                Set up the account that will administer your platform, then
                check setup again.
              </li>
            </ol>
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href="/api/managed/setup"
                download
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
              >
                Download setup SQL
              </a>
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="rounded-md border px-4 py-2 text-sm font-medium"
              >
                Open Supabase
              </a>
            </div>
            {bootstrap && (
              <details className="mt-5 rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Platform-admin setup for your current login
                </summary>
                <p className="text-muted-foreground mt-3 text-sm">
                  After installing the migrations, run this separately in SQL
                  Editor only if this login should administer all client
                  workspaces.
                </p>
                <pre className="bg-background mt-3 overflow-x-auto rounded-md p-3 text-xs">
                  {bootstrap}
                </pre>
              </details>
            )}
          </>
        )}
        {administrator && code === 'server_configuration_required' && (
          <p className="text-muted-foreground text-sm">
            Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the
            application server, then restart it. Keep the service-role key on
            the server.
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={() => void retry()}
        >
          Check setup again
        </Button>
      </Panel>
    </div>
  );
}
