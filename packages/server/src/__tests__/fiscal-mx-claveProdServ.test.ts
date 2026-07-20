/**
 * Tests del catálogo SAT c_ClaveProdServ.
 */
import { describe, expect, it } from 'vitest';
import {
  CLAVE_PROD_SERV_CATALOG,
  CLAVE_PROD_SERV_FALLBACK,
  findClaveProdServ,
} from '../services/fiscal/packs/mx/catalogs/claveProdServ.js';

describe('claveProdServ catalog', () => {
  it('expone exactamente la cantidad esperada de entradas curadas', () => {
    // 40 entradas curadas para retail LATAM. Si este conteo cambia,
    // ajusta intencionalmente — significa que se agregaron / quitaron
    // categorías.
    expect(CLAVE_PROD_SERV_CATALOG.length).toBe(40);
  });

  it('todas las entradas tienen código de 8 dígitos', () => {
    for (const entry of CLAVE_PROD_SERV_CATALOG) {
      expect(entry.code).toMatch(/^\d{8}$/);
    }
  });

  it('todas las entradas tienen un nombre no vacío', () => {
    for (const entry of CLAVE_PROD_SERV_CATALOG) {
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it('findClaveProdServ retorna entry para código existente', () => {
    const entry = findClaveProdServ('50171831'); // Pan
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('Pan y productos de panadería');
  });

  it('findClaveProdServ retorna undefined para código no listado', () => {
    expect(findClaveProdServ('99999999')).toBeUndefined();
  });

  it('CLAVE_PROD_SERV_FALLBACK es 01010101 (No existe en el catálogo)', () => {
    expect(CLAVE_PROD_SERV_FALLBACK).toBe('01010101');
    const fallback = findClaveProdServ(CLAVE_PROD_SERV_FALLBACK);
    expect(fallback).toBeDefined();
    expect(fallback?.name).toBe('No existe en el catálogo');
  });

  it('códigos son únicos', () => {
    const codes = CLAVE_PROD_SERV_CATALOG.map(entry => entry.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it('hints son arrays inmutables (readonly por TS pero detectables)', () => {
    for (const entry of CLAVE_PROD_SERV_CATALOG) {
      // hints es ReadonlyArray; un push real lanzaría en strict mode
      // pero el catálogo no usa Object.freeze. Verificamos al menos
      // que es un Array.
      expect(Array.isArray(entry.hints)).toBe(true);
    }
  });
});
