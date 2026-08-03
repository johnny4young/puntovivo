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
});
