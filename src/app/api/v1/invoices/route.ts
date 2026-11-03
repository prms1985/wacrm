import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { submitInvoice, invoiceHistory } from '@/lib/billing/invoices';
import { SendMessageError } from '@/lib/whatsapp/send-message';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    return ok(await submitInvoice(ctx.supabase, ctx.accountId, request), 200);
  } catch (err) {
    if (err instanceof SendMessageError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:read');
    return ok(await invoiceHistory(ctx.supabase, ctx.accountId, new URL(request.url).searchParams.get('invoice_id')));
  } catch (err) {
    if (err instanceof SendMessageError) return fail(err.code, err.message, err.status);
    return toApiErrorResponse(err);
  }
}
