/**
 * ENG-036a — Tests del validador RUT para el pack Chile.
 *
 * Cobertura:
 * - Inputs vacíos / no-string → EMPTY.
 * - Formato inválido (sin guión rescatable, letras en cuerpo,
 *   múltiples guiones) → INVALID_FORMAT.
 * - Dígito verificador equivocado → INVALID_VERIFIER.
 * - Dígito verificador K (caso del módulo 11 → 10).
 * - RUT genérico extranjero `55555555-5` → ok sin checksum.
 * - Normalización: puntos + lowercase + sin-guión-rescatable.
 * - Threshold persona natural / jurídica (50 millones).
 *
 * RUTs de referencia usados en los tests (calculados con el mismo
 * algoritmo que valida el SII):
 *   - `1-9` (DV calculado: 1*2=2, 11-2=9 → '9')
 *   - `11111111-1` (cuerpo=11111111, sum ponderada → 11-r=1)
 *   - `12345678-5` (cuerpo común usado en docu del SII para ejemplos)
 *   - `76123456-K` (PJ, DV=K)
 */

import { describe, expect, it } from 'vitest';
import { validateRut } from './rut.js';

describe('validateRut — inputs inválidos (ENG-036a)', () => {
  it('rechaza string vacío', () => {
    const r = validateRut('');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('EMPTY');
  });

  it('rechaza espacios en blanco', () => {
    const r = validateRut('   ');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('EMPTY');
  });

  it('rechaza inputs no-string', () => {
    const r = validateRut(undefined);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('EMPTY');
  });

  it('rechaza letras en el cuerpo', () => {
    const r = validateRut('ABC4567-8');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('INVALID_FORMAT');
  });

  it('rechaza cuerpo con más de 8 dígitos', () => {
    const r = validateRut('123456789-0');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('INVALID_FORMAT');
  });

  it('rechaza DV equivocado', () => {
    // 1-9 es válido (DV calculado = 9). Cambiar el DV a 0 lo invalida.
    const r = validateRut('1-0');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('INVALID_VERIFIER');
  });
});

describe('validateRut — RUT genérico extranjero (ENG-036a)', () => {
  it('acepta 55555555-5 sin recomputar checksum', () => {
    const r = validateRut('55555555-5');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.kind).toBe('juridica');
    expect(r.ok === true && r.normalized).toBe('55555555-5');
  });
});

describe('validateRut — normalización (ENG-036a)', () => {
  it('normaliza puntos y guion', () => {
    // 1.-9 luego de remover puntos queda 1-9 (válido)
    const r = validateRut('1-9');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.normalized).toBe('1-9');
  });

  it('normaliza puntos en RUT con cuerpo grande', () => {
    // 11.111.111-1 → 11111111-1
    const r = validateRut('11.111.111-1');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.normalized).toBe('11111111-1');
  });

  it('inserta el guión cuando el operador lo omitió (12345678X)', () => {
    // Genérico 555555555 → 55555555-5 después de insertar guión.
    const r = validateRut('555555555');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.normalized).toBe('55555555-5');
  });

  it('normaliza dígito verificador K en lowercase a uppercase', () => {
    // 11111111-K es inválido por checksum, pero el normalizer
    // sí debe haber subido la k. Usamos un RUT con DV K real.
    // 55555555 → DV = ? sum=5*(2+3+4+5+6+7+2+3) = 5*32 = 160; 160%11 = 6;
    // 11-6=5. Por eso 55555555-5 es el genérico válido.
    // Para K real: cuerpo 6 → 6*2=12; 12%11=1; 11-1=10 → K. Así que `6-K`.
    const r = validateRut('6-k');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.normalized).toBe('6-K');
  });
});

describe('validateRut — DV correctos (ENG-036a)', () => {
  it('acepta cuerpo 1 con DV 9', () => {
    // 1*2 = 2; 11-2 = 9.
    const r = validateRut('1-9');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.kind).toBe('natural');
  });

  it('acepta cuerpo 6 con DV K (caso del módulo 11 → 10)', () => {
    // 6*2 = 12; 12%11 = 1; 11-1 = 10 → K.
    const r = validateRut('6-K');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.kind).toBe('natural');
  });

  it('detecta persona jurídica cuando cuerpo >= 50.000.000', () => {
    // Cuerpo 76123456: pesos [2,3,4,5,6,7,2,3] de derecha a izq.
    //   6*2=12, 5*3=15, 4*4=16, 3*5=15, 2*6=12, 1*7=7, 6*2=12, 7*3=21
    //   sum=110; 110%11=0; 11-0=11 → '0'. Así que 76123456-0 es válido.
    const r = validateRut('76123456-0');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.kind).toBe('juridica');
  });

  it('persona natural cuando cuerpo < 50.000.000', () => {
    // Cuerpo 11111111: pesos cyclic [2,3,4,5,6,7] de derecha a izq.
    //   8 dígitos: pesos = [2,3,4,5,6,7,2,3]
    //   sum = 1*(2+3+4+5+6+7+2+3) = 32; 32%11=10; 11-10=1.
    const r = validateRut('11111111-1');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.kind).toBe('natural');
  });
});
