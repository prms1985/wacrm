import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { AiConfig, ReceptionistConfig } from './types';

export const DEFAULT_RECEPTIONIST_CONFIG: ReceptionistConfig = {
  enabled: true,
  receptionistName: 'Receptionist',
  greetingPrompt: null,
  collectDetails: true,
  suggestProducts: true,
  prepareQuotations: true,
  transferToStaff: true,
};

export function parseReceptionistConfig(raw: unknown): ReceptionistConfig {
  if (!raw || typeof raw !== 'object')
    return { ...DEFAULT_RECEPTIONIST_CONFIG };
  const obj = raw as Record<string, unknown>;
  return {
    enabled: obj.enabled !== false,
    receptionistName:
      typeof obj.receptionist_name === 'string' && obj.receptionist_name.trim()
        ? obj.receptionist_name.trim()
        : typeof obj.receptionistName === 'string' &&
            obj.receptionistName.trim()
          ? obj.receptionistName.trim()
          : DEFAULT_RECEPTIONIST_CONFIG.receptionistName,
    greetingPrompt:
      typeof obj.greeting_prompt === 'string' && obj.greeting_prompt.trim()
        ? obj.greeting_prompt.trim()
        : typeof obj.greetingPrompt === 'string' && obj.greetingPrompt.trim()
          ? obj.greetingPrompt.trim()
          : null,
    collectDetails:
      obj.collect_details !== false && obj.collectDetails !== false,
    suggestProducts:
      obj.suggest_products !== false && obj.suggestProducts !== false,
    prepareQuotations:
      obj.prepare_quotations !== false && obj.prepareQuotations !== false,
    transferToStaff:
      obj.transfer_to_staff !== false && obj.transferToStaff !== false,
  };
}

interface AiConfigRow {
  provider: 'openai' | 'anthropic' | 'openai_compatible';
  model: string;
  base_url: string | null;
  api_key: string;
  system_prompt: string | null;
  is_active: boolean;
  auto_reply_enabled: boolean;
  auto_reply_max_per_conversation: number;
  handoff_agent_id: string | null;
  embeddings_api_key: string | null;
  receptionist_config?: unknown;
}

const BASE_CONFIG_COLUMNS =
  'provider, model, base_url, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key';

const CONFIG_COLUMNS = `${BASE_CONFIG_COLUMNS}, receptionist_config`;

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Pass a service-role client after authorizing this account. Migration 067
 * removes browser/session grants on the credential-bearing table.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {}
): Promise<AiConfig | null> {
  const { requireActive = true } = opts;
  let { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error && (error as { code?: string }).code === '42703') {
    const fallback = await db
      .from('ai_configs')
      .select(BASE_CONFIG_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle();
    data = fallback.data
      ? { ...(fallback.data as AiConfigRow), receptionist_config: null }
      : null;
    error = fallback.error;
  }

  if (error) throw error;
  if (!data) return null;

  const row = data as AiConfigRow;
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null;
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null;

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null;
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key);
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`
      );
      embeddingsApiKey = null;
    }
  }

  return {
    accountId,
    provider: row.provider,
    model: row.model,
    baseUrl: row.base_url,
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    receptionistConfig: parseReceptionistConfig(row.receptionist_config),
  };
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false };
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false };
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`
    );
    return { key: null, corrupt: true };
  }
}
