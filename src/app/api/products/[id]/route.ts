import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { PRODUCT_COLUMNS } from '@/lib/products/types';
import {
  isProductId,
  parseArchiveInput,
  parseProductInput,
} from '@/lib/products/validation';
import {
  productDatabaseError,
  productError,
  productNotFound,
} from '@/lib/products/responses';

type Context = { params: Promise<{ id: string }> };

async function update(
  request: Request,
  context: Context,
  archiveOnly: boolean
) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await context.params;
    if (!isProductId(id)) return productNotFound();
    const body: unknown = await request.json().catch(() => null);
    const input = archiveOnly
      ? { is_active: parseArchiveInput(body) }
      : parseProductInput(body);
    const { data, error } = await supabase
      .from('products')
      .update(input)
      .eq('account_id', accountId)
      .eq('id', id)
      .select(PRODUCT_COLUMNS)
      .maybeSingle();
    if (error) return productDatabaseError(error);
    if (!data) return productNotFound();
    return NextResponse.json({ product: data });
  } catch (err) {
    return productError(err);
  }
}

export async function PUT(request: Request, context: Context) {
  return update(request, context, false);
}

export async function PATCH(request: Request, context: Context) {
  return update(request, context, true);
}
