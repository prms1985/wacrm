'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Panel,
  Field,
  fieldClass,
  managedRequest,
} from '@/components/managed/shared';
import { formatPrice } from '@/lib/managed/catalog';
import type { ManagedClientsData } from '@/lib/managed/types';

export default function ClientsPage() {
  const [data, setData] = useState<ManagedClientsData | null>(null),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/admin/clients?page=${page}&q=${encodeURIComponent(query)}`,
        { cache: 'no-store' }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
      setError('');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not load clients'
      );
    }
  }, [page, query]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);
  async function changeSignup() {
    if (!data) return;
    setBusy(true);
    try {
      await managedRequest(
        '/api/admin/clients',
        { managed_signup: !data.managed_signup },
        'PATCH'
      );
      await load();
      toast.success('Registration setting updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }
  async function savePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await managedRequest(
        '/api/admin/clients',
        Object.fromEntries(new FormData(event.currentTarget))
      );
      await load();
      toast.success('Plan updated for all subscriptions using it');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-primary text-sm font-medium">
          Platform administration
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Client workspaces
        </h1>
        <p className="text-muted-foreground mt-2">
          Onboard businesses, publish their automations and manage recurring
          services.
        </p>
      </div>
      {error && (
        <p role="alert" className="border-destructive/30 rounded-lg border p-4">
          {error}
        </p>
      )}
      <Panel
        title="Client registration"
        description="Clients register with their own email and complete business details in Plan & onboarding. You review their setup and activate their subscription."
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm">
            New registrations:{' '}
            <strong>
              {data?.managed_signup
                ? 'Managed accounts awaiting approval'
                : 'Standalone workspaces'}
            </strong>
          </p>
          <Button
            variant="outline"
            disabled={!data || busy}
            onClick={changeSignup}
          >
            {data?.managed_signup
              ? 'Use standalone registration'
              : 'Require approval for new clients'}
          </Button>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          Existing workspaces change only when you enroll them below.
        </p>
      </Panel>
      <div className="grid gap-4 sm:grid-cols-2">
        {data?.plans.map((plan) => (
          <Panel key={plan.id} title={plan.name}>
            <p className="text-2xl font-semibold">
              {formatPrice(plan.monthly_price_minor, plan.currency)}{' '}
              <span className="text-muted-foreground text-sm font-normal">
                / month
              </span>
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              Setup {formatPrice(plan.setup_price_minor, plan.currency)} ·{' '}
              {plan.seat_limit} users ·{' '}
              {plan.ai_generation_limit.toLocaleString()} AI generations ·{' '}
              {plan.outbound_attempt_limit.toLocaleString()} outbound attempts
            </p>
            <details className="mt-4">
              <summary className="text-primary cursor-pointer text-sm">
                Edit pricing & allowances
              </summary>
              <form
                onSubmit={(e) => void savePlan(e)}
                className="mt-4 grid gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="id" value={plan.id} />
                <Field label={`Monthly price (${plan.currency})`}>
                  <input
                    name="monthly_price"
                    required
                    defaultValue={(plan.monthly_price_minor / 100).toFixed(2)}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Setup price">
                  <input
                    name="setup_price"
                    required
                    defaultValue={(plan.setup_price_minor / 100).toFixed(2)}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Team seats">
                  <input
                    name="seat_limit"
                    type="number"
                    min={1}
                    required
                    defaultValue={plan.seat_limit}
                    className={fieldClass}
                  />
                </Field>
                <Field label="AI generations">
                  <input
                    name="ai_generation_limit"
                    type="number"
                    min={0}
                    required
                    defaultValue={plan.ai_generation_limit}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Outbound attempts">
                  <input
                    name="outbound_attempt_limit"
                    type="number"
                    min={0}
                    required
                    defaultValue={plan.outbound_attempt_limit}
                    className={fieldClass}
                  />
                </Field>
                <Button disabled={busy} type="submit" className="self-end">
                  Update plan
                </Button>
                <p className="text-muted-foreground text-xs sm:col-span-2">
                  Changes apply to every client on this plan. Recorded payments
                  remain unchanged.
                </p>
              </form>
            </details>
          </Panel>
        ))}
      </div>
      <Panel title="All workspaces">
        <label className="mb-5 block max-w-md text-sm">
          Search clients
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Business name"
            className={`${fieldClass} mt-2`}
          />
        </label>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="pb-3">Business</th>
                <th className="pb-3">Service plan</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {data?.accounts.map((account) => {
                const sub = data.subscriptions.find(
                  (s) => s.account_id === account.id
                );
                return (
                  <tr key={account.id} className="border-b last:border-0">
                    <td className="py-4 font-medium">{account.name}</td>
                    <td>
                      {data.plans.find((p) => p.id === sub?.plan_id)?.name ??
                        'Standalone'}
                    </td>
                    <td className="capitalize">
                      {sub?.status.replace('_', ' ') ?? 'Independent'}
                    </td>
                    <td>
                      <Link
                        className="text-primary"
                        href={`/admin/clients/${account.id}`}
                      >
                        {sub ? 'Manage client' : 'Enroll client'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data?.accounts.length === 0 && (
            <p className="text-muted-foreground py-8 text-center">
              No workspaces found.
            </p>
          )}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <Button
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-muted-foreground text-sm">
            Page {page + 1} · {data?.total ?? 0} workspaces
          </span>
          <Button
            variant="outline"
            disabled={!data || (page + 1) * 50 >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </Panel>
    </div>
  );
}
