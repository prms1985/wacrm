import { readFile } from 'node:fs/promises';
import 'regenerator-runtime/runtime.js';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Quotation } from './types';

let latin: Promise<Buffer> | undefined,
  tamil: Promise<Buffer> | undefined,
  cjk: Promise<Buffer> | undefined;
const fontFile = (name: string) =>
  readFile(path.join(process.cwd(), 'public', 'fonts', name));

/** Private PDF bytes; no external network request or publicly readable document URL. */
export async function quotationPdf(quote: Quotation): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(quote.reference);
  doc.setAuthor(quote.seller.name);
  doc.setSubject('Sales quotation');
  const fonts: PDFFont[] = [
    await doc.embedFont(await (latin ??= fontFile('NotoSans-Regular.ttf')), {
      subset: true,
    }),
  ];
  const content = JSON.stringify(quote);
  if (/[\u0b80-\u0bff]/.test(content))
    fonts.push(
      await doc.embedFont(
        await (tamil ??= fontFile('NotoSansTamil-Regular.ttf')),
        { subset: true }
      )
    );
  if (/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af]/.test(content))
    fonts.push(
      await doc.embedFont(
        await (cjk ??= fontFile('NotoSansCJKkr-Regular.otf')),
        { subset: true }
      )
    );
  const sets = fonts.map((font) => new Set(font.getCharacterSet()));
  const fontFor = (char: string) =>
    Math.max(
      0,
      sets.findIndex((set) => set.has(char.codePointAt(0)!))
    );
  const clean = (text: string) =>
    Array.from(text.replace(/[\x00-\x08\x0b-\x1f]/g, ''))
      .map((char) =>
        char === '\n' || sets.some((set) => set.has(char.codePointAt(0)!))
          ? char
          : '\uFFFD'
      )
      .join('');
  const width = (text: string, size: number) =>
    Array.from(text).reduce(
      (sum, char) => sum + fonts[fontFor(char)].widthOfTextAtSize(char, size),
      0
    );
  let page = doc.addPage([595.28, 841.89]);
  let y = 790;
  const next = (height: number) => {
    if (y - height < 55) {
      page = doc.addPage([595.28, 841.89]);
      y = 790;
    }
  };
  function draw(
    value: string,
    x: number,
    size = 10,
    maxWidth = 495,
    color = rgb(0.15, 0.17, 0.22)
  ) {
    const text = clean(value);
    const lines: string[] = [];
    let line = '';
    for (const char of text) {
      if (char === '\n' || width(line + char, size) > maxWidth) {
        lines.push(line);
        line = char === '\n' ? '' : char;
      } else line += char;
    }
    lines.push(line);
    for (const item of lines) {
      next(size + 7);
      let offset = x;
      let run = '',
        current = 0;
      const flush = () => {
        if (run) {
          page.drawText(run, {
            x: offset,
            y,
            size,
            font: fonts[current],
            color,
          });
          offset += width(run, size);
          run = '';
        }
      };
      for (const char of item) {
        const index = fontFor(char);
        if (index !== current) {
          flush();
          current = index;
        }
        run += char;
      }
      flush();
      y -= size + 6;
    }
  }
  const money = (value: number) =>
    `${quote.currency} ${Number(value).toFixed(2)}`;
  draw(quote.seller.name, 50, 19);
  if (quote.seller.address) draw(quote.seller.address, 50);
  if (quote.seller.tax_id) draw(`Tax ID: ${quote.seller.tax_id}`, 50);
  y -= 12;
  draw('QUOTATION', 50, 17, 495, rgb(0.4, 0.2, 0.8));
  draw(
    `${quote.reference}   |   ${quote.created_at.slice(0, 10)}   |   Valid until ${quote.valid_until}`,
    50,
    9
  );
  if (quote.status === 'draft')
    draw('DRAFT - AWAITING APPROVAL', 50, 11, 495, rgb(0.7, 0.2, 0.1));
  y -= 12;
  draw('Prepared for', 50, 11);
  for (const value of [
    quote.customer.name,
    quote.customer.company,
    quote.customer.phone,
    quote.customer.email,
  ])
    if (value) draw(value, 50);
  y -= 16;
  quote.items.forEach((item, index) => {
    next(100);
    draw(
      `${index + 1}. ${item.name}${item.sku ? ` (${item.sku})` : ''}`,
      50,
      11
    );
    draw(
      `${item.quantity} ${item.unit} x ${money(item.unit_price)}  |  Tax ${item.tax_rate}%`,
      60,
      9
    );
    draw(
      `Subtotal ${money(item.subtotal)}  |  Discount ${money(item.discount)}  |  Tax ${money(item.tax)}`,
      60,
      8
    );
    draw(`Line total: ${money(item.total)}`, 60, 10);
    y -= 9;
  });
  next(125);
  y -= 8;
  draw(`Subtotal: ${money(quote.subtotal)}`, 50, 11);
  draw(
    `Discount (${quote.discount_percent}%): ${money(quote.discount_total)}`,
    50,
    11
  );
  draw(`Tax: ${money(quote.tax_total)}`, 50, 11);
  draw(`TOTAL: ${money(quote.total)}`, 50, 16, 495, rgb(0.4, 0.2, 0.8));
  for (const [title, text] of [
    ['Requirements', quote.requirements],
    ['Terms', quote.terms],
  ])
    if (text) {
      y -= 14;
      draw(title, 50, 11);
      draw(text, 50, 9);
    }
  const pages = doc.getPages();
  pages.forEach((sheet, index) =>
    sheet.drawText(`${quote.reference}  |  ${index + 1} / ${pages.length}`, {
      x: 50,
      y: 28,
      size: 8,
      font: fonts[0],
      color: rgb(0.5, 0.5, 0.5),
    })
  );
  return doc.save();
}
