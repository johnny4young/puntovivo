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
});
