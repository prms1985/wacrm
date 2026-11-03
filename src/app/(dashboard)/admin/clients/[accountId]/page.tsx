'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Field,
  Panel,
  fieldClass,
  managedRequest,
  UsageSummary,
  PlanSummary,
} from '@/components/managed/shared';
import {
  CAPABILITY_LABELS,
  PLATFORM_ONLY,
  MANAGED_CAPABILITIES,
  SUBSCRIPTION_STATUSES,
  formatPrice,
} from '@/lib/managed/catalog';
import type {
  ManagedAccountData,
  ManagedClientsData,
} from '@/lib/managed/types';

export default function ClientPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const endpoint = `/api/admin/clients/${accountId}`;
  const [data, setData] = useState<ManagedAccountData | null>(null),
    [catalog, setCatalog] = useState<ManagedClientsData | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [testReply, setTestReply] = useState('');
  const load = useCallback(async () => {
    try {
      const responses = await Promise.all([
        fetch(`/api/admin/clients/${accountId}`, { cache: 'no-store' }),
        fetch('/api/admin/clients', { cache: 'no-store' }),
      ]);
      const [client, options] = await Promise.all(
        responses.map((r) => r.json())
      );
      if (!responses[0].ok) throw new Error(client.error);
      if (!responses[1].ok) throw new Error(options.error);
      setData(client);
      setCatalog(options);
      setError('');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not load client'
      );
    }
  }, [accountId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function action(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const result = await managedRequest(endpoint, body);
      if (result.reply) setTestReply(result.reply);
      await load();
      toast.success(
        body.action === 'publish'
          ? 'AI configuration published'
          : 'Changes saved'
      );
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function form(event: React.FormEvent<HTMLFormElement>, kind: string) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      ...Object.fromEntries(fd),
      action: kind,
    };
    if (kind === 'subscription')
      body.extra_capabilities = fd.getAll('extra_capabilities');
    if (kind === 'draft') {
      body.auto_reply_enabled = fd.get('auto_reply_enabled') === 'on';
      body.reply_limit = Number(fd.get('reply_limit'));
      body.version = data?.draft?.version ?? null;
    }
    await action(body);
  }
  async function credentials(
    event: React.FormEvent<HTMLFormElement>,
    kind: 'ai' | 'whatsapp'
  ) {
    event.preventDefault();
    const element = event.currentTarget;
    const body: Record<string, unknown> = Object.fromEntries(
      new FormData(element)
    );
    setBusy(true);
    try {
      if (kind === 'ai') {
        body.is_active = false;
        body.auto_reply_enabled = false;
        body.auto_reply_max_per_conversation = 5;
        body.receptionist_config = {
          enabled: true,
          collectDetails: true,
          suggestProducts: true,
          prepareQuotations: true,
          transferToStaff: true,
        };
      }
      const result = await managedRequest(
        `/api/${kind === 'ai' ? 'ai' : 'whatsapp'}/config?account_id=${accountId}`,
        body
      );
      if (result.saved === true && result.success === false)
        throw new Error(
          result.error || 'Credentials saved; connection needs attention'
        );
      element.reset();
      await load();
      toast.success('Credentials verified and saved');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not save credentials'
      );
    } finally {
      setBusy(false);
    }
  }
  async function importCatalogue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(
        `/api/products/import?account_id=${accountId}`,
        { method: 'POST', body: new FormData(event.currentTarget) }
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Catalogue import failed');
      toast.success(`${result.imported} catalogue items imported`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not import catalogue'
      );
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <div role="alert" className="space-y-4">
        <p>{error}</p>
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    );
  if (!data || !catalog) return <p role="status">Loading client workspace…</p>;
  const start =
    data.subscription?.period_start.slice(0, 10) ??
    new Date().toISOString().slice(0, 10);
  const end =
    data.subscription?.period_end.slice(0, 10) ??
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/admin/clients" className="text-primary text-sm">
        ← Client workspaces
      </Link>
      <div>
        <p className="text-primary text-sm font-medium">
          Managed business automation
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {data.account.name}
        </h1>
        <p className="text-muted-foreground mt-2">
          Review onboarding, configure the service, then activate the client.
        </p>
      </div>
      <Panel title="Service overview">
        <PlanSummary data={data} />
        <div className="mt-5">
          <UsageSummary data={data} />
        </div>
      </Panel>
      <Panel
        title={
          data.subscription
            ? 'Subscription & permissions'
            : 'Enroll this workspace'
        }
        description={
          data.subscription
            ? 'Activation controls runtime access. Recording a payment does not automatically renew the service period.'
            : 'Enrollment pauses existing automated replies and active flows so you can configure the managed receptionist.'
        }
      >
        <form
          onSubmit={(e) => void form(e, 'subscription')}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Field label="Service plan">
            <select
              name="plan_id"
              defaultValue={data.subscription?.plan_id ?? catalog.plans[0]?.id}
              className={fieldClass}
            >
              {catalog.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Industry package">
            <select
              name="industry_id"
              defaultValue={
                data.subscription?.industry_id ?? catalog.industries[0]?.id
              }
              className={fieldClass}
            >
              {catalog.industries.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              name="status"
              defaultValue={data.subscription?.status ?? 'pending'}
              className={fieldClass}
            >
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period start (UTC)">
            <input
              type="date"
              name="period_start"
              required
              defaultValue={start}
              className={fieldClass}
            />
          </Field>
          <Field label="Period end, exclusive (UTC)">
            <input
              type="date"
              name="period_end"
              required
              defaultValue={end}
              className={fieldClass}
            />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="mb-3 text-sm font-medium">
              Additional client features beyond the plan
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              {MANAGED_CAPABILITIES.filter(
                (c) => !PLATFORM_ONLY.includes(c)
              ).map((cap) => (
                <label key={cap} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="extra_capabilities"
                    value={cap}
                    defaultChecked={data.subscription?.extra_capabilities.includes(
                      cap
                    )}
                    className="accent-primary"
                  />
                  {CAPABILITY_LABELS[cap]}
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={busy} className="w-fit">
            {data.subscription ? 'Update subscription' : 'Enroll client'}
          </Button>
        </form>
      </Panel>
      {data.subscription && (
        <>
          <Panel title="Business onboarding">
            <form
              key={data.business?.updated_at as string | undefined}
              onSubmit={(e) => void form(e, 'business')}
              className="grid gap-4 sm:grid-cols-2"
            >
              <Field label="Business name">
                <input
                  name="business_name"
                  required
                  maxLength={200}
                  defaultValue={
                    data.business?.business_name ?? data.account.name
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label="Human support contact">
                <input
                  name="support_contact"
                  required
                  maxLength={300}
                  defaultValue={data.business?.support_contact}
                  className={fieldClass}
                />
              </Field>
              <Field label="Business information">
                <textarea
                  name="description"
                  rows={4}
                  maxLength={5000}
                  defaultValue={data.business?.description}
                  className={fieldClass}
                />
              </Field>
              <Field label="Operating hours">
                <textarea
                  name="operating_hours"
                  rows={4}
                  maxLength={500}
                  defaultValue={data.business?.operating_hours}
                  className={fieldClass}
                />
              </Field>
              <Button type="submit" disabled={busy} className="w-fit">
                Save business details
              </Button>
            </form>
          </Panel>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title="AI credentials"
              description={`Current connection: ${data.ai ? `${data.ai.provider} · ${data.ai.model}` : 'Not configured'}. Saving credentials pauses AI until you publish.`}
            >
              <form
                onSubmit={(e) => void credentials(e, 'ai')}
                className="space-y-4"
              >
                <Field label="Provider">
                  <select
                    name="provider"
                    className={fieldClass}
                    defaultValue={data.ai?.provider ?? 'openai'}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="openai_compatible">OpenAI compatible</option>
                  </select>
                </Field>
                <Field label="Model ID">
                  <input
                    name="model"
                    required
                    defaultValue={data.ai?.model}
                    placeholder="Your approved model ID"
                    className={fieldClass}
                  />
                </Field>
                <Field label="Provider API key">
                  <input
                    type="password"
                    name="api_key"
                    autoComplete="new-password"
                    placeholder={
                      data.ai
                        ? 'Leave empty to keep existing key'
                        : 'Provider API key'
                    }
                    className={fieldClass}
                  />
                </Field>
                <Field label="Compatible provider URL (if needed)">
                  <input type="url" name="base_url" className={fieldClass} />
                </Field>
                <Button type="submit" disabled={busy}>
                  Verify & save AI credentials
                </Button>
              </form>
            </Panel>
            <Panel
              title="WhatsApp connection"
              description={
                data.whatsapp
                  ? `${data.whatsapp.phone_number_id} · ${data.whatsapp.status}. Business app connections are authorized by the client during onboarding.`
                  : 'The client can authorize WhatsApp Business during pending onboarding, or you can configure an existing Cloud API number here.'
              }
            >
              <form
                onSubmit={(e) => void credentials(e, 'whatsapp')}
                className="space-y-4"
              >
                <Field label="Phone number ID">
                  <input
                    name="phone_number_id"
                    required
                    inputMode="numeric"
                    defaultValue={data.whatsapp?.phone_number_id}
                    className={fieldClass}
                  />
                </Field>
                <Field label="WhatsApp Business account ID">
                  <input
                    name="waba_id"
                    required
                    inputMode="numeric"
                    className={fieldClass}
                  />
                </Field>
                <Field label="Access token">
                  <input
                    name="access_token"
                    required
                    type="password"
                    autoComplete="new-password"
                    className={fieldClass}
                  />
                </Field>
                <Field label="Webhook verification token">
                  <input
                    name="verify_token"
                    type="password"
                    autoComplete="new-password"
                    className={fieldClass}
                  />
                </Field>
                <Field label="Two-step registration PIN">
                  <input
                    name="pin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoComplete="new-password"
                    className={fieldClass}
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  Verify & save connection
                </Button>
              </form>
            </Panel>
          </div>
          <Panel
            title="Receptionist draft"
            description={`Draft version ${data.draft?.version ?? '—'} · Published version ${data.draft?.published_version ?? 'none'}. Save and test before publishing.`}
          >
            <form
              key={data.draft?.version}
              onSubmit={(e) => void form(e, 'draft')}
              className="space-y-4"
            >
              <Field label="Business instructions">
                <textarea
                  name="system_prompt"
                  rows={10}
                  required
                  maxLength={30000}
                  defaultValue={
                    data.draft?.system_prompt ?? data.industry?.system_prompt
                  }
                  className={fieldClass}
                />
              </Field>
              <div className="flex flex-wrap items-end gap-5">
                <Field label="Replies per conversation">
                  <input
                    name="reply_limit"
                    type="number"
                    min={1}
                    max={20}
                    required
                    defaultValue={data.draft?.reply_limit ?? 5}
                    className={`${fieldClass} max-w-40`}
                  />
                </Field>
                <label className="flex items-center gap-2 py-2 text-sm">
                  <input
                    name="auto_reply_enabled"
                    type="checkbox"
                    defaultChecked={data.draft?.auto_reply_enabled}
                    className="accent-primary"
                  />
                  Enable automatic replies on publish
                </label>
              </div>
              <Button type="submit" disabled={busy}>
                Save draft
              </Button>
            </form>
            <form
              onSubmit={(e) => void form(e, 'test')}
              className="mt-5 flex flex-wrap gap-3"
            >
              <label className="min-w-48 flex-1">
                <span className="sr-only">Test customer message</span>
                <input
                  name="message"
                  required
                  maxLength={2000}
                  placeholder="Type a customer enquiry to test the saved draft"
                  className={fieldClass}
                />
              </label>
              <Button
                type="submit"
                disabled={busy || !data.ai || !data.draft}
                variant="outline"
              >
                Test saved draft
              </Button>
            </form>
            {testReply && (
              <div
                className="bg-background mt-4 rounded-lg border p-4 text-sm whitespace-pre-wrap"
                role="status"
              >
                {testReply}
              </div>
            )}
            <Button
              className="mt-5"
              disabled={
                busy ||
                !data.ai ||
                !data.business?.onboarding_complete ||
                !data.draft
              }
              onClick={() =>
                void action({ action: 'publish', version: data.draft?.version })
              }
            >
              Publish saved draft
            </Button>
          </Panel>
          <Panel
            title="Client catalogue"
            description="Import this client's approved products and prices before activating quotation intake. Availability remains manually maintained."
          >
            <form onSubmit={importCatalogue} className="space-y-4">
              <a
                href="/samples/products.csv"
                download
                className="text-primary text-sm"
              >
                Download the product CSV sample
              </a>
              <Field label="Catalogue CSV (up to 500 rows)">
                <input
                  type="file"
                  name="file"
                  required
                  accept=".csv,text/csv"
                  className={fieldClass}
                />
              </Field>
              <Button disabled={busy} type="submit">
                Import catalogue for this client
              </Button>
            </form>
          </Panel>
          <Panel
            title="Business knowledge"
            description="Add approved product guidance, FAQs, policies or service information for this client. This content becomes available to the existing knowledge search."
          >
            <form
              onSubmit={(e) => void form(e, 'knowledge')}
              className="space-y-4"
            >
              <Field label="Document title">
                <input
                  name="title"
                  required
                  maxLength={200}
                  className={fieldClass}
                />
              </Field>
              <Field label="Approved content">
                <textarea
                  name="content"
                  required
                  maxLength={100000}
                  rows={5}
                  className={fieldClass}
                />
              </Field>
              <Button type="submit" disabled={busy}>
                Add knowledge document
              </Button>
            </form>
            <div className="mt-5 space-y-3">
              {data.knowledge?.map((document) => (
                <div
                  key={document.id}
                  className="flex items-center justify-between gap-3 border-t pt-3 text-sm"
                >
                  <span>{document.title}</span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void action({
                        action: 'delete_knowledge',
                        id: document.id,
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
          <Panel
            title="Record a payment"
            description="Record a verified payment received through your agreed payment method. Reusing a reference with identical details is safe; changed details are rejected."
          >
            <form
              onSubmit={(e) => void form(e, 'payment')}
              className="grid gap-4 sm:grid-cols-3"
            >
              <Field label="Payment reference">
                <input
                  name="reference"
                  required
                  maxLength={150}
                  className={fieldClass}
                />
              </Field>
              <Field label={`Amount (${data.plan?.currency ?? 'INR'})`}>
                <input
                  name="amount"
                  required
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]{1,2})?"
                  className={fieldClass}
                />
              </Field>
              <input
                type="hidden"
                name="currency"
                value={data.plan?.currency ?? 'INR'}
              />
              <Button type="submit" disabled={busy} className="self-end">
                Record payment
              </Button>
            </form>
            <div className="mt-5 space-y-2">
              {data.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex flex-wrap justify-between gap-2 border-t pt-3 text-sm"
                >
                  <span>{payment.reference}</span>
                  <span>
                    {formatPrice(payment.amount_minor, payment.currency)} ·{' '}
                    {new Date(payment.paid_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Activity history">
            <div className="space-y-3">
              {data.audit.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-wrap justify-between gap-2 border-b pb-3 text-sm"
                >
                  <span>
                    {event.action.replaceAll('.', ' · ').replaceAll('_', ' ')}
                  </span>
                  <time
                    className="text-muted-foreground"
                    dateTime={event.created_at}
                  >
                    {new Date(event.created_at).toLocaleString()}
                  </time>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
