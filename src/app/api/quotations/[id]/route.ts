import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole } from '@/lib/auth/account';
import { isProductId } from '@/lib/products/validation';
import {
  loadQuotation,
  quotationResponseError,
  saveQuotation,
  checkQuotationDb,
} from '@/lib/quotations/repository';
import {
  parseQuotationInput,
  positiveVersion,
  QuotationError,
} from '@/lib/quotations/validation';

type Context = { params: Promise<{ id: string }> };
async function idFrom(context: Context) {
  const { id } = await context.params;
  if (!isProductId(id)) throw new QuotationError('notFound', 404);
  return id;
}
export async function GET(_request: Request, context: Context) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    return NextResponse.json({
      quotation: await loadQuotation(
        supabase,
        accountId,
        await idFrom(context)
      ),
    });
  } catch (error) {
    return quotationResponseError(error);
  }
}
export async function PUT(request: Request, context: Context) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const id = await idFrom(context),
      input = parseQuotationInput(await request.json().catch(() => null));
    if (!input.version) throw new QuotationError('invalid');
    return NextResponse.json({
      quotation: await saveQuotation(supabase, accountId, id, input),
    });
  } catch (error) {
    return quotationResponseError(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const id = await idFrom(context);
    const body = await request.json().catch(() => null);
    if (
      !body ||
      !['approve', 'reopen', 'cancel', 'accept', 'reject'].includes(body.action)
    )
      throw new QuotationError('invalid');
    if (['approve', 'reopen'].includes(body.action)) await requireRole('admin');
    const { data, error } = await supabase.rpc('transition_quotation', {
      p_account_id: accountId,
      p_id: id,
      p_action: body.action,
      p_version: positiveVersion(body.version),
    });
    checkQuotationDb(error);
    return NextResponse.json({ quotation: data });
  } catch (error) {
    return quotationResponseError(error);
  }
}
