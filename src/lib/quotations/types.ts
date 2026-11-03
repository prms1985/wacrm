export const QUOTATION_STATUSES = [
  'draft',
  'approved',
  'sending',
  'sent',
  'send_unknown',
  'accepted',
  'rejected',
  'cancelled',
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export interface QuotationLine {
  product_id: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}
export interface Quotation {
  id: string;
  account_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  reference: string;
  status: QuotationStatus;
  source: 'manual' | 'ai';
  ai_collecting: boolean;
  customer: {
    name: string | null;
    phone: string | null;
    wa_user_id?: string | null;
    email: string | null;
    company: string | null;
  };
  seller: { name: string; address: string; tax_id: string };
  items: QuotationLine[];
  currency: string;
  discount_percent: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  valid_until: string;
  requirements: string;
  terms: string;
  version: number;
  approved_at: string | null;
  sent_at: string | null;
  send_attempt_id: string | null;
  send_error: string | null;
  created_at: string;
  updated_at: string;
}
export const QUOTATION_COLUMNS =
  'id,account_id,contact_id,conversation_id,reference,status,source,ai_collecting,customer,seller,items,currency,discount_percent,subtotal,discount_total,tax_total,total,valid_until,requirements,terms,version,approved_at,sent_at,send_attempt_id,send_error,created_at,updated_at';
export interface QuotationInput {
  contact_id: string;
  conversation_id: string | null;
  items: { product_id: string; quantity: string }[];
  details: {
    discount_percent: string;
    valid_until: string;
    requirements: string;
    terms: string;
    seller_address: string;
    seller_tax_id: string;
  };
  version: number | null;
}
