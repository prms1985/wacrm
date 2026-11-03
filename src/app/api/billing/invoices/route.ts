import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { ok, fail } from '@/lib/api/v1/respond';
import { submitInvoice, invoiceHistory } from '@/lib/billing/invoices';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`billing:${ctx.accountId}`, RATE_LIMITS.whatsappAdmin);
    if (!limit.success) return rateLimitResponse(limit);
    return ok(await submitInvoice(supabaseAdmin(), ctx.accountId, request));
  } catch (err) {
    if (err instanceof SendMessageError) return fail(err.code, err.message, err.status);
    return toErrorResponse(err);
  }
}
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const db = supabaseAdmin();
    const history = await invoiceHistory(db, ctx.accountId);
    const { data: templates, error } = await db.from('message_templates').select('name, language, body_text, category, status, header_type').eq('account_id', ctx.accountId);
    if (error) return fail('billing_unavailable', 'Could not load invoice templates.', 503);
    return ok({ history, templates: (templates || []).filter(t => t.category?.toLowerCase() === 'utility' && t.status?.toLowerCase() === 'approved' && t.header_type === 'document') });
  } catch (err) {
    if (err instanceof SendMessageError) return fail(err.code, err.message, err.status);
    return toErrorResponse(err);
  }
}
