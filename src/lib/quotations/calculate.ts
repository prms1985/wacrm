import { QuotationError, decimalValue } from './validation';
import type { Product } from '@/lib/products/types';
import type { QuotationLine } from './types';

function scaled(value: string | number, digits: number): bigint {
  const [whole, fraction = ''] = String(value).split('.');
  return (
    BigInt(whole) * BigInt(10) ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, '0'))
  );
}
const round = (value: bigint, divisor: bigint) =>
  (value + divisor / BigInt(2)) / divisor;
const amount = (value: bigint) => Number(value) / 100;

/** Exact decimal arithmetic for previews; the database independently recalculates every save. */
export function calculateQuotation(
  products: Product[],
  selections: { product_id: string; quantity: string }[],
  discountValue = '0'
) {
  const discount = scaled(decimalValue(discountValue, 2, 100), 2);
  let currency: string | null = null;
  let subtotal = BigInt(0),
    discounts = BigInt(0),
    taxes = BigInt(0);
  const items: QuotationLine[] = selections.map((selection) => {
    const product = products.find((item) => item.id === selection.product_id);
    if (
      !product ||
      !product.is_active ||
      product.availability === 'unavailable'
    )
      throw new QuotationError('unavailableProduct');
    if (currency && currency !== product.currency)
      throw new QuotationError('mixedCurrencies');
    currency = product.currency;
    const quantity = scaled(
      decimalValue(selection.quantity, 3, 1_000_000, false),
      3
    );
    const base = round(scaled(product.unit_price, 2) * quantity, BigInt(1000));
    const off = round(base * discount, BigInt(10000));
    const tax = round(
      (base - off) * scaled(product.tax_rate, 2),
      BigInt(10000)
    );
    subtotal += base;
    discounts += off;
    taxes += tax;
    if (
      [subtotal, taxes, subtotal - discounts + taxes].some(
        (value) => value > BigInt('99999999999999')
      )
    )
      throw new QuotationError('tooLarge');
    return {
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit,
      quantity: Number(selection.quantity),
      unit_price: product.unit_price,
      tax_rate: product.tax_rate,
      subtotal: amount(base),
      discount: amount(off),
      tax: amount(tax),
      total: amount(base - off + tax),
    };
  });
  return {
    items,
    currency: currency ?? '',
    subtotal: amount(subtotal),
    discount_total: amount(discounts),
    tax_total: amount(taxes),
    total: amount(subtotal - discounts + taxes),
  };
}
