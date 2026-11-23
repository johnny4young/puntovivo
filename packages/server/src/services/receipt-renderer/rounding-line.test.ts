import { describe, expect, it } from 'vitest';
import type { ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import { DEFAULT_RECEIPT_RENDER_LABELS } from './labels.js';
import { renderReceiptPlainText } from './plain-text.js';
import type { RenderData } from './types.js';

const layout: ReceiptLayout = {
  paperWidth: '80mm',
  blocks: [{ type: 'totalsBlock', show: ['subtotal', 'grandTotal'] }],
};

function data(rounding: number, grandTotal: number): RenderData {
  return {
    company: { name: 'Company', taxId: '1' },
    sale: {
      saleNumber: 'SALE-1',
      createdAt: '2026-11-22T12:00:00.000Z',
      subtotal: 3737.5,
      discount: 0,
      taxTotal: 0,
      tip: 0,
      serviceCharge: 0,
      rounding,
      grandTotal,
      items: [],
      tenders: [],
    },
  };
}

describe('receipt rounding line', () => {
  it('prints the payable rounding right above the total when there is one', () => {
    const text = renderReceiptPlainText(
      layout,
      data(0.5, 3738),
      DEFAULT_RECEIPT_RENDER_LABELS
    ).split('\n');
    const rounding = text.findIndex(line => line.startsWith('Rounding'));
    expect(rounding).toBeGreaterThan(-1);
    expect(text[rounding]).toContain('0.50');
    expect(text[rounding + 1]).toMatch(/^Total/);
  });

  it('omits the line when nothing was rounded', () => {
    const text = renderReceiptPlainText(layout, data(0, 3737.5), DEFAULT_RECEIPT_RENDER_LABELS);
    expect(text).not.toContain('Rounding');
  });
});
