import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { CoexistenceError, requestCoexistenceSync } from './meta';
import {
  hasHistoryContext,
  isCoexistenceChange,
  object,
  parseCoexistenceChange,
} from './payload';

export async function queueCoexistenceEvents(
  db: SupabaseClient,
  body: { entry?: unknown[] }
): Promise<boolean> {
  let queued = false;
  for (const rawEntry of body.entry ?? []) {
    const entry = object(rawEntry);
    if (!Array.isArray(entry.changes)) continue;
    for (const rawChange of entry.changes) {
      const change = object(rawChange),
        value = object(change.value);
      const events: { field: string; value: unknown }[] = [];
      if (
        typeof change.field === 'string' &&
        isCoexistenceChange(change.field, value)
      )
        events.push({ field: change.field, value });
      // Historical media can be delivered on the regular messages topic.
      if (change.field === 'messages' && Array.isArray(value.messages)) {
        const historical = value.messages.filter(hasHistoryContext);
        if (historical.length) {
          events.push({
            field: 'history',
            value: { metadata: value.metadata, messages: historical },
          });
          value.messages = value.messages.filter((m) => !hasHistoryContext(m));
        }
      }
      if (change.field === 'messages' && Array.isArray(value.message_echoes)) {
        const historical = value.message_echoes.filter(hasHistoryContext);
        if (historical.length)
          events.push({
            field: 'history',
            value: { metadata: value.metadata, message_echoes: historical },
          });
      }
      for (const event of events) {
        const key = createHash('sha256')
          .update(JSON.stringify([entry.id, event.field, event.value]))
          .digest('hex');
        const { data, error } = await db.rpc('enqueue_whatsapp_coexistence', {
          p_waba_id: entry.id,
          p_field: event.field,
          p_value: event.value,
          p_event_key: key,
        });
        if (error)
          throw new Error(
            'Could not persist WhatsApp Business app event. Apply migration 066 and check database access.'
          );
        queued ||= typeof data === 'string';
      }
    }
  }
  return queued;
}

export async function drainCoexistenceEvents(
  db: SupabaseClient,
  accountId?: string
) {
  let query = db
    .from('whatsapp_coexistence_events')
    .select('id,field,payload,attempts,processed_items')
    .is('processed_at', null)
    .lt('attempts', 5)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(20);
  if (accountId) query = query.eq('account_id', accountId);
  const { data, error } = await query;
  if (error)
    throw new CoexistenceError(
      'WhatsApp synchronization storage is unavailable. Apply migration 066.',
      503
    );
  let processed = 0;
  for (const row of data ?? []) {
    try {
      const batch = parseCoexistenceChange(row.field, row.payload);
      const items = [
        ...batch.contacts.map((contact) => ({ contact })),
        ...batch.messages.map((message) => ({ message })),
      ];
      // Bound each transaction so a large history payload does not hit the
      // database statement timeout. Its saved cursor makes a retry resumable.
      for (
        let offset = row.processed_items;
        offset < items.length || (offset === 0 && items.length === 0);
        offset += 200
      ) {
        const chunk = items.slice(offset, offset + 200);
        const done = offset + 200 >= items.length;
        const { error: applyError } = await db.rpc(
          'apply_whatsapp_coexistence_event',
          {
            p_event_id: row.id,
            p_batch: {
              ...batch,
              offset,
              done,
              history_status: done ? batch.history_status : null,
              history_progress: done ? batch.history_progress : 0,
              contacts: chunk.flatMap((item) =>
                'contact' in item ? [item.contact] : []
              ),
              messages: chunk.flatMap((item) =>
                'message' in item ? [item.message] : []
              ),
            },
          }
        );
        if (applyError)
          throw new Error('Could not apply synchronization event.');
      }
      processed++;
    } catch {
      await db
        .from('whatsapp_coexistence_events')
        .update({
          attempts: row.attempts + 1,
          last_error:
            'Import failed. Check migration 066 and retry synchronization.',
        })
        .eq('id', row.id)
        .is('processed_at', null);
    }
  }
  return { processed };
}

export async function startCoexistenceSync(
  db: SupabaseClient,
  accountId: string
) {
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('phone_number_id,access_token,status')
    .eq('account_id', accountId)
    .eq('connection_mode', 'coexistence')
    .maybeSingle();
  if (error || !config || config.status !== 'connected')
    throw new CoexistenceError(
      'Connect your WhatsApp Business app before synchronizing.',
      409
    );
  const { data: current } = await db
    .from('whatsapp_coexistence')
    .select('connected_at,disconnected_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!current || current.disconnected_at)
    throw new CoexistenceError(
      'Reconnect your WhatsApp Business app before synchronizing.',
      409
    );
  if (Date.now() - Date.parse(current.connected_at) > 24 * 60 * 60 * 1000)
    throw new CoexistenceError(
      'The initial data-sharing window has ended. Reconnect through Meta to request a new import.',
      409
    );
  const token = decrypt(config.access_token);
  for (const [column, type] of [
    ['contacts', 'smb_app_state_sync'],
    ['history', 'history'],
  ] as const) {
    // A timeout is ambiguous: never automatically repeat a one-shot Meta
    // operation. Only pending or definitively rejected requests are retryable.
    const { data: claimed, error: claimError } = await db
      .from('whatsapp_coexistence')
      .update({ [`${column}_status`]: 'requesting', [`${column}_error`]: null })
      .eq('account_id', accountId)
      .is('disconnected_at', null)
      .in(`${column}_status`, ['pending', 'failed'])
      .select('account_id');
    if (claimError)
      throw new CoexistenceError(
        'Could not reserve the data import. Check database access.',
        503
      );
    if (!claimed?.length) continue;
    try {
      const requestId = await requestCoexistenceSync(
        token,
        config.phone_number_id,
        type
      );
      const saved = await db
        .from('whatsapp_coexistence')
        .update({ [`${column}_request_id`]: requestId })
        .eq('account_id', accountId);
      if (saved.error) throw new Error('Could not save the sync reference.');
      await db
        .from('whatsapp_coexistence')
        .update({ [`${column}_status`]: 'requested' })
        .eq('account_id', accountId)
        .eq(`${column}_status`, 'requesting');
    } catch (err) {
      // Even HTTP errors can be produced after Meta starts processing. A
      // reconnect, rather than a blind retry, is needed for uncertain results.
      await db
        .from('whatsapp_coexistence')
        .update({
          [`${column}_status`]: 'unknown',
          [`${column}_error`]:
            err instanceof CoexistenceError
              ? err.message
              : 'The import request could not be confirmed. Refresh status before reconnecting.',
        })
        .eq('account_id', accountId)
        .eq(`${column}_status`, 'requesting');
    }
  }
}
