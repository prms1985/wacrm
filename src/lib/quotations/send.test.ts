import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({
  quote: {
    id: 'quote',
    version: 1,
    status: 'approved',
    contact_id: 'contact',
    conversation_id: 'conversation',
    valid_until: '2099-12-31',
    reference: 'Q-TEST',
    send_attempt_id: 'attempt',
    customer: { name: 'Customer', phone: '+919999999999', wa_user_id: null },
  },
  load: vi.fn(),
  pdf: vi.fn(),
  credentials: vi.fn(),
  upload: vi.fn(),
  send: vi.fn(),
  finish: vi.fn(),
  claim: vi.fn(),
  lastInbound: new Date().toISOString(),
}));
vi.mock('./repository', () => ({
  loadQuotation: h.load,
  checkQuotationDb: (error: unknown) => {
    if (error) throw new Error('database failure');
  },
}));
vi.mock('./pdf', () => ({ quotationPdf: h.pdf }));
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: h.finish }),
}));
vi.mock('@/lib/flows/meta-send', () => ({
  loadAccountMetaCredentials: h.credentials,
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({ uploadInvoiceMedia: h.upload }));
vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: h.send,
}));
import { sendQuotation, sessionIsOpen } from './send';

function db() {
  return {
    rpc: h.claim,
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          error: null,
          data:
            table === 'contacts'
              ? { phone: '+919999999999', wa_user_id: null }
              : table === 'messages'
                ? { created_at: h.lastInbound }
                : { id: 'conversation', contact_id: 'contact' },
        }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}
beforeEach(() => {
  h.load.mockResolvedValue({ ...h.quote });
  h.pdf.mockResolvedValue(new Uint8Array([1]));
  h.credentials.mockResolvedValue({
    phoneNumberId: '123',
    accessToken: 'secret',
  });
  h.upload.mockResolvedValue({ id: '555' });
  h.send.mockResolvedValue({
    messageId: 'message',
    whatsappMessageId: 'wamid',
  });
  h.claim.mockResolvedValue({
    data: { ...h.quote, status: 'sending' },
    error: null,
  });
  h.finish.mockResolvedValue({ error: null });
  h.lastInbound = new Date().toISOString();
});
describe('approved quotation delivery', () => {
  it('requires approval before any upload or external send', async () => {
    h.load.mockResolvedValue({ ...h.quote, status: 'draft' });
    await expect(
      sendQuotation(db(), 'account', 'user', 'quote', { version: 1 })
    ).rejects.toMatchObject({ code: 'notApproved' });
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
  it('requires review again if the customer send target changes after approval', async () => {
    h.load.mockResolvedValue({
      ...h.quote,
      customer: { ...h.quote.customer, phone: '+918888888888' },
    });
    await expect(
      sendQuotation(db(), 'account', 'user', 'quote', { version: 1 })
    ).rejects.toMatchObject({ code: 'contactChanged' });
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });
  it('requires a template outside the customer service window', async () => {
    h.lastInbound = '2020-01-01T00:00:00Z';
    await expect(
      sendQuotation(db(), 'account', 'user', 'quote', { version: 1 })
    ).rejects.toMatchObject({ code: 'templateRequired' });
    expect(h.claim).not.toHaveBeenCalled();
  });
  it('claims once and sends a private media ID to the linked conversation', async () => {
    await sendQuotation(db(), 'account', 'user', 'quote', { version: 1 });
    expect(h.claim).toHaveBeenCalledWith(
      'claim_quotation_send',
      expect.objectContaining({ p_account_id: 'account', p_version: 1 })
    );
    expect(h.send).toHaveBeenCalledWith(
      expect.anything(),
      'account',
      expect.objectContaining({
        conversationId: 'conversation',
        mediaId: '555',
        messageType: 'document',
      })
    );
    expect(h.finish).toHaveBeenCalledWith(
      'finish_quotation_send',
      expect.objectContaining({ p_outcome: 'sent', p_message_id: 'message' })
    );
  });
  it('restores approval for a preparation failure before the send starts', async () => {
    h.upload.mockRejectedValue(new Error('upload failed'));
    await expect(
      sendQuotation(db(), 'account', 'user', 'quote', { version: 1 })
    ).rejects.toMatchObject({ code: 'sendFailed' });
    expect(h.finish).toHaveBeenCalledWith(
      'finish_quotation_send',
      expect.objectContaining({ p_outcome: 'approved' })
    );
    expect(h.send).not.toHaveBeenCalled();
  });
  it('records uncertain outcomes without automatically retrying', async () => {
    h.send.mockRejectedValue(new Error('timeout after provider acceptance'));
    await expect(
      sendQuotation(db(), 'account', 'user', 'quote', { version: 1 })
    ).rejects.toMatchObject({ code: 'sendUnknown' });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.finish).toHaveBeenCalledWith(
      'finish_quotation_send',
      expect.objectContaining({ p_outcome: 'send_unknown' })
    );
  });
  it('rejects invalid and future session timestamps', () => {
    expect(sessionIsOpen('invalid')).toBe(false);
    expect(sessionIsOpen(new Date(Date.now() + 60000).toISOString())).toBe(
      false
    );
  });
});
