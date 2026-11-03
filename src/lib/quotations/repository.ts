import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { getT } from '@/lib/i18n/translate';
import {
  QUOTATION_COLUMNS,
  type Quotation,
  type QuotationInput,
} from './types';
import { QuotationError } from './validation';

export function checkQuotationDb(error: { code?: string } | null) {
  if (!error) return;
  if (['42P01', 'PGRST202', 'PGRST205'].includes(error.code ?? ''))
    throw new QuotationError('setup', 503);
  if (['40001', '23505'].includes(error.code ?? ''))
    throw new QuotationError('conflict', 409);
  if (error.code === '42501') throw new QuotationError('forbidden', 403);
  if (['22023', '22P02', '23514', '22003'].includes(error.code ?? ''))
    throw new QuotationError('invalid', 400);
  throw new QuotationError('failed', 500);
}
export function quotationResponseError(error: unknown) {
  if (error instanceof QuotationError)
    return NextResponse.json(
      { error: getT('Quotations.errors')(error.code) },
      { status: error.status }
    );
  return toErrorResponse(error);
}
export async function loadQuotation(
  db: SupabaseClient,
  accountId: string,
  id: string
): Promise<Quotation> {
  const { data, error } = await db
    .from('quotations')
    .select(QUOTATION_COLUMNS)
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle();
  checkQuotationDb(error);
  if (!data) throw new QuotationError('notFound', 404);
  return data as Quotation;
}
export async function saveQuotation(
  db: SupabaseClient,
  accountId: string,
  id: string | null,
  input: QuotationInput
): Promise<Quotation> {
  if (!input.items.length) throw new QuotationError('noItems');
  const { data, error } = await db.rpc('save_quotation', {
    p_account_id: accountId,
    p_id: id,
    p_contact_id: input.contact_id,
    p_conversation_id: input.conversation_id,
    p_items: input.items,
    p_details: input.details,
    p_expected_version: input.version,
  });
  checkQuotationDb(error);
  return data as Quotation;
}
