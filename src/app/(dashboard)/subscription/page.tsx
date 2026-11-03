'use client';
import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useManagedAccess } from '@/hooks/use-managed-access';
import {
  Panel,
  Field,
  fieldClass,
  managedRequest,
  UsageSummary,
  PlanSummary,
} from '@/components/managed/shared';
import { WhatsAppCoexistence } from '@/components/settings/whatsapp-coexistence';
import { CAPABILITY_LABELS, formatPrice } from '@/lib/managed/catalog';
import { ManagedSetupRequired } from '@/components/managed/setup-required';

export default function SubscriptionPage() {
  const { data, loading, error, errorCode, refresh } = useManagedAccess();
  const [saving, setSaving] = useState(false);
  if (loading) return <p role="status">Loading your service plan…</p>;
  if (error || !data)
    return (
      <ManagedSetupRequired
        code={errorCode}
        message={error ?? 'Could not load your service plan'}
        retry={refresh}
      />
    );
  if (data.platformAdmin)
    return (
      <Panel title="Platform administration">
        <p>
          Manage client onboarding, subscription plans, payments, WhatsApp
          connections and AI agents from your admin portal.
        </p>
        <Link
          href="/admin/clients"
          className="text-primary mt-4 inline-block font-medium underline"
        >
          Open admin portal
        </Link>
      </Panel>
    );
  if (!data.subscription)
    return (
      <Panel title="Your workspace">
        <p>
          This workspace is operating independently. Contact your platform
          administrator to enroll in a managed automation package.
        </p>
      </Panel>
    );
  const canOnboard = data.role === 'owner' || data.role === 'admin';
  async function saveBusiness(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setSaving(true);
    try {
      await managedRequest('/api/managed/account', fields);
      await refresh();
      toast.success(
        'Business details saved. Your service team can review them.'
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not save details'
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-primary text-sm font-medium">
          Your automation service
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Plan & onboarding
        </h1>
        <p className="text-muted-foreground mt-2">
          Your business setup, service allowances and connection status.
        </p>
      </div>
      <Panel title="Subscription">
        <PlanSummary data={data} />
        <p className="text-muted-foreground mt-4 text-sm">
          Service period:{' '}
          {new Date(data.subscription.period_start).toLocaleDateString()} –{' '}
          {new Date(data.subscription.period_end).toLocaleDateString()}.
          Provider charges are separate.
        </p>
        <div className="mt-5">
          <UsageSummary data={data} />
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          AI generations include extraction and reply requests. Outbound
          attempts include retries and uncertain sends.
        </p>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Your workflow">
          <ol className="space-y-3">
            {data.industry?.workflow_steps.map((step, index) => (
              <li key={step} className="flex gap-3 text-sm">
                <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground mt-5 text-sm">
            Quotations require staff approval. Your team records follow-up
            outcomes in the CRM.
          </p>
        </Panel>
        <Panel title="Service status">
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt>Business details</dt>
              <dd>
                {data.business?.onboarding_complete
                  ? 'Submitted'
                  : 'Awaiting details'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>WhatsApp</dt>
              <dd>{data.whatsapp?.status ?? 'Not connected'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>AI receptionist</dt>
              <dd>
                {data.ai?.is_active && data.ai.auto_reply_enabled
                  ? 'Enabled'
                  : 'Awaiting configuration'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Quotations in workspace</dt>
              <dd>{data.quotations}</dd>
            </div>
          </dl>
          <p className="text-muted-foreground mt-5 text-sm">
            {data.business?.support_contact
              ? `Business support: ${data.business.support_contact}`
              : 'Add a business contact so customers can reach staff.'}
          </p>
        </Panel>
      </div>
      <Panel
        title="Business information"
        description="Your service team uses this information to configure the receptionist. Updates take effect in the bot after your team publishes them."
      >
        <form
          key={data.business?.business_name}
          onSubmit={saveBusiness}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field label="Business name">
            <input
              name="business_name"
              required
              maxLength={200}
              defaultValue={data.business?.business_name ?? data.account.name}
              disabled={!canOnboard}
              className={fieldClass}
            />
          </Field>
          <Field label="Human support contact">
            <input
              name="support_contact"
              required
              maxLength={300}
              defaultValue={data.business?.support_contact}
              disabled={!canOnboard}
              placeholder="Phone or email customers can contact"
              className={fieldClass}
            />
          </Field>
          <Field label="Business information">
            <textarea
              name="description"
              rows={4}
              maxLength={5000}
              defaultValue={data.business?.description}
              disabled={!canOnboard}
              className={fieldClass}
            />
          </Field>
          <Field label="Operating hours">
            <textarea
              name="operating_hours"
              rows={4}
              maxLength={500}
              defaultValue={data.business?.operating_hours}
              disabled={!canOnboard}
              className={fieldClass}
            />
          </Field>
          {canOnboard && (
            <Button disabled={saving} type="submit" className="w-fit">
              {saving ? 'Saving…' : 'Submit business details'}
            </Button>
          )}
        </form>
      </Panel>
      {canOnboard &&
        data.subscription.status === 'pending' &&
        !data.whatsapp && (
          <Panel
            title="Connect your WhatsApp Business account"
            description="Authorize your business through Meta. Your service team will review the connection before activation."
          >
            <WhatsAppCoexistence onConnected={refresh} />
          </Panel>
        )}
      <Panel title="Included features">
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.capabilities ?? {})
            .filter(([, enabled]) => enabled)
            .map(([key]) => (
              <span key={key} className="rounded-full border px-3 py-1 text-sm">
                {CAPABILITY_LABELS[key as keyof typeof CAPABILITY_LABELS]}
              </span>
            ))}
        </div>
      </Panel>
      <Panel
        title="Payment records"
        description="Payments are recorded by your service administrator. This page does not collect card details."
      >
        {data.payments.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="pb-3">Reference</th>
                  <th className="pb-3">Amount</th>
                  <th className="pb-3">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-3">{p.reference}</td>
                    <td>{formatPrice(p.amount_minor, p.currency)}</td>
                    <td>{new Date(p.paid_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No payments recorded.</p>
        )}
      </Panel>
    </div>
  );
}
