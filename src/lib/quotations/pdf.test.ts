import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { quotationPdf } from './pdf';
import type { Quotation } from './types';
const quote = {
  reference: 'Q-TEST',
  seller: { name: 'GET Solution', address: 'Chennai', tax_id: '' },
  customer: {
    name: 'Customer',
    phone: '+919999999999',
    email: null,
    company: null,
  },
  status: 'draft',
  created_at: '2026-10-31T00:00:00Z',
  valid_until: '2026-11-07',
  currency: 'INR',
  discount_percent: 0,
  subtotal: 3500,
  discount_total: 0,
  tax_total: 630,
  total: 4130,
  requirements: 'Birthday function',
  terms: 'Subject to approval',
  items: [
    {
      product_id: 'item',
      name: 'Birthday function - mini',
      sku: '1',
      unit: 'Count',
      quantity: 1,
      unit_price: 3500,
      tax_rate: 18,
      subtotal: 3500,
      discount: 0,
      tax: 630,
      total: 4130,
    },
  ],
} as Quotation;
describe('quotation PDF generation', () => {
  it('produces a parseable PDF from quotation snapshots', async () => {
    const bytes = await quotationPdf(quote);
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe('%PDF');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it('preserves supported non-Latin customer text and paginates long quotations', async () => {
    const bytes = await quotationPdf({
      ...quote,
      customer: { ...quote.customer, name: '고객 தமிழ்' },
      items: Array.from({ length: 50 }, () => quote.items[0]),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  }, 20000);
});
