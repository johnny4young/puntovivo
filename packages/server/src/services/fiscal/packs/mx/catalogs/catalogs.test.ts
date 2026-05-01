/**
 * ENG-035a — Tests de los catálogos SAT del pack México.
 *
 * Cobertura mínima:
 * - Cada catálogo tiene la longitud esperada (curado para retail).
 * - Códigos clave que el adapter consume están presentes.
 * - El finder por código funciona y devuelve undefined para códigos
 *   desconocidos.
 * - El fallback `CLAVE_UNIDAD_FALLBACK` (H87 Pieza) existe en el
 *   catálogo (defensa contra una edición que rompa el contrato).
 */

import { describe, expect, it } from 'vitest';
import {
  CLAVE_UNIDAD_CATALOG,
  CLAVE_UNIDAD_FALLBACK,
  findClaveUnidad,
} from './claveUnidad.js';
import { FORMA_PAGO_CATALOG, findFormaPago } from './formaPago.js';
import {
  REGIMEN_FISCAL_CATALOG,
  findRegimenFiscal,
} from './regimenFiscal.js';
import { USO_CFDI_CATALOG, findUsoCfdi } from './usoCfdi.js';

describe('regimenFiscal — catálogo SAT (ENG-035a)', () => {
  it('contiene al menos 23 regímenes curados', () => {
    expect(REGIMEN_FISCAL_CATALOG.length).toBeGreaterThanOrEqual(23);
  });

  it('incluye 601 General Personas Morales', () => {
    const entry = findRegimenFiscal('601');
    expect(entry).toBeDefined();
    expect(entry?.appliesTo).toBe('PM');
  });

  it('incluye 626 Régimen Simplificado de Confianza (RESICO)', () => {
    const entry = findRegimenFiscal('626');
    expect(entry).toBeDefined();
    expect(entry?.appliesTo).toBe('BOTH');
  });

  it('incluye 612 Personas Físicas con Actividades Empresariales', () => {
    const entry = findRegimenFiscal('612');
    expect(entry).toBeDefined();
    expect(entry?.appliesTo).toBe('PF');
  });

  it('devuelve undefined para un código no existente', () => {
    expect(findRegimenFiscal('999')).toBeUndefined();
  });
});

describe('usoCfdi — catálogo SAT (ENG-035a)', () => {
  it('contiene al menos 22 usos curados', () => {
    expect(USO_CFDI_CATALOG.length).toBeGreaterThanOrEqual(22);
  });

  it('incluye G03 Gastos en general (uso retail más común)', () => {
    expect(findUsoCfdi('G03')).toBeDefined();
  });

  it('incluye S01 Sin efectos fiscales (fallback ticket público)', () => {
    expect(findUsoCfdi('S01')).toBeDefined();
  });

  it('devuelve undefined para un código no existente', () => {
    expect(findUsoCfdi('ZZ99')).toBeUndefined();
  });
});

describe('formaPago — catálogo SAT (ENG-035a)', () => {
  it('contiene al menos 22 formas de pago curadas', () => {
    expect(FORMA_PAGO_CATALOG.length).toBeGreaterThanOrEqual(22);
  });

  it('incluye 01 Efectivo como forma definitiva', () => {
    const entry = findFormaPago('01');
    expect(entry).toBeDefined();
    expect(entry?.isDefinitive).toBe(true);
  });

  it('incluye 04 Tarjeta de crédito y 28 Tarjeta de débito', () => {
    expect(findFormaPago('04')).toBeDefined();
    expect(findFormaPago('28')).toBeDefined();
  });

  it('99 Por definir es la única forma no definitiva del subset', () => {
    const entry = findFormaPago('99');
    expect(entry).toBeDefined();
    expect(entry?.isDefinitive).toBe(false);
  });
});

describe('claveUnidad — catálogo SAT (ENG-035a)', () => {
  it('contiene al menos 20 unidades curadas', () => {
    expect(CLAVE_UNIDAD_CATALOG.length).toBeGreaterThanOrEqual(20);
  });

  it('el fallback CLAVE_UNIDAD_FALLBACK (H87 Pieza) existe en el catálogo', () => {
    const entry = findClaveUnidad(CLAVE_UNIDAD_FALLBACK);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('Pieza');
  });

  it('incluye unidades comunes: KGM, LTR, MTR', () => {
    expect(findClaveUnidad('KGM')).toBeDefined();
    expect(findClaveUnidad('LTR')).toBeDefined();
    expect(findClaveUnidad('MTR')).toBeDefined();
  });

  it('devuelve undefined para un código no existente', () => {
    expect(findClaveUnidad('ZZZZ')).toBeUndefined();
  });
});
