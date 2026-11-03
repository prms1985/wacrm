import type { SupabaseClient } from '@supabase/supabase-js';
import { readInvoice, invalid } from './invoice-input';
import { resolveTemplateRow } from '@/lib/whatsapp/template-body';
import { buildSendComponents } from '@/lib/whatsapp/template-send-builder';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message';
import { uploadInvoiceMedia } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';

function dbFailure(): never { throw new SendMessageError('billing_unavailable', 'Invoice storage is unavailable. Apply the billing migration and check the server service-role configuration.', 503); }

export async function submitInvoice(db: SupabaseClient, accountId: string, request: Request) {
  const input = await readInvoice(request);
  // Exact account/language template; never use an unsynced or rejected template.
  const resolved = await resolveTemplateRow(db, accountId, input.templateName, input.language);
  const template = resolved.row;
  if (resolved.malformed || !template || template.language !== input.language || template.header_type !== 'document' || template.category.toLowerCase() !== 'utility' || template.status?.toLowerCase() !== 'approved') invalid('Select a synced, approved Utility template with a document header in the requested language.');
  try { buildSendComponents(template, { body: input.body, headerMediaId: 'validate-only' }); }
  catch { invalid('Template parameters are missing or incompatible. Use a document template without dynamic buttons.'); }

  const { data: reservation, error } = await db.from('billing_invoice_deliveries').insert({ account_id: accountId, invoice_id: input.invoiceId, fingerprint: input.fingerprint, recipient: input.to, filename: input.filename }).select('id').single();
  if (error) {
    if (error.code !== '23505') dbFailure();
    const { data: prior, error: priorError } = await db.from('billing_invoice_deliveries').select('*').eq('account_id', accountId).eq('invoice_id', input.invoiceId).single();
    if (priorError || !prior) dbFailure();
    if (prior.fingerprint !== input.fingerprint) throw new SendMessageError('invoice_conflict', 'This invoice reference was already used with different PDF or recipient details.', 409);
    if (prior.state === 'accepted') return { invoice_id: prior.invoice_id, state: prior.state, message_id: prior.message_id, whatsapp_message_id: prior.whatsapp_message_id, duplicate: true };
    throw new SendMessageError('invoice_reserved', 'This invoice is already processing or requires review. Check delivery history before any further send; it will not be automatically resent.', 409);
  }
  if (!reservation) dbFailure();
  let sending = false;
  const update = async (patch: Record<string, unknown>) => {
    const result = await db.from('billing_invoice_deliveries').update({ ...patch, updated_at: new Date().toISOString() }).eq('account_id', accountId).eq('id', reservation.id);
    if (result.error) dbFailure();
  };
  try {
    const { data: config, error: configError } = await db.from('whatsapp_config').select('phone_number_id, access_token').eq('account_id', accountId).single();
    if (configError || !config) invalid('Connect the official WhatsApp API first.');
    const media = await uploadInvoiceMedia({ phoneNumberId: config.phone_number_id, accessToken: decrypt(config.access_token), bytes: input.bytes, filename: input.filename });
    const conversation = await resolveConversationByPhone(db, accountId, input.to, input.name || null);
    await update({ state: 'sending', media_id: media.id, conversation_id: conversation.conversationId });
    sending = true;
    const result = await sendMessageToConversation(db, accountId, { conversationId: conversation.conversationId, messageType: 'template', templateName: input.templateName, templateLanguage: input.language, templateMessageParams: { body: input.body, headerMediaId: media.id } });
    await update({ state: 'accepted', message_id: result.messageId, whatsapp_message_id: result.whatsappMessageId });
    return { invoice_id: input.invoiceId, state: 'accepted', message_id: result.messageId, whatsapp_message_id: result.whatsappMessageId, duplicate: false };
  } catch (err) {
    // Any error after entering the send path may mean Meta accepted it.
    // Never retry automatically: sendMessage may fail AFTER provider acceptance.
    await update({ state: sending ? 'unknown' : 'failed' }).catch(() => undefined);
    if (sending) throw new SendMessageError('invoice_outcome_unknown', 'The send outcome needs review. Do not resend. Check the inbox, Meta delivery status and invoice history.', 502);
    if (err instanceof SendMessageError) throw err;
    throw new SendMessageError('invoice_failed', 'Invoice preparation failed. Check the official WhatsApp connection before reviewing this invoice.', 502);
  }
}

export async function invoiceHistory(db: SupabaseClient, accountId: string, invoiceId?: string | null) {
  let query = db.from('billing_invoice_deliveries').select('invoice_id, recipient, filename, state, message_id, whatsapp_message_id, conversation_id, created_at, updated_at').eq('account_id', accountId).order('created_at', { ascending: false }).limit(30);
  if (invoiceId) query = query.eq('invoice_id', invoiceId);
  const { data, error } = await query;
  if (error) dbFailure();
  const ids = (data || []).map(row => row.message_id).filter(Boolean);
  const statuses = new Map<string, string>();
  if (ids.length) {
    const { data: messages, error: msgError } = await db.from('messages').select('id, status, conversations!inner(account_id)').in('id', ids).eq('conversations.account_id', accountId);
    if (msgError) dbFailure();
    for (const message of messages || []) statuses.set(message.id, message.status);
  }
  return (data || []).map(row => ({ ...row, delivery_status: statuses.get(row.message_id) || null }));
}
