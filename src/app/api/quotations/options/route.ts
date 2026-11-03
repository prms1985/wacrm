import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/account';
import { PRODUCT_COLUMNS } from '@/lib/products/types';
import {
  checkQuotationDb,
  quotationResponseError,
} from '@/lib/quotations/repository';
import { QuotationError } from '@/lib/quotations/validation';
import { isProductId } from '@/lib/products/validation';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const p = new URL(request.url).searchParams;
    const kind = p.get('kind') ?? 'products',
      q = (p.get('q') ?? '').trim();
    if (q.length > 100) throw new QuotationError('invalid');
    const term = q.replace(/[\\%_]/g, '\\$&');
    if (kind === 'products') {
      let query = supabase
        .from('products')
        .select(PRODUCT_COLUMNS)
        .eq('account_id', accountId);
      const ids = p.get('ids')?.split(',');
      if (ids) {
        if (ids.length > 50 || ids.some((id) => !isProductId(id)))
          throw new QuotationError('invalid');
        query = query.in('id', ids);
      } else
        query = query.eq('is_active', true).neq('availability', 'unavailable');
      if (q) query = query.ilike('search_text', `%${term}%`);
      const { data, error } = await query.order('name').limit(50);
      checkQuotationDb(error);
      return NextResponse.json({ products: data ?? [] });
    }
    if (kind === 'contacts') {
      let query = supabase
        .from('contacts')
        .select('id,name,phone,email,company')
        .eq('account_id', accountId);
      if (p.get('id')) {
        if (!isProductId(p.get('id')!)) throw new QuotationError('invalid');
        query = query.eq('id', p.get('id'));
      }
      if (q) query = query.ilike('name', `%${term}%`);
      const { data, error } = await query.order('name').limit(50);
      checkQuotationDb(error);
      return NextResponse.json({ contacts: data ?? [] });
    }
    if (kind === 'templates') {
      const { data, error } = await supabase
        .from('message_templates')
        .select('id,name,language,body_text,header_type,status')
        .eq('account_id', accountId)
        .eq('header_type', 'document')
        .eq('status', 'approved')
        .order('name')
        .limit(100);
      checkQuotationDb(error);
      return NextResponse.json({ templates: data ?? [] });
    }
    throw new QuotationError('invalid');
  } catch (error) {
    return quotationResponseError(error);
  }
}
