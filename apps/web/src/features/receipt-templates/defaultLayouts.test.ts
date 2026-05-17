import { beforeEach, describe, expect, it } from 'vitest';
import i18next from '@/i18n';
import { createEmptyBlock, getDefaultLayout } from './defaultLayouts';

describe('receipt template default layouts', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });

  // ENG-086 — the sale preset moved the per-cashier / customer / sale
  // number lines into a compact `metaTable` band per the 2026-05-15
  // print-thermal handoff. The Spanish thank-you copy stays in its own
  // `text` block so the existing copy lands without changes.
  it('builds sale presets from the active Spanish locale', async () => {
    await i18next.changeLanguage('es');
    const t = i18next.getFixedT('es', 'receiptTemplates');

    const layout = getDefaultLayout('sale', t);
    const textValues = layout.blocks
      .filter(block => block.type === 'text')
      .map(block => block.value);
    expect(textValues).toContain('Gracias por tu compra');

    const metaTable = layout.blocks.find(block => block.type === 'metaTable');
    expect(metaTable, 'sale preset must ship a metaTable header band').toBeDefined();
    if (metaTable && metaTable.type === 'metaTable') {
      const flat = metaTable.rows.map(row => `${row.key} → ${row.value}`);
      expect(flat).toContain('Venta → {{sale.saleNumber}}');
      expect(flat).toContain('Fecha → {{ date(sale.createdAt) }}');
      expect(flat).toContain('Cajero → {{sale.cashier}}');
      expect(flat).toContain('Cliente → {{sale.customer}}');
    }
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
    // ENG-086 — wordmark and metaTable get visible-by-default values
    // so the operator sees the shape right after adding from the menu.
    expect(createEmptyBlock('wordmark', t)).toEqual({
      type: 'wordmark',
      show: true,
      align: 'center',
    });
    expect(createEmptyBlock('metaTable', t)).toEqual({
      type: 'metaTable',
      rows: [{ key: 'Label', value: 'Value' }],
    });
  });

  // ENG-086 — both new block types ship in the thermal sale + fiscal_dee
  // presets so a freshly seeded tenant gets the handoff look on first
  // save without manual block-add work.
  it('sale + fiscal_dee presets ship a wordmark + metaTable header band', () => {
    const t = i18next.getFixedT('en', 'receiptTemplates');
    for (const kind of ['sale', 'fiscal_dee'] as const) {
      const layout = getDefaultLayout(kind, t);
      const wordmark = layout.blocks.find(b => b.type === 'wordmark');
      const metaTable = layout.blocks.find(b => b.type === 'metaTable');
      expect(wordmark, `wordmark missing in ${kind}`).toBeDefined();
      expect(metaTable, `metaTable missing in ${kind}`).toBeDefined();
      expect(wordmark).toMatchObject({ type: 'wordmark', show: true, align: 'center' });
      if (metaTable && metaTable.type === 'metaTable') {
        expect(metaTable.rows.length).toBeGreaterThan(0);
        // Every row carries both a label and a value field so the
        // editor form can render the per-row inputs without guarding.
        for (const row of metaTable.rows) {
          expect(typeof row.key).toBe('string');
          expect(typeof row.value).toBe('string');
        }
      }
    }
  });

  // ENG-086 — quotation kept the existing letter layout (out of the
  // thermal scope) so it intentionally does NOT carry the new blocks.
  it('quotation preset keeps the existing letter layout (no wordmark / metaTable)', () => {
    const t = i18next.getFixedT('en', 'receiptTemplates');
    const layout = getDefaultLayout('quotation', t);
    expect(layout.paperWidth).toBe('letter');
    expect(layout.blocks.find(b => b.type === 'wordmark')).toBeUndefined();
    expect(layout.blocks.find(b => b.type === 'metaTable')).toBeUndefined();
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
