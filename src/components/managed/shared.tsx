'use client';
import type { ManagedAccountData } from '@/lib/managed/types';
import { formatPrice, subscriptionDisplayStatus } from '@/lib/managed/catalog';

export const fieldClass =
  'border-input bg-background w-full rounded-md border px-3 py-2 text-sm';
export async function managedRequest(
  url: string,
  body: unknown,
  method = 'POST'
) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
export function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && (
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function UsageSummary({ data }: { data: ManagedAccountData }) {
  const used = (metric: string) =>
    data.usage.find((row) => row.metric === metric)?.used ?? 0;
  const stats = [
    ['Team seats', data.seats, data.plan?.seat_limit],
    ['AI generations', used('ai_generations'), data.plan?.ai_generation_limit],
    [
      'Outbound attempts',
      used('outbound_attempts'),
      data.plan?.outbound_attempt_limit,
    ],
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {stats.map(([label, value, limit]) => (
        <div key={label} className="bg-background rounded-lg border p-4">
          <p className="text-muted-foreground text-sm">{label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {value.toLocaleString()}{' '}
            <span className="text-muted-foreground text-sm font-normal">
              / {limit?.toLocaleString() ?? '—'}
            </span>
          </p>
          <progress
            aria-label={label}
            max={Math.max(limit ?? 1, 1)}
            value={value}
            className="accent-primary mt-3 h-1.5 w-full"
          />
        </div>
      ))}
    </div>
  );
}
export function PlanSummary({ data }: { data: ManagedAccountData }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-muted-foreground text-sm">
          {data.industry?.name ?? 'Business automation'}
        </p>
        <p className="mt-1 text-xl font-semibold">
          {data.plan?.name ?? 'Choose a plan'}
        </p>
        <p className="mt-1 text-sm">
          {data.plan
            ? `${formatPrice(data.plan.monthly_price_minor, data.plan.currency)} / month`
            : ''}
        </p>
      </div>
      <div className="rounded-full border px-3 py-1 text-sm capitalize">
        {data.subscription
          ? subscriptionDisplayStatus(data.subscription)
          : 'Standalone'}
      </div>
    </div>
  );
}
