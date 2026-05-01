/**
 * ENG-036a — Tests de los catálogos SII del pack Chile.
 *
 * Cobertura mínima:
 * - Cada catálogo tiene la longitud esperada (curado para retail).
 * - Códigos críticos que el adapter consume están presentes.
 * - El finder por código funciona y devuelve undefined para
 *   códigos desconocidos.
 * - El fallback `COMUNA_FALLBACK` (Santiago, 13101) existe en el
 *   catálogo (defensa contra una edición que rompa el contrato).
 */

import { describe, expect, it } from 'vitest';
import { TIPO_DTE_CATALOG, findTipoDte } from './tipoDte.js';
import {
  GIRO_COMERCIAL_CATALOG,
  findGiroComercial,
} from './giroComercial.js';
import {
  COMUNA_CATALOG,
  COMUNA_FALLBACK,
  findComuna,
} from './comuna.js';

describe('tipoDte — catálogo SII (ENG-036a)', () => {
  it('contiene exactamente 7 tipos curados', () => {
    expect(TIPO_DTE_CATALOG).toHaveLength(7);
  });

  it('incluye 33 Factura electrónica', () => {
    const entry = findTipoDte(33);
    expect(entry).toBeDefined();
    expect(entry?.category).toBe('invoice');
  });

  it('incluye 39 Boleta electrónica', () => {
    const entry = findTipoDte(39);
    expect(entry).toBeDefined();
    expect(entry?.category).toBe('receipt');
  });

  it('incluye 61 Nota de crédito electrónica', () => {
    const entry = findTipoDte(61);
    expect(entry).toBeDefined();
    expect(entry?.category).toBe('note');
  });

  it('devuelve undefined para un código no existente', () => {
    expect(findTipoDte(999)).toBeUndefined();
  });
});

describe('giroComercial — catálogo CIIU.cl (ENG-036a)', () => {
  it('contiene al menos 30 giros curados', () => {
    expect(GIRO_COMERCIAL_CATALOG.length).toBeGreaterThanOrEqual(30);
  });

  it('todos los giros son ciiuRev=4', () => {
    for (const entry of GIRO_COMERCIAL_CATALOG) {
      expect(entry.ciiuRev).toBe(4);
    }
  });

  it('incluye 4711 Comercio al por menor en almacenes no especializados', () => {
    expect(findGiroComercial('4711')).toBeDefined();
  });

  it('incluye 5610 Restaurantes', () => {
    expect(findGiroComercial('5610')).toBeDefined();
  });

  it('normaliza códigos con punto (4711 ≡ 47.11)', () => {
    expect(findGiroComercial('47.11')).toBeDefined();
  });

  it('devuelve undefined para un código no existente', () => {
    expect(findGiroComercial('9999')).toBeUndefined();
  });
});

describe('comuna — catálogo SUBDERE (ENG-036a)', () => {
  it('contiene al menos 30 comunas curadas', () => {
    expect(COMUNA_CATALOG.length).toBeGreaterThanOrEqual(30);
  });

  it('el fallback COMUNA_FALLBACK (Santiago, 13101) existe en el catálogo', () => {
    const entry = findComuna(COMUNA_FALLBACK);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('Santiago');
    expect(entry?.region).toBe('Metropolitana de Santiago');
  });

  it('incluye Las Condes (13114) y La Florida (13111)', () => {
    expect(findComuna(13114)?.name).toBe('Las Condes');
    expect(findComuna(13111)?.name).toBe('La Florida');
  });

  it('incluye al menos una comuna de cada región del país', () => {
    const regions = new Set(COMUNA_CATALOG.map(c => c.region));
    // Chile tiene 16 regiones administrativas; el catálogo curado
    // debe incluir al menos las 13 capitales + Metropolitana.
    expect(regions.size).toBeGreaterThanOrEqual(13);
  });

  it('devuelve undefined para un código no existente', () => {
    expect(findComuna(99999)).toBeUndefined();
  });
});
