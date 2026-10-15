import { describe, expect, it } from 'vitest';
import { buildPreviewData, renderReceipt } from './render.js';

function printableLines(bytes: Uint8Array): string[] {
  const text: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x1b) {
      i += bytes[i + 1] === 0x40 ? 1 : 2;
      continue;
    }
    if (b === 0x1d) {
      i += 2;
      continue;
    }
    text.push(b);
  }
  return Buffer.from(text).toString('latin1').split('\n');
}
describe('thermal output completeness', () => {
  for (const [paperWidth, columns] of [
    ['58mm', 32],
    ['80mm', 48],
  ] as const) {
    it(`preserves long names, identifiers and amounts within ${columns} ESC/POS columns`, () => {
      const data = buildPreviewData('sale');
      delete data.fiscal;
      data.fiscalDocuments = [];
      const name = 'SYNTHETIC_PRODUCT_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789';
      data.sale.items[0]!.name = name;
      data.sale.items[0]!.qty = 123.45;
      data.sale.items[0]!.total = 152407296.15;
      data.sale.customer = 'SYNTHETIC_CUSTOMER_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789';
      const rendered = renderReceipt(
        {
          paperWidth,
          blocks: [
            { type: 'text', value: '{{sale.customer}}' },
            { type: 'itemsTable', columns: ['name', 'qty', 'unitPrice', 'total'] },
            { type: 'metaTable', rows: [{ key: 'Identifier', value: '{{sale.customer}}' }] },
            { type: 'totalsBlock', show: ['grandTotal'] },
          ],
        },
        data
      );
      const lines = printableLines(rendered.escpos);
      expect(lines.every(line => line.length <= columns)).toBe(true);
      const compact = lines.join('').replaceAll(' ', '');
      expect(compact).toContain(name);
      expect(compact).toContain(data.sale.customer);
      expect(lines.join('\n')).toContain('152407296.15');
      expect(rendered.html).toContain(name);
      expect(rendered.html).toContain('class="thermal"');
      expect(rendered.html).toContain('152407296.15');
    });
  }
  it('keeps tender column padding and text spacing when the line already fits', () => {
    const data = buildPreviewData('sale');
    delete data.fiscal;
    data.fiscalDocuments = [];
    const lines = printableLines(
      renderReceipt(
        {
          paperWidth: '58mm',
          blocks: [
            { type: 'tendersTable', showChange: true },
            { type: 'text', value: 'NIT:      900.123' },
          ],
        },
        data
      ).escpos
    );
    expect(lines).toContain(`${'Cash'.padEnd(14)} ${'60000.00'.padStart(10)}`);
    expect(lines).toContain(`${'Change'.padEnd(8)} ${'1000.00'.padStart(10)}`);
    expect(lines).toContain('NIT:      900.123');
  });
  it('labels stacked thermal item and tender cells even without a header row', () => {
    const data = buildPreviewData('sale');
    delete data.fiscal;
    data.fiscalDocuments = [];
    const html = renderReceipt(
      {
        paperWidth: '58mm',
        blocks: [
          { type: 'itemsTable', columns: ['name', 'qty', 'total'], showHeader: false },
          { type: 'tendersTable', showChange: true },
        ],
      },
      data
    ).html;
    expect(html).not.toContain('<thead><tr><th class="col-qty">');
    expect(html).toContain('<span class="item-cell-label">Qty</span>');
    expect(html).toContain('<span class="item-cell-label">Total</span>');
    expect(html).toContain('<span class="tender-cell-label">Reference: </span>AUTH-887766');
    expect(html).toContain('.thermal .block-tenders td:empty{display:none;}');
  });
  it('never interprets interpolated text as ESC/POS actuator commands', () => {
    const data = buildPreviewData('sale');
    delete data.fiscal;
    data.fiscalDocuments = [];
    data.sale.customer = 'DEMO\x1bp\x00\x19\xfa';
    const bytes = renderReceipt(
      { paperWidth: '58mm', blocks: [{ type: 'text', value: '{{sale.customer}}' }] },
      data
    ).escpos;
    const escCommands = Array.from(bytes).flatMap((b, i) => (b === 0x1b ? [bytes[i + 1]] : []));
    expect(escCommands).not.toContain(0x70);
  });
});
