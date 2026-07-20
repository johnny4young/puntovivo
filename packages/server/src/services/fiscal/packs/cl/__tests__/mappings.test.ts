/**
 * Tests del módulo de mapeos CL.
 *
 * Pure-function tests; sin DB. Cubren:
 * - mapPaymentMethodToFmaPago: contado vs crédito vs default.
 * - mapInternalKindToTipoDte: factura vs boleta vs nota crédito.
 * - mapUnitToUnmdItem: catálogo de equivalencias + fallback.
 * - roundClp: rounding sin decimales.
 * - computeDteTotals: afecto + exento + IVA aritmética.
 */

import { describe, expect, it } from 'vitest';
import {
  computeDteTotals,
  mapInternalKindToTipoDte,
  mapPaymentMethodToFmaPago,
  mapUnitToUnmdItem,
  roundClp,
  TASA_IVA_CL,
} from '../mappings.js';

describe('mapPaymentMethodToFmaPago', () => {
  it('mapea cash/card/transfer/etc → 1 (contado)', () => {
    for (const m of [
      'cash',
      'card',
      'card_credit',
      'card_debit',
      'transfer',
      'check',
      'mercado_pago',
      'nequi',
      'other',
    ]) {
      expect(mapPaymentMethodToFmaPago(m)).toBe(1);
    }
  });

  it('mapea credit → 2 (crédito)', () => {
    expect(mapPaymentMethodToFmaPago('credit')).toBe(2);
  });

  it('cae al default 1 cuando el método es unknown / undefined', () => {
    expect(mapPaymentMethodToFmaPago('cripto')).toBe(1);
    expect(mapPaymentMethodToFmaPago(undefined)).toBe(1);
    expect(mapPaymentMethodToFmaPago('')).toBe(1);
  });
});

describe('mapInternalKindToTipoDte', () => {
  it('sale + buyer con RUT → 33 (factura)', () => {
    expect(mapInternalKindToTipoDte('sale', true)).toBe('33');
  });

  it('sale sin RUT → 39 (boleta)', () => {
    expect(mapInternalKindToTipoDte('sale', false)).toBe('39');
  });

  it('return → 61 (nota crédito) sin importar buyer', () => {
    expect(mapInternalKindToTipoDte('return', true)).toBe('61');
    expect(mapInternalKindToTipoDte('return', false)).toBe('61');
  });

  it('void → 61 (nota crédito anulando) sin importar buyer', () => {
    expect(mapInternalKindToTipoDte('void', true)).toBe('61');
    expect(mapInternalKindToTipoDte('void', false)).toBe('61');
  });
});

describe('mapUnitToUnmdItem', () => {
  it('mapea unidades comunes a strings SII abreviados', () => {
    expect(mapUnitToUnmdItem('unit')).toBe('un');
    expect(mapUnitToUnmdItem('PIEZA')).toBe('un'); // case-insensitive
    expect(mapUnitToUnmdItem('kg')).toBe('kg');
    expect(mapUnitToUnmdItem('lt')).toBe('lt');
    expect(mapUnitToUnmdItem('litro')).toBe('lt');
    expect(mapUnitToUnmdItem('caja')).toBe('cj');
  });

  it('cae al fallback "un" para unidades unknown', () => {
    expect(mapUnitToUnmdItem('barril')).toBe('un');
    expect(mapUnitToUnmdItem('')).toBe('un');
  });
});

describe('roundClp', () => {
  it('redondea a entero', () => {
    expect(roundClp(100.49)).toBe(100);
    expect(roundClp(100.5)).toBe(101);
    expect(roundClp(100.51)).toBe(101);
    expect(roundClp(100)).toBe(100);
  });

  it('redondea negativos', () => {
    expect(roundClp(-100.6)).toBe(-101);
  });

  it('lanza para valores no finitos', () => {
    expect(() => roundClp(NaN)).toThrow();
    expect(() => roundClp(Infinity)).toThrow();
  });
});

describe('computeDteTotals', () => {
  it('una sola línea afecta', () => {
    const totals = computeDteTotals([{ taxRate: 19, lineTotal: 1190, taxAmount: 190 }]);
    expect(totals.mntNeto).toBe(1000);
    expect(totals.mntExe).toBe(0);
    expect(totals.iva).toBe(190);
    expect(totals.mntTotal).toBe(1190);
  });

  it('mezcla afecto + exento', () => {
    const totals = computeDteTotals([
      { taxRate: 19, lineTotal: 1190, taxAmount: 190 }, // neto 1000 + IVA 190
      { taxRate: 0, lineTotal: 500, taxAmount: 0 }, // exento 500
    ]);
    expect(totals.mntNeto).toBe(1000);
    expect(totals.mntExe).toBe(500);
    expect(totals.iva).toBe(190);
    expect(totals.mntTotal).toBe(1690);
  });

  it('todas exentas → IVA 0', () => {
    const totals = computeDteTotals([
      { taxRate: 0, lineTotal: 100, taxAmount: 0 },
      { taxRate: 0, lineTotal: 250, taxAmount: 0 },
    ]);
    expect(totals.mntNeto).toBe(0);
    expect(totals.mntExe).toBe(350);
    expect(totals.iva).toBe(0);
    expect(totals.mntTotal).toBe(350);
  });

  it('TASA_IVA_CL constante exportada para serializer', () => {
    expect(TASA_IVA_CL).toBe(19);
  });
});
