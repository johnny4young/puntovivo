import { beforeEach, describe, expect, it } from 'vitest';
import i18next from '@/i18n';
import { createEmptyBlock, getDefaultLayout } from './defaultLayouts';

describe('receipt template default layouts', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('builds sale presets from the active Spanish locale', async () => {
    await i18next.changeLanguage('es');
    const t = i18next.getFixedT('es', 'receiptTemplates');

    const layout = getDefaultLayout('sale', t);
    const textBlocks = layout.blocks.filter(block => block.type === 'text');
    const values = textBlocks.map(block => block.value);

    expect(values).toContain('Venta {{sale.saleNumber}}');
    expect(values).toContain('Cajero: {{sale.cashier}}');
    expect(values).toContain('Cliente: {{sale.customer}}');
    expect(values).toContain('Gracias por tu compra');
  });

  it('localizes the default text block placeholder', async () => {
    await i18next.changeLanguage('es');
    const es = i18next.getFixedT('es', 'receiptTemplates');
    const en = i18next.getFixedT('en', 'receiptTemplates');

    expect(createEmptyBlock('text', es)).toEqual({
      type: 'text',
      value: 'Nuevo texto',
    });
    expect(createEmptyBlock('text', en)).toEqual({
      type: 'text',
      value: 'New text',
    });
  });

  // ENG-016 pass 1 (item #5) — appFooter included in every default
  // preset so fresh templates ship with Puntovivo branding enabled.
  it('includes a visible appFooter block in every default preset', () => {
    const t = i18next.getFixedT('en', 'receiptTemplates');
    for (const kind of ['sale', 'quotation', 'fiscal_dee'] as const) {
      const layout = getDefaultLayout(kind, t);
      const footer = layout.blocks.find(b => b.type === 'appFooter');
      expect(footer, `appFooter missing in ${kind} preset`).toBeDefined();
      expect(footer).toMatchObject({
        type: 'appFooter',
        show: true,
        align: 'center',
      });
    }
  });

  // ENG-016 pass 1 (item #5) — createEmptyBlock returns a visible
  // appFooter when the operator adds the block from the menu.
  it('createEmptyBlock("appFooter") returns a visible centered block', () => {
    const t = i18next.getFixedT('en', 'receiptTemplates');
    expect(createEmptyBlock('appFooter', t)).toEqual({
      type: 'appFooter',
      show: true,
      align: 'center',
    });
  });

  it('createEmptyBlock returns the documented defaults for every block kind', () => {
    const t = i18next.getFixedT('en', 'receiptTemplates');
    expect(createEmptyBlock('logo', t)).toEqual({
      type: 'logo',
      align: 'center',
      maxHeightMm: 18,
    });
    expect(createEmptyBlock('itemsTable', t)).toEqual({
      type: 'itemsTable',
      columns: ['name', 'qty', 'unitPrice', 'total'],
    });
    expect(createEmptyBlock('totalsBlock', t)).toEqual({
      type: 'totalsBlock',
      show: ['subtotal', 'taxTotal', 'grandTotal'],
    });
    expect(createEmptyBlock('tendersTable', t)).toEqual({
      type: 'tendersTable',
      showChange: true,
    });
    expect(createEmptyBlock('qr', t)).toEqual({
      type: 'qr',
      source: '{{fiscal.qrUrl}}',
      sizeMm: 25,
    });
    expect(createEmptyBlock('separator', t)).toEqual({ type: 'separator' });
    expect(createEmptyBlock('barcode128', t)).toEqual({
      type: 'barcode128',
      source: '{{sale.saleNumber}}',
      heightMm: 12,
    });
  });

  it('createEmptyBlock throws on an unknown kind (exhaustive guard)', () => {
    const t = i18next.getFixedT('en', 'receiptTemplates');
    expect(() =>
      createEmptyBlock(
        'definitely-not-a-real-kind' as unknown as Parameters<
          typeof createEmptyBlock
        >[0],
        t
      )
    ).toThrow(/Unknown block kind/);
  });

  it('getDefaultLayout returns an independent clone (mutating one does not affect the other)', () => {
    const t = i18next.getFixedT('en', 'receiptTemplates');
    const a = getDefaultLayout('sale', t);
    const b = getDefaultLayout('sale', t);
    a.blocks.push({ type: 'separator' });
    expect(b.blocks.length).not.toBe(a.blocks.length);
  });

  it('every preset declares a paperWidth and at least one block', () => {
    const t = i18next.getFixedT('en', 'receiptTemplates');
    for (const kind of ['sale', 'quotation', 'fiscal_dee'] as const) {
      const layout = getDefaultLayout(kind, t);
      expect(['58mm', '80mm', 'letter', 'a4']).toContain(layout.paperWidth);
      expect(layout.blocks.length).toBeGreaterThan(0);
    }
  });

  it('quotation preset includes the quotationNumberLabel and validUntil-friendly content', () => {
    const t = i18next.getFixedT('en', 'receiptTemplates');
    const layout = getDefaultLayout('quotation', t);
    const textBlocks = layout.blocks.filter(b => b.type === 'text');
    const values = textBlocks.map(b => b.value);
    expect(values.some(v => v.includes('{{sale.saleNumber}}'))).toBe(true);
  });

  it('fiscal_dee preset includes a QR block referencing the fiscal qrUrl variable', () => {
    const t = i18next.getFixedT('en', 'receiptTemplates');
    const layout = getDefaultLayout('fiscal_dee', t);
    const qr = layout.blocks.find(b => b.type === 'qr');
    expect(qr).toBeDefined();
    if (qr && qr.type === 'qr') {
      expect(qr.source).toContain('{{fiscal.qrUrl}}');
    }
  });
});
