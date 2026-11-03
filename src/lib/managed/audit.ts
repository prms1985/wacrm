import { credentialStore } from './credentials';
type ConfigurationEvent =
  | 'ai.connection_saved'
  | 'ai.connection_removed'
  | 'whatsapp.connection_saved'
  | 'whatsapp.connection_removed';
export async function recordConfigurationAudit(
  accountId: string,
  actorId: string,
  action: ConfigurationEvent
) {
  const { error } = await credentialStore()
    .from('platform_audit_log')
    .insert({ account_id: accountId, actor_id: actorId, action });
  if (error)
    throw new Error(
      'Configuration saved, but activity recording failed. Review the connection before retrying.'
    );
}
