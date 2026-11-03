import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({auth:vi.fn(),submit:vi.fn(),history:vi.fn()}));
vi.mock('@/lib/auth/api-context',()=>({requireApiKey:h.auth}));
vi.mock('@/lib/billing/invoices',()=>({submitInvoice:h.submit,invoiceHistory:h.history}));
import { POST, GET } from './route';
import { ApiError } from '@/lib/api/v1/respond';
import { SendMessageError } from '@/lib/whatsapp/send-message';
beforeEach(()=>{h.auth.mockReset().mockResolvedValue({supabase:{},accountId:'account-1'});h.submit.mockReset().mockResolvedValue({state:'accepted'});h.history.mockReset().mockResolvedValue([])});
describe('invoice API authentication and error boundaries',()=>{
  it('requires a send-scoped key before processing a PDF',async()=>{
    h.auth.mockRejectedValue(new ApiError('unauthorized','Missing or invalid API key',401));
    const response=await POST(new Request('http://localhost/api/v1/invoices',{method:'POST'}));
    expect(response.status).toBe(401);expect(h.submit).not.toHaveBeenCalled();
  });
  it('uses the key account rather than a caller-supplied account',async()=>{
    const req=new Request('http://localhost/api/v1/invoices?account_id=other',{method:'POST'});
    expect((await POST(req)).status).toBe(200);
    expect(h.auth).toHaveBeenCalledWith(req,'messages:send');expect(h.submit).toHaveBeenCalledWith({},'account-1',req);
  });
  it('requires read scope for status lookup and scopes the invoice filter',async()=>{
    const req=new Request('http://localhost/api/v1/invoices?invoice_id=INV-1');await GET(req);
    expect(h.auth).toHaveBeenCalledWith(req,'messages:read');expect(h.history).toHaveBeenCalledWith({},'account-1','INV-1');
  });
  it('preserves conflict errors without silently resending',async()=>{
    h.submit.mockRejectedValue(new SendMessageError('invoice_conflict','Different invoice details',409));
    const response=await POST(new Request('http://localhost'));expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('invoice_conflict');
  });
});
