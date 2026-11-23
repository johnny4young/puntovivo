import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { formatSystemNote } from './systemNotes';

describe('formatSystemNote', () => {
  it('renders server-written notes in Spanish and keeps typed text', async () => {
    await i18n.changeLanguage('es');
    const t = i18n.t.bind(i18n);

    expect(formatSystemNote('Sale VTA-N-000004 · Sede Norte', t)).toBe(
      'Venta VTA-N-000004 · Sede Norte'
    );
    expect(formatSystemNote('Refunded sale VTA-N-000004', t)).toBe(
      'Devolución de la venta VTA-N-000004'
    );
    expect(formatSystemNote('Entregar en bodega | Refunded: expired', t)).toBe(
      'Entregar en bodega | Devolución: Vencido / mal estado'
    );
    expect(formatSystemNote('Llega el martes | Received from order PED-000001', t)).toBe(
      'Llega el martes | Recibido del pedido PED-000001'
    );
    expect(formatSystemNote('Purchase CMP-000002 · received from order PED-000001', t)).toBe(
      'Compra CMP-000002 · recibida del pedido PED-000001'
    );
    expect(formatSystemNote('Opening stock from product creation', t)).toBe(
      'Stock inicial al crear el producto'
    );
    expect(formatSystemNote('Stock changed from product edit', t)).toBe(
      'Stock cambiado al editar el producto'
    );
    expect(formatSystemNote('Sale pending review', t)).toBe('Sale pending review');
  });
});
