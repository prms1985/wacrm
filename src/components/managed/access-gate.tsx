'use client';
import { subscriptionDisplayStatus } from '@/lib/managed/catalog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useManagedAccess,
  canOpenManagedPath,
} from '@/hooks/use-managed-access';
export function ManagedAccessGate({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { data, loading, error } = useManagedAccess();
  if (
    loading &&
    ['/admin', '/automations', '/flows', '/agents', '/broadcasts'].some(
      (prefix) => path.startsWith(prefix)
    )
  )
    return <p role="status">Checking service access…</p>;
  if (
    (path.startsWith('/admin') || data?.subscription) &&
    !canOpenManagedPath(path, data)
  )
    return (
      <div className="bg-card rounded-xl border p-6">
        <h1 className="text-xl font-semibold">
          This feature is managed by your service team
        </h1>
        <p className="text-muted-foreground mt-2">
          View your package and contact your administrator to discuss changes.
        </p>
        <Link href="/subscription" className="text-primary mt-4 inline-block">
          Open your service plan
        </Link>
      </div>
    );
  return (
    <>
      {error && !path.startsWith('/subscription') && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
        >
          Service access could not be verified.{' '}
          <Link href="/subscription" className="underline">
            View setup details or retry
          </Link>
          .
        </p>
      )}
      {data?.subscription &&
        subscriptionDisplayStatus(data.subscription) !== 'active' &&
        !path.startsWith('/subscription') &&
        !path.startsWith('/admin') && (
          <p className="bg-card mb-4 rounded-lg border p-3 text-sm">
            Your service is {subscriptionDisplayStatus(data.subscription)}.{' '}
            <Link href="/subscription" className="text-primary">
              View onboarding and subscription details
            </Link>
            .
          </p>
        )}
      {children}
    </>
  );
}
