import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole } from '@/lib/auth/account';
import { QUOTATION_COLUMNS, QUOTATION_STATUSES } from '@/lib/quotations/types';
import {
  parseQuotationInput,
  QuotationError,
} from '@/lib/quotations/validation';
import {
  checkQuotationDb,
  quotationResponseError,
  saveQuotation,
} from '@/lib/quotations/repository';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const params = new URL(request.url).searchParams;
    const pageText = params.get('page') ?? '1',
      status = params.get('status') ?? 'all',
      q = (params.get('q') ?? '').trim();
    if (
      !/^[1-9]\d{0,5}$/.test(pageText) ||
      (!QUOTATION_STATUSES.includes(status as never) && status !== 'all') ||
      q.length > 100
    )
      throw new QuotationError('invalid');
    const page = Number(pageText),
      size = 25;
    let query = supabase
      .from('quotations')
      .select(QUOTATION_COLUMNS, { count: 'exact' })
      .eq('account_id', accountId);
    if (status !== 'all') query = query.eq('status', status);
    if (q)
      query = query.ilike('reference', `%${q.replace(/[\\%_]/g, '\\$&')}%`);
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range((page - 1) * size, page * size - 1);
    checkQuotationDb(error);
    return NextResponse.json({
      quotations: data ?? [],
      total: count ?? 0,
      page,
      page_size: size,
    });
  } catch (error) {
    return quotationResponseError(error);
  }
}
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const input = parseQuotationInput(await request.json().catch(() => null));
    return NextResponse.json(
      { quotation: await saveQuotation(supabase, accountId, null, input) },
      { status: 201 }
    );
  } catch (error) {
    return quotationResponseError(error);
  }
}
