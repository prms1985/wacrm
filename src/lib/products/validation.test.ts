import { describe, expect, it } from 'vitest';
import {
  isProductId,
  parseArchiveInput,
  parseProductInput,
  parseProductQuery,
  ProductInputError,
} from './validation';

const valid = {
  name: 'Office chair',
  unit_price: '4500.25',
  currency: 'INR',
  tax_rate: '18',
};

describe('catalogue input boundaries', () => {
  it('normalizes text and decimals and ignores client-supplied ownership and archive fields', () => {
    const result = parseProductInput({
      ...valid,
      name: ' Chair ',
      sku: ' SKU-1 ',
      currency: 'inr',
      account_id: 'other-account',
      created_by: 'other-user',
      is_active: false,
    });
    expect(result).toMatchObject({
      name: 'Chair',
      sku: 'SKU-1',
      currency: 'INR',
      unit_price: '4500.25',
      tax_rate: '18.00',
    });
    expect(result).not.toHaveProperty('account_id');
    expect(result).not.toHaveProperty('created_by');
    expect(result).not.toHaveProperty('is_active');
  });

  it.each([
    '-1',
    'NaN',
    'Infinity',
    '1e3',
    '2.345',
    '1,000',
    '',
    true,
    null,
    [],
    '1000000000000',
  ])('rejects invalid prices without silently rounding: %s', (unit_price) => {
    expect(() => parseProductInput({ ...valid, unit_price })).toThrow(
      ProductInputError
    );
  });

  it('accepts free items, the maximum supported price and a 100 percent tax rate', () => {
    expect(parseProductInput({ ...valid, unit_price: '0' }).unit_price).toBe(
      '0.00'
    );
    expect(
      parseProductInput({
        ...valid,
        unit_price: '999999999999.99',
        tax_rate: '100',
      }).tax_rate
    ).toBe('100.00');
  });

  it.each([-1, 100.01, '18.001', ''])(
    'rejects invalid tax rates: %s',
    (tax_rate) => {
      expect(() => parseProductInput({ ...valid, tax_rate })).toThrow(
        ProductInputError
      );
    }
  );

  it.each([
    { name: ' ' },
    { name: 'a'.repeat(201) },
    { sku: 'a'.repeat(81) },
    { description: 'a'.repeat(5001) },
    { currency: 'XYZ' },
    { kind: 'other' },
    { availability: 'unknown' },
    { unit: '' },
    { name: 'a\0b' },
    { image_url: 'javascript:alert(1)' },
    { image_url: 'http://example.com/a.jpg' },
    { image_url: 'https://user:pass@example.com/a.jpg' },
  ])('rejects malformed catalogue fields: %o', (patch) => {
    expect(() => parseProductInput({ ...valid, ...patch })).toThrow(
      ProductInputError
    );
  });

  it('accepts service units and HTTPS image references', () => {
    expect(
      parseProductInput({
        ...valid,
        kind: 'service',
        image_url: 'https://example.com/a.jpg',
      })
    ).toMatchObject({ unit: 'hour', image_url: 'https://example.com/a.jpg' });
  });

  it('allows only a boolean archive change in a PATCH', () => {
    expect(parseArchiveInput({ is_active: false })).toBe(false);
    expect(parseArchiveInput({ is_active: true })).toBe(true);
    for (const value of [
      { is_active: 'false' },
      { is_active: false, account_id: 'other' },
      null,
    ]) {
      expect(() => parseArchiveInput(value)).toThrow(ProductInputError);
    }
  });

  it('rejects malformed identifiers and query parameters', () => {
    expect(isProductId('00000000-0000-0000-0000-000000000001')).toBe(true);
    expect(isProductId('not-an-id')).toBe(false);
    for (const query of [
      'page=0',
      'page=-1',
      'page=NaN',
      'page=1.5',
      'status=deleted',
      'kind=unknown',
    ]) {
      expect(() => parseProductQuery(new URLSearchParams(query))).toThrow(
        ProductInputError
      );
    }
  });
});
