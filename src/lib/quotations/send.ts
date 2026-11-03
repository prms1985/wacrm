import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { loadAccountMetaCredentials } from '@/lib/flows/meta-send';
import { uploadInvoiceMedia } from '@/lib/whatsapp/meta-api';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { resolveContactSendTarget } from '@/lib/whatsapp/wa-identity';
import { buildSendComponents } from '@/lib/whatsapp/template-send-builder';
import type { MessageTemplate } from '@/types';
import { loadQuotation, checkQuotationDb } from './repository';
import { QuotationError, positiveVersion } from './validation';
import { quotationPdf } from './pdf';
import type { Quotation } from './types';

export function sessionIsOpen(
  lastInbound: string | null,
  now = Date.now()
): boolean {
  if (!lastInbound) return false;
  const time = Date.parse(lastInbound);
  return (
    Number.isFinite(time) && time <= now && now - time < 24 * 60 * 60 * 1000
  );
}

export async function sendQuotation(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  id: string,
  body: Record<string, unknown>
) {
  const version = positiveVersion(body.version);
  const quote = await loadQuotation(db, accountId, id);
  if (
    quote.status !== 'approved' ||
    quote.version !== version ||
    quote.valid_until < new Date().toISOString().slice(0, 10)
  )
    throw new QuotationError('notApproved', 409);
  if (!quote.contact_id) throw new QuotationError('contact');
  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('phone,wa_user_id')
    .eq('account_id', accountId)
    .eq('id', quote.contact_id)
    .maybeSingle();
  checkQuotationDb(contactError);
  const approvedTarget = resolveContactSendTarget(quote.customer);
  const currentTarget = contact ? resolveContactSendTarget(contact) : null;
  if (
    !approvedTarget ||
    !currentTarget ||
    approvedTarget.target !== currentTarget.target
  )
    throw new QuotationError('contactChanged', 409);
  let conversationId = quote.conversation_id;
  if (!conversationId) {
    const { data, error } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', quote.contact_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    checkQuotationDb(error);
    conversationId = data?.id;
  }
  if (!conversationId) throw new QuotationError('noConversation');
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('id,contact_id')
    .eq('account_id', accountId)
    .eq('id', conversationId)
    .eq('contact_id', quote.contact_id)
    .maybeSingle();
  checkQuotationDb(convError);
  if (!conversation) throw new QuotationError('contact');
  const { data: inbound, error: inboundError } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  checkQuotationDb(inboundError);
  let template: MessageTemplate | null = null;
  const params = body.body_params ?? [];
  if (
    !Array.isArray(params) ||
    params.length > 20 ||
    params.some((value) => typeof value !== 'string' || value.length > 1000)
  )
    throw new QuotationError('invalidTemplate');
  if (body.template_id) {
    const { data, error } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('id', body.template_id)
      .maybeSingle();
    checkQuotationDb(error);
    if (
      !data ||
      data.status?.toLowerCase() !== 'approved' ||
      data.header_type !== 'document'
    )
      throw new QuotationError('invalidTemplate');
    template = data as MessageTemplate;
    try {
      buildSendComponents(template, {
        body: params,
        headerMediaId: 'validate-only',
      });
    } catch {
      throw new QuotationError('invalidTemplate');
    }
  } else if (!sessionIsOpen(inbound?.created_at ?? null))
    throw new QuotationError('templateRequired');
  const bytes = await quotationPdf(quote);
  const admin = supabaseAdmin();
  const credentials = await loadAccountMetaCredentials(admin, accountId);
  const { data: claimed, error: claimError } = await db.rpc(
    'claim_quotation_send',
    { p_account_id: accountId, p_id: id, p_version: version }
  );
  checkQuotationDb(claimError);
  const claim = claimed as Quotation;
  let started = false;
  async function finish(outcome: string, messageId: string | null = null) {
    const { error } = await admin.rpc('finish_quotation_send', {
      p_account_id: accountId,
      p_id: id,
      p_attempt: claim.send_attempt_id,
      p_outcome: outcome,
      p_message_id: messageId,
    });
    checkQuotationDb(error);
  }
  try {
    const media = await uploadInvoiceMedia({
      ...credentials,
      bytes,
      filename: `${quote.reference}.pdf`,
    });
    started = true;
    const result = await sendMessageToConversation(admin, accountId, {
      conversationId,
      expectedRecipient: approvedTarget.target,
      senderId: userId,
      messageType: template ? 'template' : 'document',
      templateName: template?.name,
      templateLanguage: template?.language,
      templateMessageParams: template
        ? {
            body: params,
            headerMediaId: media.id,
            headerMediaUrl: `/api/whatsapp/media/${encodeURIComponent(media.id)}`,
          }
        : undefined,
      mediaId: template ? undefined : media.id,
      filename: `${quote.reference}.pdf`,
      contentText: template ? undefined : quote.reference,
    });
    await finish('sent', result.messageId);
    return { message_id: result.messageId };
  } catch (error) {
    if (
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'recipient_changed'
    ) {
      await finish('approved').catch(() => undefined);
      throw new QuotationError('contactChanged', 409);
    }
    await finish(started ? 'send_unknown' : 'approved').catch(() => undefined);
    throw new QuotationError(started ? 'sendUnknown' : 'sendFailed', 502);
  }
}
