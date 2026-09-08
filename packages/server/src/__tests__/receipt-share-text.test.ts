import { describe, expect, it } from 'vitest';
import { buildPreviewData, renderReceiptPlainText } from '../services/receipt-renderer/index.js';
import { DEFAULT_RECEIPT_RENDER_LABELS } from '../services/receipt-renderer/labels.js';

describe('renderReceiptPlainText', () => {
  it('follows configured block order and excludes fields outside RenderData', () => {
    const data = buildPreviewData('sale');
    const text = renderReceiptPlainText(
      {
        paperWidth: '80mm',
        blocks: [
          { type: 'text', value: '{{company.name}}' },
          { type: 'metaTable', rows: [{ key: 'Sale', value: '{{sale.saleNumber}}' }] },
          { type: 'itemsTable', columns: ['name', 'qty', 'total'] },
          { type: 'totalsBlock', show: ['grandTotal'] },
          { type: 'tendersTable', showChange: true },
        ],
      },
      data,
      DEFAULT_RECEIPT_RENDER_LABELS
    );

    expect(text).toContain('Mi Tienda S.A.S.');
    expect(text).toContain('Sale: V-000123');
    expect(text).toContain('Item | Qty | Total');
    expect(text).toContain('Café 250g | 2.00 | 44000.00');
    expect(text).toContain('Total: 107403.00');
    expect(text).toContain('Cash | 60000.00');
    expect(text).toContain('Change: 1000.00');
    expect(text).not.toContain('<table');
    expect(text).not.toContain('cost');
    expect(text).not.toContain('margin');
    expect(text.indexOf('Sale: V-000123')).toBeLessThan(text.indexOf('Item | Qty | Total'));
  });

  it('prints the frozen promotion rule and the redeemed point count', async () => {
    // The sale stores promotion snapshots and a loyalty tender's point count
    // so a receipt is evidence of how the line was actually priced. The
    // renderer used to drop both: the customer saw a lower total with no rule
    // behind it, and a points tender that reported only its money value.
    const data = buildPreviewData('sale');
    data.sale.items[0]!.promotions = [{ name: 'Martes 2x1', version: 3, discountAmount: 4000 }];
    // The schema keeps points non-null only on a loyalty tender, so the
    // fixture mirrors that rather than hanging a point count off cash.
    data.sale.tenders[0]!.method = 'loyalty';
    data.sale.tenders[0]!.points = 250;

    const text = renderReceiptPlainText(
      {
        paperWidth: '80mm',
        blocks: [
          { type: 'itemsTable', columns: ['name', 'qty', 'total'] },
          { type: 'tendersTable', showChange: false },
        ],
      },
      data,
      DEFAULT_RECEIPT_RENDER_LABELS
    );

    // Name AND version: a reprint after the rule is edited must still show
    // the one that priced this line.
    expect(text).toContain('Martes 2x1 (v3) -4000.00');
    // Whole points: 250.00 pts would read as a fractional point.
    expect(text).toContain('250 pts');
    expect(text).not.toContain('250.00 pts');
  });

  it('leaves a receipt without promotions or points exactly as it was', async () => {
    // The new fields are optional, so an ordinary sale must render unchanged.
    const data = buildPreviewData('sale');
    const text = renderReceiptPlainText(
      {
        paperWidth: '80mm',
        blocks: [
          { type: 'itemsTable', columns: ['name', 'qty', 'total'] },
          { type: 'tendersTable', showChange: false },
        ],
      },
      data,
      DEFAULT_RECEIPT_RENDER_LABELS
    );
    expect(text).toContain('Café 250g | 2.00 | 44000.00');
    expect(text).not.toContain('pts');
    expect(text).not.toContain('(v');
  });
});
