import { describe, expect, it } from 'vitest';
import type { ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import { renderReceipt } from './render.js';
import { DEFAULT_RECEIPT_RENDER_LABELS } from './labels.js';
import { summarizeItemTaxBreakdown } from './tax-breakdown.js';
import type { RenderData } from './types.js';

const layout: ReceiptLayout = {
  paperWidth: '80mm',
  blocks: [{ type: 'totalsBlock', show: ['taxTotal'] }],
};

function data(taxBreakdown?: RenderData['sale']['taxBreakdown']): RenderData {
  return {
    company: { name: 'Company', taxId: '1' },
    sale: {
      saleNumber: 'SALE-1',
      createdAt: '2026-08-27T12:00:00.000Z',
      subtotal: 200,
      discount: 0,
      taxTotal: 27,
      ...(taxBreakdown ? { taxBreakdown } : {}),
      tip: 0,
      serviceCharge: 0,
      grandTotal: 227,
      items: [],
      tenders: [],
    },
  };
}

describe('receipt tax breakdown', () => {
  it('classifies every normalized component of a mixed-tax item independently', () => {
    expect(
      summarizeItemTaxBreakdown([
        {
          taxComponents: [
            { taxKind: 'iva', taxAmount: 19 },
            { taxKind: 'inc', taxAmount: 8 },
          ],
        },
      ])
    ).toEqual({ iva: 19, inc: 8 });
  });

  it('expands the legacy taxTotal layout token into IVA and INC in HTML and ESC/POS', () => {
    const rendered = renderReceipt(
      layout,
      data({ iva: 19, inc: 8 }),
      DEFAULT_RECEIPT_RENDER_LABELS
    );

    expect(rendered.html).toContain('IVA');
    expect(rendered.html).toContain('INC');
    const escposText = new TextDecoder().decode(rendered.escpos);
    expect(escposText).toContain('IVA: 19.00');
    expect(escposText).toContain('INC: 8.00');
  });

  it('keeps the compatibility Tax row for legacy callers without a breakdown', () => {
    const rendered = renderReceipt(layout, data(), DEFAULT_RECEIPT_RENDER_LABELS);
    expect(rendered.html).toContain('Tax');
    expect(rendered.html).not.toContain('IVA');
    expect(rendered.html).not.toContain('INC');
  });
});
