import { NextResponse } from 'next/server';
import { getT } from '@/lib/i18n/translate';
import { toErrorResponse } from '@/lib/auth/account';
import { ProductInputError } from './validation';

const t = getT('Products');

export function productError(err: unknown) {
  if (err instanceof ProductInputError) {
    const values = { ...err.values };
    if (typeof values.field === 'string')
      values.field = t(`fields.${values.field}`);
    let message = t(`errors.${err.code}`, values);
    if (err.row)
      message = t('errors.csvRow', { row: err.row, reason: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return toErrorResponse(err);
}

export function productDatabaseError(error: { code?: string }) {
  if (error.code === '23505')
    return NextResponse.json(
      { error: t('errors.duplicateSku') },
      { status: 409 }
    );
  if (['42P01', 'PGRST205'].includes(error.code ?? '')) {
    return NextResponse.json(
      { error: t('errors.unavailable') },
      { status: 503 }
    );
  }
  console.error('[products] database operation failed:', error.code);
  return NextResponse.json({ error: t('errors.save') }, { status: 500 });
}

export function productNotFound() {
  return NextResponse.json({ error: t('errors.notFound') }, { status: 404 });
}
