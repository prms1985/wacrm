import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole } from '@/lib/auth/account';
import { PRODUCT_COLUMNS } from '@/lib/products/types';
import {
  parseProductInput,
  parseProductQuery,
} from '@/lib/products/validation';
import { productDatabaseError, productError } from '@/lib/products/responses';

const PAGE_SIZE = 25;

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { page, status, kind, q } = parseProductQuery(
      new URL(request.url).searchParams
    );
    let query = supabase
      .from('products')
      .select(PRODUCT_COLUMNS, { count: 'exact' })
      .eq('account_id', accountId);
    if (status !== 'all') query = query.eq('is_active', status === 'active');
    if (kind !== 'all') query = query.eq('kind', kind);
    // A single generated column avoids interpolating user input into an OR expression.
    if (q)
      query = query.ilike('search_text', `%${q.replace(/[\\%_]/g, '\\$&')}%`);
    const { data, count, error } = await query
      .order('name')
      .order('id')
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (error) return productDatabaseError(error);
    return NextResponse.json({
      products: data ?? [],
      total: count ?? 0,
      page,
      page_size: PAGE_SIZE,
    });
  } catch (err) {
    return productError(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const input = parseProductInput(await request.json().catch(() => null));
    const { data, error } = await supabase
      .from('products')
      .insert({ ...input, account_id: accountId, created_by: userId })
      .select(PRODUCT_COLUMNS)
      .single();
    if (error) return productDatabaseError(error);
    return NextResponse.json({ product: data }, { status: 201 });
  } catch (err) {
    return productError(err);
  }
}
