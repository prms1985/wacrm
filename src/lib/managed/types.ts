import type { ManagedCapability, SubscriptionStatus } from './catalog';
export interface ManagedPlan {
  id: string;
  name: string;
  currency: string;
  monthly_price_minor: number;
  setup_price_minor: number;
  seat_limit: number;
  ai_generation_limit: number;
  outbound_attempt_limit: number;
  capabilities: ManagedCapability[];
  is_active: boolean;
}
export interface IndustryPackage {
  id: string;
  name: string;
  description: string;
  system_prompt?: string;
  workflow_steps: string[];
}
export interface ManagedSubscription {
  account_id: string;
  plan_id: string;
  industry_id: string;
  status: SubscriptionStatus;
  period_start: string;
  period_end: string;
  extra_capabilities: ManagedCapability[];
}
export interface BusinessProfile {
  business_name: string;
  description: string;
  support_contact: string;
  operating_hours: string;
  onboarding_complete: boolean;
  updated_at?: string;
}
export interface ManagedAccountData {
  userId?: string;
  knowledge?: { id: string; title: string; updated_at: string }[];
  account: { id: string; name: string };
  role?: string;
  platformAdmin?: boolean;
  capabilities?: Partial<Record<ManagedCapability, boolean>>;
  subscription: ManagedSubscription | null;
  plan: ManagedPlan | null;
  industry: IndustryPackage | null;
  business: BusinessProfile | null;
  usage: { metric: string; used: number }[];
  seats: number;
  quotations: number;
  whatsapp: {
    phone_number_id: string;
    status: string;
    connection_mode: string;
    registered_at: string | null;
  } | null;
  ai: {
    is_active: boolean;
    auto_reply_enabled: boolean;
    provider?: string;
    model?: string;
  } | null;
  draft: {
    system_prompt: string;
    auto_reply_enabled: boolean;
    reply_limit: number;
    version: number;
    published_version: number | null;
  } | null;
  payments: {
    id: string;
    reference: string;
    amount_minor: number;
    currency: string;
    paid_at: string;
  }[];
  audit: { id: string; action: string; created_at: string; actor_id: string }[];
}
export interface ManagedClientsData {
  accounts: { id: string; name: string; created_at: string }[];
  subscriptions: ManagedSubscription[];
  plans: ManagedPlan[];
  industries: IndustryPackage[];
  total: number;
  managed_signup: boolean;
}
