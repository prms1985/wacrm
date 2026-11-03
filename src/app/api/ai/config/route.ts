import { recordConfigurationAudit } from '@/lib/managed/audit';
import { configurationContext } from '@/lib/managed/access';
import { credentialStore } from '@/lib/managed/credentials';
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { validateAiCredentials } from '@/lib/ai/validate';
import { embedTexts } from '@/lib/ai/embeddings';
import { AiError, type AiProvider } from '@/lib/ai/types';
import { normalizeOpenAiCompatibleBaseUrl } from '@/lib/ai/providers/openai-compatible';
import { canReuseStoredAiKey } from '@/lib/ai/stored-key';
import { parseReceptionistConfig } from '@/lib/ai/config';
import { getT } from '@/lib/i18n/translate';

const t = getT('Api');

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = new URL(request.url).searchParams.has(
      'account_id'
    )
      ? await configurationContext(request, 'ai.configure')
      : await getCurrentAccount();

    let { data, error } = await credentialStore()
      .from('ai_configs')
      // `api_key` is selected only to derive `has_key` — it is stripped
      // out below and never returned to the client.
      .select(
        'provider, model, base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key, receptionist_config'
      )
      .eq('account_id', accountId)
      .maybeSingle();

    if (error && (error as { code?: string }).code === '42703') {
      const fallback = await credentialStore()
        .from('ai_configs')
        .select(
          'provider, model, base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key'
        )
        .eq('account_id', accountId)
        .maybeSingle();
      data = fallback.data
        ? { ...fallback.data, receptionist_config: null }
        : null;
      error = fallback.error;
    }

    if (error) {
      console.error('[ai/config GET] fetch error:', error);
      return NextResponse.json(
        { error: t('ai.loadConfigFailed') },
        { status: 500 }
      );
    }

    if (!data) return NextResponse.json({ configured: false });
    const permission = new URL(request.url).searchParams.has('account_id')
      ? { data: true, error: null }
      : await supabase.rpc('managed_user_can', {
          p_account_id: accountId,
          p_capability: 'ai.configure',
        });
    if (permission.error)
      throw new Error('Could not verify configuration access');
    if (permission.data !== true)
      return NextResponse.json(
        {
          configured: true,
          is_active: data.is_active,
          auto_reply_enabled: data.auto_reply_enabled,
        },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    // The keys are selected only to derive the has_* flags; neither is
    // returned to the client.
    const { api_key, embeddings_api_key, receptionist_config, ...safe } = data;
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      receptionist_config: parseReceptionistConfig(receptionist_config),
      ...safe,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Validates the key with the provider
 * before persisting (mirrors the WhatsApp config verifying with Meta
 * first), then stores the key AES-256-GCM-encrypted. When `api_key` is
 * omitted the existing stored key is reused (the form sends it only
 * when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await configurationContext(
      request,
      'ai.configure'
    );

    const limit = checkRateLimit(
      `ai-config:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object')
      return bad(t('common.invalidRequestBody'));

    const provider = body.provider as AiProvider;
    if (
      provider !== 'openai' &&
      provider !== 'anthropic' &&
      provider !== 'openai_compatible'
    ) {
      return bad(t('ai.providerInvalid'));
    }
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) return bad(t('ai.modelRequired'));

    const baseUrlProvided = 'base_url' in body;
    const requestedBaseUrl =
      typeof body.base_url === 'string' ? body.base_url.trim() : '';

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null;
    const isActive = body.is_active === true;
    const autoReplyEnabled = body.auto_reply_enabled === true;

    let maxPer = Number(body.auto_reply_max_per_conversation);
    if (!Number.isFinite(maxPer)) maxPer = 3;
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)));

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string'
        ? body.handoff_agent_id.trim()
        : '';
    const handoffProvided = 'handoff_agent_id' in body;
    let handoffAgentId: string | null = null;
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle();
      if (!member) return bad(t('ai.handoffNotMember'));
      handoffAgentId = rawHandoff;
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : '';
    const clearEmbeddingsKey = body.embeddings_api_key === null;

    // Reuse the stored key when the form didn't send a fresh one.
    const { data: existing } = await credentialStore()
      .from('ai_configs')
      .select('id, provider, model, base_url, api_key')
      .eq('account_id', accountId)
      .maybeSingle();

    let apiKeyPlain: string;
    let baseUrl: string | null = null;
    if (provider === 'openai_compatible') {
      const candidate = baseUrlProvided
        ? requestedBaseUrl
        : existing?.provider === 'openai_compatible'
          ? (existing.base_url ?? '').trim()
          : '';
      if (!candidate) return bad(t('ai.baseUrlRequired'));
      try {
        normalizeOpenAiCompatibleBaseUrl(candidate);
      } catch (err) {
        return bad(
          err instanceof AiError ? err.message : t('ai.baseUrlInvalid')
        );
      }
      baseUrl = candidate;
    }
    if (rawKey) {
      apiKeyPlain = rawKey;
    } else if (
      existing?.api_key &&
      canReuseStoredAiKey(existing, provider, baseUrl)
    ) {
      try {
        apiKeyPlain = decrypt(existing.api_key);
      } catch {
        return bad(t('ai.storedKeyReenter'));
      }
    } else {
      return bad(t('ai.apiKeyRequired'));
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
      provider !== existing.provider ||
      model !== existing.model ||
      baseUrl !== (existing.base_url ?? null);

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
          baseUrl,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          handoffAgentId: null,
          embeddingsApiKey: null,
        });
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 }
          );
        }
        console.error('[ai/config POST] validation error:', err);
        return bad(t('ai.validateWithProviderFailed'));
      }
    }

    // Validate a new embeddings key before storing (a cheap 1-input
    // embed), same "verify before save" discipline as the chat key.
    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ['ping']);
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            {
              error: t('ai.embeddingsKeyError', { message: err.message }),
              code: err.code,
            },
            { status: 400 }
          );
        }
        console.error('[ai/config POST] embeddings validation error:', err);
        return bad(t('ai.validateEmbeddingsFailed'));
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null;
    const shared: Record<string, unknown> = {
      provider,
      model,
      base_url: baseUrl,
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
    };
    if ('receptionist_config' in body) {
      shared.receptionist_config = parseReceptionistConfig(
        body.receptionist_config
      );
    }
    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId;
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey);
    } else if (clearEmbeddingsKey) {
      shared.embeddings_api_key = null;
    }

    if (existing) {
      const payload = encryptedKey
        ? { ...shared, api_key: encryptedKey }
        : shared;
      let { error: upErr } = await credentialStore()
        .from('ai_configs')
        .update(payload)
        .eq('account_id', accountId);
      if (
        upErr &&
        (upErr as { code?: string }).code === '42703' &&
        'receptionist_config' in payload
      ) {
        const withoutReceptionist = { ...payload };
        delete withoutReceptionist.receptionist_config;
        const retryRes = await credentialStore()
          .from('ai_configs')
          .update(withoutReceptionist)
          .eq('account_id', accountId);
        upErr = retryRes.error;
      }
      if (upErr) {
        console.error('[ai/config POST] update error:', upErr);
        return NextResponse.json(
          { error: t('ai.saveConfigFailed') },
          { status: 500 }
        );
      }
    } else {
      const payload = {
        account_id: accountId,
        created_by: userId,
        api_key: encryptedKey, // guaranteed non-null: rawKey required when no existing row
        ...shared,
      };
      let { error: insErr } = await credentialStore()
        .from('ai_configs')
        .insert(payload);
      if (
        insErr &&
        (insErr as { code?: string }).code === '42703' &&
        'receptionist_config' in payload
      ) {
        const withoutReceptionist = { ...payload };
        delete withoutReceptionist.receptionist_config;
        const retryRes = await credentialStore()
          .from('ai_configs')
          .insert(withoutReceptionist);
        insErr = retryRes.error;
      }
      if (insErr) {
        console.error('[ai/config POST] insert error:', insErr);
        return NextResponse.json(
          { error: t('ai.saveConfigFailed') },
          { status: 500 }
        );
      }
    }

    await recordConfigurationAudit(accountId, userId, 'ai.connection_saved');
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE(request: Request) {
  try {
    const { accountId, userId } = await configurationContext(
      request,
      'ai.configure'
    );
    const { error } = await credentialStore()
      .from('ai_configs')
      .delete()
      .eq('account_id', accountId);
    if (error) {
      console.error('[ai/config DELETE] error:', error);
      return NextResponse.json(
        { error: t('ai.deleteConfigFailed') },
        { status: 500 }
      );
    }
    await recordConfigurationAudit(accountId, userId, 'ai.connection_removed');
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
