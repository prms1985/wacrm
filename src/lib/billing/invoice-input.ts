import { createHash } from 'node:crypto';
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils';
import { normalizeTemplatePhoneNumber } from '@/lib/whatsapp/template-phone';
import { SendMessageError } from '@/lib/whatsapp/send-message';

export const MAX_INVOICE_BYTES = 5 * 1024 * 1024;
export function invalid(message: string): never {
  throw new SendMessageError('bad_request', message, 400);
}

export async function readInvoice(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) invalid('Use multipart/form-data with a PDF file.');
  // Bound the stream, not only Content-Length (which callers can omit).
  const reader = request.body?.getReader();
  if (!reader) invalid('Request body is required.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_INVOICE_BYTES + 64 * 1024) { await reader.cancel(); invalid('PDF must be at most 5 MB.'); }
    chunks.push(value);
  }
  let form: FormData;
  try { form = await new Request(request.url, { method: 'POST', headers: { 'content-type': request.headers.get('content-type')! }, body: Buffer.concat(chunks) }).formData(); }
  catch { invalid('Invalid multipart request.'); }
  const field = (key: string, max: number, required = true) => {
    const raw = form.get(key);
    if (raw !== null && typeof raw !== 'string') invalid(`Invalid ${key}.`);
    const value = typeof raw === 'string' ? raw.trim() : '';
    if ((required && !value) || value.length > max || /[\u0000-\u001f]/.test(value)) invalid(`Invalid ${key}.`);
    return value;
  };
  const invoiceId = field('invoice_id', 120);
  const rawPhone = field('to', 40);
  const phone = /^\d{10}$/.test(rawPhone) ? normalizeTemplatePhoneNumber(rawPhone) : parseInternationalPhone(rawPhone);
  if (!phone) invalid('Use a valid +country-code phone number or a 10-digit Indian mobile number.');
  const to = phone.startsWith('+') ? phone : '+' + phone;
  if (field('consent', 5) !== 'true') invalid('Customer permission to receive this invoice is required.');
  const templateName = field('template_name', 512);
  const language = field('template_language', 30);
  const name = field('name', 150, false);
  let body: unknown;
  try { body = JSON.parse(field('body_params', 16000, false) || '[]'); } catch { invalid('body_params must be a JSON array of strings.'); }
  if (!Array.isArray(body) || body.length > 20 || body.some(v => typeof v !== 'string' || !v.trim() || v.length > 1000 || /[\r\n\t\u0000]/.test(v))) invalid('Invalid template body parameters.');
  const file = form.get('file');
  if (!(file instanceof File) || file.size < 8 || file.size > MAX_INVOICE_BYTES) invalid('Provide a PDF file, up to 5 MB.');
  if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) invalid('Only PDF invoices are accepted.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') invalid('File does not have a PDF signature.');
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  const pdfHash = createHash('sha256').update(bytes).digest('hex');
  const fingerprint = createHash('sha256').update(JSON.stringify({ to, templateName, language, body, pdfHash, name })).digest('hex');
  return { invoiceId, to, name, templateName, language, body: body as string[], bytes, filename, fingerprint };
}
