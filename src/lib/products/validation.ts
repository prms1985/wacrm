import { CURRENCIES } from '@/lib/currency';
import {
  PRODUCT_AVAILABILITIES,
  PRODUCT_KINDS,
  type ProductInput,
} from './types';

export class ProductInputError extends Error {
  row?: number;
  constructor(
    public readonly code: string,
    public readonly values: Record<string, string | number> = {}
  ) {
    super(code);
    this.name = 'ProductInputError';
  }
}

function text(
  value: unknown,
  max: number,
  field: string,
  required = false
): string | null {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new ProductInputError('invalidField', { field });
  }
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && !result) || result.length > max || /\u0000/.test(result)) {
    throw new ProductInputError('invalidField', { field });
  }
  return result || null;
}

function decimal(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ProductInputError('invalidDecimal', { field });
  }
  const result = String(value).trim();
  // Reject rounding, exponents, commas, NaN, and negative values explicitly.
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(result) || Number(result) > max) {
    throw new ProductInputError('invalidDecimal', { field });
  }
  return Number(result).toFixed(2);
}

export function parseProductInput(body: unknown): ProductInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ProductInputError('invalidBody');
  const b = body as Record<string, unknown>;
  const kind = b.kind ?? 'product';
  const availability = b.availability ?? 'available';
  if (!PRODUCT_KINDS.includes(kind as never))
    throw new ProductInputError('invalidField', { field: 'kind' });
  if (!PRODUCT_AVAILABILITIES.includes(availability as never))
    throw new ProductInputError('invalidField', { field: 'availability' });
  const currency =
    typeof b.currency === 'string' ? b.currency.trim().toUpperCase() : '';
  if (!CURRENCIES.some((c) => c.code === currency))
    throw new ProductInputError('invalidField', { field: 'currency' });
  const image = text(b.image_url, 2048, 'image_url');
  if (image) {
    try {
      const url = new URL(image);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error();
    } catch {
      throw new ProductInputError('invalidImage');
    }
  }
  return {
    name: text(b.name, 200, 'name', true)!,
    sku: text(b.sku, 80, 'sku'),
    kind: kind as ProductInput['kind'],
    category: text(b.category, 100, 'category'),
    description: text(b.description, 5000, 'description'),
    specifications: text(b.specifications, 5000, 'specifications'),
    image_url: image,
    unit: text(
      b.unit ?? (kind === 'service' ? 'hour' : 'pcs'),
      40,
      'unit',
      true
    )!,
    unit_price: decimal(b.unit_price, 999_999_999_999.99, 'unit_price'),
    currency,
    tax_rate: decimal(b.tax_rate ?? '0', 100, 'tax_rate'),
    availability: availability as ProductInput['availability'],
  };
}

export function parseArchiveInput(body: unknown): boolean {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof (body as Record<string, unknown>).is_active !== 'boolean'
  ) {
    throw new ProductInputError('invalidBody');
  }
  return (body as { is_active: boolean }).is_active;
}

export function isProductId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function parseProductQuery(params: URLSearchParams) {
  const pageText = params.get('page') ?? '1';
  const status = params.get('status') ?? 'active';
  const kind = params.get('kind') ?? 'all';
  const q = (params.get('q') ?? '').trim();
  if (
    !/^[1-9]\d{0,5}$/.test(pageText) ||
    !['active', 'archived', 'all'].includes(status) ||
    !['all', ...PRODUCT_KINDS].includes(kind) ||
    q.length > 100
  ) {
    throw new ProductInputError('invalidQuery');
  }
  return { page: Number(pageText), status, kind, q };
}
