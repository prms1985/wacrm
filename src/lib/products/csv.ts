import { parseProductInput, ProductInputError } from './validation';
import type { ProductInput } from './types';

export const MAX_PRODUCT_CSV_BYTES = 1024 * 1024;
export const MAX_PRODUCT_IMPORT_ROWS = 500;

const COLUMNS = [
  'name',
  'sku',
  'kind',
  'category',
  'description',
  'specifications',
  'image_url',
  'unit',
  'unit_price',
  'currency',
  'tax_rate',
  'availability',
];

/** RFC-style quoting, including escaped quotes, BOMs and multiline cells. */
function csvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  const input = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else cell += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell);
      cell = '';
      closedQuote = false;
      if (char !== ',') {
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
        if (char === '\r' && input[i + 1] === '\n') i++;
      }
    } else if (closedQuote) {
      if (char !== ' ' && char !== '\t')
        throw new ProductInputError('csvMalformed');
    } else if (char === '"') {
      if (cell) throw new ProductInputError('csvMalformed');
      quoted = true;
    } else cell += char;
  }
  if (quoted) throw new ProductInputError('csvMalformed');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseProductCsv(source: string): ProductInput[] {
  if (new TextEncoder().encode(source).byteLength > MAX_PRODUCT_CSV_BYTES)
    throw new ProductInputError('csvSize');
  const rows = csvRows(source);
  const headers = (rows.shift() ?? []).map((value) =>
    value.trim().toLowerCase()
  );
  if (
    !['name', 'unit_price', 'currency'].every((column) =>
      headers.includes(column)
    ) ||
    headers.some((column) => !COLUMNS.includes(column)) ||
    new Set(headers).size !== headers.length
  ) {
    throw new ProductInputError('csvHeaders');
  }
  if (!rows.length || rows.length > MAX_PRODUCT_IMPORT_ROWS)
    throw new ProductInputError('csvCount');
  const skus = new Set<string>();
  return rows.map((row, index) => {
    try {
      if (row.length !== headers.length)
        throw new ProductInputError('csvMalformed');
      const body = Object.fromEntries(
        headers.map((column, i) => [column, row[i].trim()])
      );
      for (const field of ['kind', 'unit', 'tax_rate', 'availability']) {
        if (!body[field]) delete body[field];
      }
      const product = parseProductInput(body);
      if (product.sku) {
        const key = product.sku.toLowerCase();
        if (skus.has(key)) throw new ProductInputError('duplicateSku');
        skus.add(key);
      }
      return product;
    } catch (err) {
      if (err instanceof ProductInputError) err.row = index + 2;
      throw err;
    }
  });
}
