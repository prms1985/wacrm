import { describe, expect, it } from 'vitest';
import { parseAiQuotation } from './ai';
const id = '00000000-0000-0000-0000-000000000001';
const valid = {
  requested: true,
  ready: true,
  items: [{ product_id: id, quantity: '1' }],
  requirements: 'Birthday function',
  question: '',
};
describe('AI quotation extraction boundary', () => {
  it('accepts catalogue IDs and quantities while ignoring model-generated prices', () => {
    const result = parseAiQuotation(
      JSON.stringify({
        ...valid,
        total: 1,
        discount: 100,
        items: [{ product_id: id, quantity: 1, unit_price: 0 }],
      }),
      [{ id }]
    );
    expect(result.items).toEqual([{ product_id: id, quantity: '1' }]);
    expect(result).not.toHaveProperty('total');
    expect(result).not.toHaveProperty('discount');
  });
  it('rejects invented product IDs', () =>
    expect(() => parseAiQuotation(JSON.stringify(valid), [])).toThrow());
  it('rejects empty ready drafts and excessive quantities', () => {
    expect(() =>
      parseAiQuotation(JSON.stringify({ ...valid, items: [] }), [{ id }])
    ).toThrow();
    expect(() =>
      parseAiQuotation(
        JSON.stringify({ ...valid, items: [{ product_id: id, quantity: -1 }] }),
        [{ id }]
      )
    ).toThrow();
  });
});
