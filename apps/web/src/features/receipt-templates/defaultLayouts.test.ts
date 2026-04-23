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
});
