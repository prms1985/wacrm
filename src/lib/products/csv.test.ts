import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_PRODUCT_CSV_BYTES, parseProductCsv } from './csv';
import { ProductInputError } from './validation';

describe('catalogue CSV imports', () => {
  it('imports the supplied sample and preserves quoted commas', () => {
    const result = parseProductCsv(
      readFileSync('public/samples/products.csv', 'utf8')
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      description: 'Adjustable chair, black',
      unit_price: '4500.00',
    });
    expect(result[1]).toMatchObject({
      kind: 'service',
      unit: 'hour',
      availability: 'on_request',
    });
  });

  it('handles BOMs, CRLFs, multiline descriptions and escaped quotes', () => {
    const result = parseProductCsv(
      '\uFEFFname,unit_price,currency,description\r\nChair,1.25,USD,"First line\r\nSecond ""quoted"" line"\r\n'
    );
    expect(result[0].description).toBe('First line\r\nSecond "quoted" line');
  });

  it.each([
    'name,unit_price\nChair,1',
    'name,name,unit_price,currency\nChair,Chair,1,USD',
    'name,unit_price,currency,account_id\nChair,1,USD,other',
    'name,unit_price,currency\n"Chair,1,USD',
    'name,unit_price,currency\n"Chair"oops,1,USD',
    'name,unit_price,currency\nChair,1,USD,extra',
    'name,unit_price,currency\n',
  ])('rejects invalid files before persistence: %s', (source) => {
    expect(() => parseProductCsv(source)).toThrow(ProductInputError);
  });

  it('reports the bad record instead of silently skipping it', () => {
    try {
      parseProductCsv('name,unit_price,currency\nGood,1,USD\nBad,-1,USD');
      expect.fail('expected rejection');
    } catch (err) {
      expect(err).toMatchObject({ code: 'invalidDecimal', row: 3 });
    }
  });

  it('rejects case-insensitive duplicate SKUs but allows items without SKUs', () => {
    expect(() =>
      parseProductCsv(
        'name,sku,unit_price,currency\nOne,A-1,1,USD\nTwo,a-1,2,USD'
      )
    ).toThrow('duplicateSku');
    expect(
      parseProductCsv('name,sku,unit_price,currency\nOne,,1,USD\nTwo,,2,USD')
    ).toHaveLength(2);
  });

  it('enforces the row and byte limits', () => {
    const header = 'name,unit_price,currency\n';
    expect(parseProductCsv(header + 'Item,1,USD\n'.repeat(500))).toHaveLength(
      500
    );
    expect(() => parseProductCsv(header + 'Item,1,USD\n'.repeat(501))).toThrow(
      'csvCount'
    );
    expect(() =>
      parseProductCsv('a'.repeat(MAX_PRODUCT_CSV_BYTES + 1))
    ).toThrow('csvSize');
  });
});
