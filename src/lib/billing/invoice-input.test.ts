import { describe, expect, it } from 'vitest';
import { readInvoice, MAX_INVOICE_BYTES } from './invoice-input';

function request(patch: Record<string, string> = {}, bytes = '%PDF-1.7\ninvoice', mime = 'application/pdf') {
  const form = new FormData();
  for (const [key,value] of Object.entries({ invoice_id: 'STORE-INV-1', to: '9876543210', consent: 'true', template_name: 'invoice_ready', template_language: 'en', body_params: '["Customer","INV-1"]', ...patch })) form.set(key, value);
  form.set('file', new Blob([bytes], { type: mime }), 'invoice.pdf');
  return new Request('http://localhost/api/v1/invoices', { method: 'POST', body: form });
}
describe('billing invoice input', () => {
  it('normalizes Indian numbers and binds the PDF and recipient to a fingerprint', async () => {
    const first = await readInvoice(request());
    expect(first.to).toBe('+919876543210');
    expect((await readInvoice(request({ to: '+91 98765 43210' }))).fingerprint).toBe(first.fingerprint);
    expect((await readInvoice(request({ to: '+919876543211' }))).fingerprint).not.toBe(first.fingerprint);
    expect((await readInvoice(request({}, '%PDF-1.7\nother'))).fingerprint).not.toBe(first.fingerprint);
  });
  it.each<Record<string, string>>([{consent:'false'}, {consent:''}, {to:'invalid'}, {body_params:'{}'}, {body_params:'[1]'}, {invoice_id:''}])('rejects invalid invoice metadata %j', async patch => {
    await expect(readInvoice(request(patch))).rejects.toThrow();
  });
  it('rejects renamed non-PDF files and oversized uploads', async () => {
    await expect(readInvoice(request({}, 'not a real PDF'))).rejects.toThrow('signature');
    await expect(readInvoice(request({}, '%PDF-1.7', 'text/plain'))).rejects.toThrow('Only PDF');
    await expect(readInvoice(request({}, '%PDF-' + 'a'.repeat(MAX_INVOICE_BYTES)))).rejects.toThrow('5 MB');
  });
  it('bounds streamed bodies without trusting Content-Length', async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_INVOICE_BYTES + 65537)); controller.close(); } });
    const req = new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body, duplex: 'half' } as RequestInit);
    await expect(readInvoice(req)).rejects.toThrow('5 MB');
  });
});
