/**
 * ENG-035b — Tests de los mapeos del modelo interno a la taxonomía
 * SAT (c_FormaPago, c_ClaveUnidad, c_ClaveProdServ, Traslado).
 */
import { describe, expect, it } from 'vitest';
import {
  formatDecimal,
  inferProductClaveProdServ,
  mapPaymentMethodToFormaPago,
  mapTaxRateToTraslado,
  mapUnitToClaveUnidad,
} from '../services/fiscal/packs/mx/mappings.js';

describe('mapPaymentMethodToFormaPago (ENG-035b)', () => {
  it('cash → 01 Efectivo', () => {
    const result = mapPaymentMethodToFormaPago('cash');
    expect(result.code).toBe('01');
    expect(result.name).toBe('Efectivo');
  });

  it('card → 04 Tarjeta de crédito (default genérico)', () => {
    expect(mapPaymentMethodToFormaPago('card').code).toBe('04');
  });

  it('card_credit → 04 Tarjeta de crédito', () => {
    expect(mapPaymentMethodToFormaPago('card_credit').code).toBe('04');
  });

  it('card_debit → 28 Tarjeta de débito', () => {
    expect(mapPaymentMethodToFormaPago('card_debit').code).toBe('28');
  });

  it('transfer → 03 Transferencia electrónica', () => {
    expect(mapPaymentMethodToFormaPago('transfer').code).toBe('03');
  });

  it('check → 02 Cheque nominativo', () => {
    expect(mapPaymentMethodToFormaPago('check').code).toBe('02');
  });

  it('mercado_pago → 06 Dinero electrónico', () => {
    expect(mapPaymentMethodToFormaPago('mercado_pago').code).toBe('06');
  });

  it('credit → 99 Por definir', () => {
    expect(mapPaymentMethodToFormaPago('credit').code).toBe('99');
  });

  it('other → 01 Efectivo para mantener PUE válido', () => {
    expect(mapPaymentMethodToFormaPago('other').code).toBe('01');
  });

  it('método desconocido cae al fallback 99 Por definir', () => {
    const result = mapPaymentMethodToFormaPago('crypto');
    expect(result.code).toBe('99');
    expect(result.name).toBe('Por definir');
  });
});

describe('mapUnitToClaveUnidad (ENG-035b)', () => {
  it('unit → H87 Pieza', () => {
    expect(mapUnitToClaveUnidad('unit').code).toBe('H87');
  });

  it('kg → KGM Kilogramo', () => {
    expect(mapUnitToClaveUnidad('kg').code).toBe('KGM');
  });

  it('lt → LTR Litro', () => {
    expect(mapUnitToClaveUnidad('lt').code).toBe('LTR');
  });

  it('m → MTR Metro', () => {
    expect(mapUnitToClaveUnidad('m').code).toBe('MTR');
  });

  it('pkg → XPK Paquete', () => {
    expect(mapUnitToClaveUnidad('pkg').code).toBe('XPK');
  });

  it('caja → XBX Caja', () => {
    expect(mapUnitToClaveUnidad('caja').code).toBe('XBX');
  });

  it('case-insensitive: KG → KGM', () => {
    expect(mapUnitToClaveUnidad('KG').code).toBe('KGM');
  });

  it('unidad desconocida cae al fallback H87 (Pieza)', () => {
    expect(mapUnitToClaveUnidad('hectolitro').code).toBe('H87');
  });
});

describe('mapTaxRateToTraslado (ENG-035b)', () => {
  it('tasa 0% genera Traslado Exento sin TasaOCuota ni Importe', () => {
    const traslado = mapTaxRateToTraslado(0, 0, 100);
    expect(traslado.Base).toBe('100.00');
    expect(traslado.Impuesto).toBe('002');
    expect(traslado.TipoFactor).toBe('Exento');
    expect(traslado.TasaOCuota).toBeUndefined();
    expect(traslado.Importe).toBeUndefined();
  });

  it('tasa 16% genera Traslado Tasa con 6 decimales', () => {
    const traslado = mapTaxRateToTraslado(16, 16, 100);
    expect(traslado.Base).toBe('100.00');
    expect(traslado.Impuesto).toBe('002');
    expect(traslado.TipoFactor).toBe('Tasa');
    expect(traslado.TasaOCuota).toBe('0.160000');
    expect(traslado.Importe).toBe('16.00');
  });

  it('tasa decimal 0.16 (en lugar de 16) también produce 0.160000', () => {
    // El normalizador acepta tanto porcentaje como decimal.
    const traslado = mapTaxRateToTraslado(0.16, 16, 100);
    expect(traslado.TasaOCuota).toBe('0.160000');
  });

  it('tasa 8% (frontera) genera 0.080000', () => {
    const traslado = mapTaxRateToTraslado(8, 8, 100);
    expect(traslado.TasaOCuota).toBe('0.080000');
  });

  it('Base usa 2 decimales fijos', () => {
    const traslado = mapTaxRateToTraslado(16, 24, 150.123);
    expect(traslado.Base).toBe('150.12');
  });
});

describe('inferProductClaveProdServ (ENG-035b)', () => {
  it('producto con nombre que matchea hint → entrada de catálogo', () => {
    const entry = inferProductClaveProdServ({
      name: 'Refresco Cola 600ml',
      categoryName: 'Bebidas',
    });
    expect(entry.code).toBe('50202301'); // Bebidas no alcohólicas
  });

  it('producto con categoría que matchea hint → entrada de catálogo', () => {
    const entry = inferProductClaveProdServ({
      name: 'Producto X',
      categoryName: 'Calzado',
    });
    expect(entry.code).toBe('53111500'); // Calzado
  });

  it('producto sin match cae al fallback 01010101', () => {
    const entry = inferProductClaveProdServ({
      name: 'Producto totalmente desconocido xyz123',
      categoryName: null,
    });
    expect(entry.code).toBe('01010101');
  });

  it('case-insensitive: VINO TINTO → vinos y licores', () => {
    const entry = inferProductClaveProdServ({
      name: 'VINO TINTO RESERVA',
      categoryName: null,
    });
    expect(entry.code).toBe('50202311');
  });

  it('nombre con tilde matchea hint con tilde', () => {
    // 'plátano' está como hint — el haystack se compara case-insensitive
    // pero respetando tildes (substring estricto).
    const entry = inferProductClaveProdServ({
      name: 'Plátano dominico',
      categoryName: null,
    });
    expect(entry.code).toBe('50221200'); // Frutas y verduras
  });
});

describe('formatDecimal (ENG-035b)', () => {
  it('formatea con la precisión especificada', () => {
    expect(formatDecimal(1, 2)).toBe('1.00');
    expect(formatDecimal(1.5, 2)).toBe('1.50');
    expect(formatDecimal(1.234567, 6)).toBe('1.234567');
  });

  it('redondea correctamente', () => {
    expect(formatDecimal(1.005, 2)).toMatch(/^1\.0[01]$/); // banker's rounding
    expect(formatDecimal(0.16, 6)).toBe('0.160000');
  });

  it('clampa precisión a [0, 20]', () => {
    expect(formatDecimal(1.5, -5)).toBe('2'); // clamped a 0
    expect(formatDecimal(1.5, 50)).toMatch(/^1\.5/); // clamped a 20
  });

  it('lanza para valores no finitos', () => {
    expect(() => formatDecimal(NaN, 2)).toThrow();
    expect(() => formatDecimal(Infinity, 2)).toThrow();
  });
});
