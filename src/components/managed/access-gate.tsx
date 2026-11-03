'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useManagedAccess } from '@/hooks/use-managed-access';
import { canOpenManagedPath, managedRedirect } from '@/lib/managed/navigation';

export function ManagedAccessGate({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data, loading, error, refresh } = useManagedAccess();
  const redirect = loading ? null : managedRedirect(path, data);
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  if (loading) return <p role="status">Checking service access…</p>;
  // The subscription screen contains detailed setup errors and retry controls.
  if (path === '/subscription') return children;
  if (error || !data)
    return (
      <div className="bg-card rounded-xl border p-6" role="alert">
        <h1 className="text-xl font-semibold">
          Service access could not be verified
        </h1>
        <p className="text-muted-foreground mt-2">
          Refresh access or open your service plan for setup details.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-primary mt-4 mr-4 underline"
        >
          Retry access check
        </button>
        <Link href="/subscription" className="text-primary underline">
          Open your service plan
        </Link>
      </div>
    );
  if (redirect)
    return (
      <p role="status">
        Opening your {data.platformAdmin ? 'admin portal' : 'onboarding'}…
      </p>
    );
  if (!canOpenManagedPath(path, data))
    return (
      <div className="bg-card rounded-xl border p-6">
        <h1 className="text-xl font-semibold">
          {path === '/admin' || path.startsWith('/admin/')
            ? 'Platform administrator access required'
            : 'This feature is managed by your service team'}
        </h1>
        <p className="text-muted-foreground mt-2">
          View your package and contact your administrator to discuss changes.
        </p>
        <Link href="/subscription" className="text-primary mt-4 inline-block">
          Open your service plan
        </Link>
      </div>
    );
  return children;
}
