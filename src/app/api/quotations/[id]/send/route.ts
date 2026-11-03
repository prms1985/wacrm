import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { isProductId } from '@/lib/products/validation';
import { quotationResponseError } from '@/lib/quotations/repository';
import { QuotationError } from '@/lib/quotations/validation';
import { sendQuotation } from '@/lib/quotations/send';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const { id } = await context.params;
    if (!isProductId(id)) throw new QuotationError('notFound', 404);
    const limit = checkRateLimit(
      `quotation-send:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new QuotationError('invalid');
    return NextResponse.json(
      await sendQuotation(supabase, accountId, userId, id, body)
    );
  } catch (error) {
    return quotationResponseError(error);
  }
}
