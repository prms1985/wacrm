export const MANAGED_CAPABILITIES = [
  'inbox.reply',
  'contacts.write',
  'broadcast.send',
  'automation.manage',
  'ai.use',
  'ai.configure',
  'whatsapp.manage',
  'api.manage',
  'api.access',
  'members.manage',
  'catalogue.manage',
  'quotation.manage',
] as const;
export type ManagedCapability = (typeof MANAGED_CAPABILITIES)[number];
export type SubscriptionStatus =
  'pending' | 'active' | 'past_due' | 'suspended' | 'cancelled';
export function subscriptionDisplayStatus(
  subscription: { status: string; period_start: string; period_end: string },
  now = Date.now()
): string {
  if (
    subscription.status === 'active' &&
    new Date(subscription.period_end).getTime() <= now
  )
    return 'expired';
  if (
    subscription.status === 'active' &&
    new Date(subscription.period_start).getTime() > now
  )
    return 'scheduled';
  return subscription.status.replaceAll('_', ' ');
}

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'pending',
  'active',
  'past_due',
  'suspended',
  'cancelled',
];
export const PLATFORM_ONLY: readonly ManagedCapability[] = [
  'ai.configure',
  'whatsapp.manage',
  'api.manage',
  'automation.manage',
];
export const CAPABILITY_LABELS: Record<ManagedCapability, string> = {
  'inbox.reply': 'Reply to customers',
  'contacts.write': 'Manage contacts',
  'broadcast.send': 'Send campaigns',
  'automation.manage': 'Edit workflows',
  'ai.use': 'Use AI assistance',
  'ai.configure': 'Configure AI',
  'whatsapp.manage': 'Manage WhatsApp connection',
  'api.manage': 'Manage API keys',
  'api.access': 'External API access',
  'members.manage': 'Invite team members',
  'catalogue.manage': 'Manage catalogue',
  'quotation.manage': 'Prepare quotations',
};
export const DISTRIBUTOR_PROMPT = `You are the sales receptionist for this distributor.
Collect the customer's name, company, required catalogue items, quantities and delivery location.
Use approved business knowledge for factual answers. Ask about missing requirements one at a time.
Use the structured quotation intake when a customer requests a quote. Staff must approve all quotations.
Never invent prices, stock, discounts, delivery dates or payment confirmations.
Transfer complaints, exceptions and requests for a person to staff. Respect opt-out requests.
Keep replies concise and use the customer's language.`;

export function isCapability(value: unknown): value is ManagedCapability {
  return (
    typeof value === 'string' &&
    (MANAGED_CAPABILITIES as readonly string[]).includes(value)
  );
}

export function normalizeCapabilities(value: unknown): ManagedCapability[] {
  if (!Array.isArray(value) || !value.every(isCapability))
    throw new Error('Invalid capability selection');
  return [...new Set(value)].filter((cap) => !PLATFORM_ONLY.includes(cap));
}

export function parseAmountMinor(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,9}(?:\.\d{1,2})?$/.test(value))
    throw new Error('Enter a valid amount with at most two decimals');
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function formatPrice(amount: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount / 100);
}
