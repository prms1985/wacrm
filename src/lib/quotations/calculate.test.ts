import { describe, expect, it } from 'vitest';
import { calculateQuotation } from './calculate';
import { parseQuotationInput } from './validation';
import type { Product } from '@/lib/products/types';
const id = '00000000-0000-0000-0000-000000000001';
const product = {
  id,
  name: 'Birthday function',
  unit: 'Count',
  unit_price: 3500,
  tax_rate: 18,
  currency: 'INR',
  is_active: true,
  availability: 'available',
} as Product;
describe('quotation preview and validation', () => {
  it('calculates the birthday package example', () =>
    expect(
      calculateQuotation([product], [{ product_id: id, quantity: '1' }])
    ).toMatchObject({ subtotal: 3500, tax_total: 630, total: 4130 }));
  it('rounds decimal line discounts and taxes without floating point drift', () =>
    expect(
      calculateQuotation(
        [{ ...product, unit_price: 0.05 }],
        [{ product_id: id, quantity: '3' }],
        '5'
      )
    ).toMatchObject({
      subtotal: 0.15,
      discount_total: 0.01,
      tax_total: 0.03,
      total: 0.17,
    }));
  it.each(['0', '-1', '1e3', 'NaN', '0.0001', '1000001'])(
    'rejects invalid quantities %s',
    (quantity) =>
      expect(() =>
        calculateQuotation([product], [{ product_id: id, quantity }])
      ).toThrow()
  );
  it('rejects archived and unavailable products', () => {
    expect(() =>
      calculateQuotation(
        [{ ...product, is_active: false }],
        [{ product_id: id, quantity: '1' }]
      )
    ).toThrow();
    expect(() =>
      calculateQuotation(
        [{ ...product, availability: 'unavailable' }],
        [{ product_id: id, quantity: '1' }]
      )
    ).toThrow();
  });
  it('rejects impossible calendar dates and client-provided totals are ignored', () => {
    const valid = {
      contact_id: id,
      items: [{ product_id: id, quantity: '1' }],
      valid_until: '2099-12-31',
      total: 0.01,
      status: 'approved',
    };
    expect(parseQuotationInput(valid)).not.toHaveProperty('status');
    expect(parseQuotationInput(valid)).not.toHaveProperty('total');
    expect(() =>
      parseQuotationInput({ ...valid, valid_until: '2099-02-30' })
    ).toThrow();
  });
});
