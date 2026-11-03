import { isProductId } from '@/lib/products/validation';
import type { QuotationInput } from './types';

export class QuotationError extends Error {
  constructor(
    public code: string,
    public status = 400
  ) {
    super(code);
    this.name = 'QuotationError';
  }
}
export function positiveVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new QuotationError('invalid');
  return value;
}
function boundedText(value: unknown, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max || value.includes('\0'))
    throw new QuotationError('invalid');
  return value.trim();
}
export function decimalValue(
  value: unknown,
  decimals: number,
  max: number,
  allowZero = true
): string {
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new QuotationError('invalidAmount');
  const text = String(value).trim();
  if (
    !new RegExp(`^\\d{1,12}(\\.\\d{1,${decimals}})?$`).test(text) ||
    Number(text) > max ||
    (!allowZero && Number(text) === 0)
  )
    throw new QuotationError('invalidAmount');
  return text;
}
export function parseQuotationInput(
  body: unknown,
  today = new Date().toISOString().slice(0, 10)
): QuotationInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new QuotationError('invalid');
  const b = body as Record<string, unknown>;
  if (
    typeof b.contact_id !== 'string' ||
    !isProductId(b.contact_id) ||
    !Array.isArray(b.items) ||
    b.items.length > 50
  )
    throw new QuotationError('invalid');
  if (
    b.conversation_id != null &&
    (typeof b.conversation_id !== 'string' || !isProductId(b.conversation_id))
  )
    throw new QuotationError('invalid');
  const until = boundedText(b.valid_until, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(until) ||
    !Number.isFinite(Date.parse(until)) ||
    new Date(until).toISOString().slice(0, 10) !== until ||
    until < today
  )
    throw new QuotationError('invalidDate');
  const seen = new Set<string>();
  const items = b.items.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.product_id !== 'string' ||
      !isProductId(item.product_id) ||
      seen.has(item.product_id)
    )
      throw new QuotationError('invalid');
    seen.add(item.product_id);
    return {
      product_id: item.product_id,
      quantity: decimalValue(item.quantity, 3, 1_000_000, false),
    };
  });
  return {
    contact_id: b.contact_id,
    conversation_id: (b.conversation_id as string | null) ?? null,
    items,
    version: b.version == null ? null : positiveVersion(b.version),
    details: {
      discount_percent: decimalValue(b.discount_percent ?? '0', 2, 100),
      valid_until: until,
      requirements: boundedText(b.requirements, 5000),
      terms: boundedText(b.terms, 3000),
      seller_address: boundedText(b.seller_address, 1000),
      seller_tax_id: boundedText(b.seller_tax_id, 100),
    },
  };
}
