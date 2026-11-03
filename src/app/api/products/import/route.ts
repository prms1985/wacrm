import { NextResponse } from 'next/server';
import { configurationContext } from '@/lib/managed/access';
import { MAX_PRODUCT_CSV_BYTES, parseProductCsv } from '@/lib/products/csv';
import { ProductInputError } from '@/lib/products/validation';
import { productDatabaseError, productError } from '@/lib/products/responses';

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await configurationContext(
      request,
      'catalogue.manage'
    );
    if (
      Number(request.headers.get('content-length')) >
      MAX_PRODUCT_CSV_BYTES + 8192
    ) {
      throw new ProductInputError('csvSize');
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new ProductInputError('csvFile');
    if (file.size > MAX_PRODUCT_CSV_BYTES)
      throw new ProductInputError('csvSize');
    const products = parseProductCsv(await file.text());
    // A single INSERT is atomic: any conflict rejects the entire import.
    const { data, error } = await supabase
      .from('products')
      .insert(
        products.map((product) => ({
          ...product,
          account_id: accountId,
          created_by: userId,
        }))
      )
      .select('id');
    if (error) return productDatabaseError(error);
    return NextResponse.json({ imported: data?.length ?? 0 }, { status: 201 });
  } catch (err) {
    return productError(err);
  }
}
