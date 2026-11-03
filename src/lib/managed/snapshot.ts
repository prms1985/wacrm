import { credentialStore } from './credentials';
import { throwManagedDatabaseError } from './errors';

export async function managedSnapshot(
  accountId: string,
  administrator = false
) {
  const db = credentialStore();
  const [subscription, business, whatsapp, ai, members, quotations, payments] =
    await Promise.all([
      db
        .from('managed_subscriptions')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle(),
      db
        .from('managed_business_profiles')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle(),
      db
        .from('whatsapp_config')
        .select('phone_number_id,status,connection_mode,registered_at')
        .eq('account_id', accountId)
        .maybeSingle(),
      db
        .from('ai_configs')
        .select('is_active,auto_reply_enabled,model,provider')
        .eq('account_id', accountId)
        .maybeSingle(),
      db
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
      db
        .from('quotations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
      db
        .from('managed_payments')
        .select('id,reference,amount_minor,currency,paid_at')
        .eq('account_id', accountId)
        .order('paid_at', { ascending: false })
        .limit(20),
    ]);
  for (const result of [
    subscription,
    business,
    whatsapp,
    ai,
    members,
    quotations,
    payments,
  ]) {
    if (result.error)
      throwManagedDatabaseError(result.error, 'load managed workspace');
  }
  const [plan, industry, usage, draft, audit] = await Promise.all([
    subscription.data
      ? db
          .from('subscription_plans')
          .select('*')
          .eq('id', subscription.data.plan_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
    subscription.data
      ? db
          .from('industry_packages')
          .select('*')
          .eq('id', subscription.data.industry_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
    subscription.data
      ? db
          .from('managed_usage')
          .select('metric,used')
          .eq('account_id', accountId)
          .eq('period_start', subscription.data.period_start)
      : Promise.resolve({ data: [], error: null }),
    administrator
      ? db
          .from('managed_ai_drafts')
          .select('*')
          .eq('account_id', accountId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    administrator
      ? db
          .from('platform_audit_log')
          .select('id,action,created_at,actor_id')
          .eq('account_id', accountId)
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [plan, industry, usage, draft, audit])
    if (result.error)
      throwManagedDatabaseError(result.error, 'load subscription details');
  const knowledge = administrator
    ? await db
        .from('ai_knowledge_documents')
        .select('id,title,updated_at')
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false })
        .limit(50)
    : { data: [], error: null };
  if (knowledge.error)
    throwManagedDatabaseError(knowledge.error, 'load client knowledge');
  return {
    knowledge: knowledge.data ?? [],
    subscription: subscription.data,
    business: business.data,
    plan: plan.data,
    industry: industry.data
      ? {
          id: industry.data.id,
          name: industry.data.name,
          description: industry.data.description,
          workflow_steps: industry.data.workflow_steps,
          ...(administrator
            ? { system_prompt: industry.data.system_prompt }
            : {}),
        }
      : null,
    usage: usage.data ?? [],
    draft: draft.data,
    audit: audit.data ?? [],
    whatsapp: whatsapp.data,
    ai: ai.data
      ? {
          is_active: ai.data.is_active,
          auto_reply_enabled: ai.data.auto_reply_enabled,
          ...(administrator
            ? { model: ai.data.model, provider: ai.data.provider }
            : {}),
        }
      : null,
    seats: members.count ?? 0,
    quotations: quotations.count ?? 0,
    payments: payments.data ?? [],
  };
}
