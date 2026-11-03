export const PRODUCT_KINDS = ['product', 'service'] as const;
export const PRODUCT_AVAILABILITIES = [
  'available',
  'on_request',
  'unavailable',
] as const;

export type ProductKind = (typeof PRODUCT_KINDS)[number];
export type ProductAvailability = (typeof PRODUCT_AVAILABILITIES)[number];

export interface Product {
  id: string;
  account_id: string;
  name: string;
  sku: string | null;
  kind: ProductKind;
  category: string | null;
  description: string | null;
  specifications: string | null;
  image_url: string | null;
  unit: string;
  unit_price: number;
  currency: string;
  tax_rate: number;
  availability: ProductAvailability;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Explicit projection excludes internal search and creator columns. */
export const PRODUCT_COLUMNS =
  'id,account_id,name,sku,kind,category,description,specifications,image_url,unit,unit_price,currency,tax_rate,availability,is_active,created_at,updated_at';

/** Decimal strings go to Postgres without intermediate money arithmetic. */
export interface ProductInput {
  name: string;
  sku: string | null;
  kind: ProductKind;
  category: string | null;
  description: string | null;
  specifications: string | null;
  image_url: string | null;
  unit: string;
  unit_price: string;
  currency: string;
  tax_rate: string;
  availability: ProductAvailability;
}
