import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({
  input: { invoiceId:'INV-1', to:'+919876543210', name:'Customer', templateName:'invoice_ready', language:'en', body:['Customer','INV-1'], bytes:new Uint8Array([1]), filename:'invoice.pdf', fingerprint:'hash1' },
  template: { id:'t1', user_id:'u1', name:'invoice_ready', language:'en', category:'Utility', status:'approved', header_type:'document', body_text:'Hi {{1}}, invoice {{2}}' } as Record<string, unknown>,
  send:vi.fn(), upload:vi.fn(), resolve:vi.fn(),
}));
vi.mock('./invoice-input', () => ({ readInvoice:async()=>h.input, invalid:(message:string)=>{throw new Error(message)} }));
vi.mock('@/lib/whatsapp/template-body', () => ({ resolveTemplateRow:async()=>({row:h.template,malformed:false}) }));
vi.mock('@/lib/whatsapp/meta-api', () => ({ uploadInvoiceMedia:h.upload }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt:()=> 'fake-token' }));
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({ resolveConversationByPhone:h.resolve }));
vi.mock('@/lib/whatsapp/send-message', () => ({ sendMessageToConversation:h.send, SendMessageError:class extends Error { constructor(public code:string,message:string,public status:number){super(message)} } }));
import { submitInvoice } from './invoices';

type Row = Record<string, unknown>;
function database() {
  const rows = new Map<string, Row>();
  const updates:Row[]=[];
  const db = { from(table:string) {
    let action='select', values:Row={};
    const filters:Row={};
    const q = {
      insert(v:Row){action='insert';values=v;return q},
      update(v:Row){action='update';values=v;return q},
      select(){return q}, eq(k:string,v:unknown){filters[k]=v;return q},
      single:async()=>perform(),
      then(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown){return Promise.resolve(perform()).then(resolve,reject)},
    };
    function perform() {
      if(table==='whatsapp_config') { expect(filters.account_id).toBe('account-1'); return {data:{phone_number_id:'123',access_token:'encrypted'},error:null}; }
      const key=String(values.account_id||filters.account_id)+':'+String(values.invoice_id||filters.invoice_id||'INV-1');
      if(action==='insert') { if(rows.has(key))return {data:null,error:{code:'23505'}}; const row={id:'delivery-1',state:'processing',...values};rows.set(key,row);return {data:row,error:null}; }
      if(action==='update'){expect(filters.account_id).toBe('account-1');updates.push(values);Object.assign(rows.get(key)!,values);return {data:null,error:null}}
      return {data:rows.get(key),error:null};
    }
    return q;
  }};
  return { db:db as unknown as SupabaseClient, rows, updates };
}
beforeEach(()=>{
  h.input.fingerprint='hash1';h.template.status='approved';
  h.send.mockReset().mockResolvedValue({messageId:'message-1',whatsappMessageId:'wamid-1'});
  h.upload.mockReset().mockResolvedValue({id:'456'});
  h.resolve.mockReset().mockResolvedValue({conversationId:'conversation-1'});
});
describe('invoice delivery reservation',()=>{
  it('sends the uploaded PDF with the approved template and replays a duplicate',async()=>{
    const {db,rows}=database();const request=new Request('http://localhost');
    const first=await submitInvoice(db,'account-1',request);
    expect(first.state).toBe('accepted');
    expect(h.send.mock.calls[0][2]).toMatchObject({messageType:'template',templateMessageParams:{headerMediaId:'456',body:['Customer','INV-1']}});
    expect((await submitInvoice(db,'account-1',request)).duplicate).toBe(true);
    expect(h.send).toHaveBeenCalledTimes(1);expect(h.upload).toHaveBeenCalledTimes(1);
    expect(rows.get('account-1:INV-1')?.state).toBe('accepted');
  });
  it('rejects reuse with changed recipient/PDF details',async()=>{
    const {db}=database();await submitInvoice(db,'account-1',new Request('http://localhost'));
    h.input.fingerprint='different';
    await expect(submitInvoice(db,'account-1',new Request('http://localhost'))).rejects.toMatchObject({code:'invoice_conflict'});
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('does not send twice for concurrent print events',async()=>{
    const {db}=database();const results=await Promise.allSettled([submitInvoice(db,'account-1',new Request('http://localhost')),submitInvoice(db,'account-1',new Request('http://localhost'))]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('marks an uncertain send for review and never automatically retries',async()=>{
    const {db,rows}=database();h.send.mockRejectedValue(new Error('saved failed after Meta accepted'));
    await expect(submitInvoice(db,'account-1',new Request('http://localhost'))).rejects.toMatchObject({code:'invoice_outcome_unknown'});
    expect(rows.get('account-1:INV-1')?.state).toBe('unknown');
    await expect(submitInvoice(db,'account-1',new Request('http://localhost'))).rejects.toMatchObject({code:'invoice_reserved'});
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('does not send or reserve a rejected template',async()=>{
    const {db,rows}=database();h.template.status='rejected';
    await expect(submitInvoice(db,'account-1',new Request('http://localhost'))).rejects.toThrow('approved Utility');
    expect(rows.size).toBe(0);expect(h.upload).not.toHaveBeenCalled();expect(h.send).not.toHaveBeenCalled();
  });
  it('fails before sending when media preparation fails',async()=>{
    const {db,rows}=database();h.upload.mockRejectedValue(new Error('upload failed'));
    await expect(submitInvoice(db,'account-1',new Request('http://localhost'))).rejects.toMatchObject({code:'invoice_failed'});
    expect(rows.get('account-1:INV-1')?.state).toBe('failed');expect(h.send).not.toHaveBeenCalled();
  });
});
