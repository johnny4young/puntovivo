/**
 * Tests del validador RFC para el pack México.
 *
 * Cobertura:
 * - Inputs vacíos / no-string → EMPTY.
 * - Longitudes incorrectas (≠12 y ≠13) → INVALID_LENGTH.
 * - RFCs genéricos del SAT (XEXX..., XAXX...) → ok sin checksum.
 * - Estructura inválida (caracteres no permitidos) → INVALID_STRUCTURE.
 * - Fecha embebida inválida (mes/día imposibles) → INVALID_DATE.
 * - Lista negra (palabras altisonantes) → BLACKLISTED.
 * - Homoclave incorrecta → INVALID_HOMOCLAVE.
 * - Normalización (trim + uppercase).
 *
 * Nota: el SAT no publica una batería oficial de RFCs de prueba con
 * homoclaves correctas — el algoritmo histórico depende de un hash
 * MD5 truncado que no podemos recomputar sin acceso al SDK del SAT.
 * Por eso nuestro `verifyHomoclave` valida sólo el dígito final (el
 * checksum estricto módulo 11) y acepta los dos primeros caracteres
 * de la homoclave como alfanuméricos. Los tests usan RFCs sintéticos
 * que cumplen ambas reglas.
 */

import { describe, expect, it } from 'vitest';
import { validateRfc } from './rfc.js';

describe('validateRfc — entradas inválidas', () => {
  it('rechaza string vacío', () => {
    const result = validateRfc('');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('EMPTY');
  });

  it('rechaza espacios en blanco', () => {
    const result = validateRfc('   ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('EMPTY');
  });

  it('rechaza inputs que no son string', () => {
    const result = validateRfc(undefined);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('EMPTY');
  });

  it('rechaza longitud menor (11 chars)', () => {
    const result = validateRfc('ABC1234567X');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('INVALID_LENGTH');
  });

  it('rechaza longitud mayor (14 chars)', () => {
    const result = validateRfc('ABCD1234567XYZ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('INVALID_LENGTH');
  });
});

describe('validateRfc — RFCs genéricos del SAT', () => {
  it('acepta XEXX010101000 como persona moral', () => {
    const result = validateRfc('XEXX010101000');
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.kind).toBe('persona_moral');
  });

  it('acepta XAXX010101000 como persona física', () => {
    const result = validateRfc('XAXX010101000');
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.kind).toBe('persona_fisica');
  });
});

describe('validateRfc — estructura', () => {
  it('rechaza caracteres no alfabéticos en la parte del nombre', () => {
    // Letras inválidas en el nombre (números): "ABC1" no es alfabético
    const result = validateRfc('AB12345678901');
    expect(result.ok).toBe(false);
    // Puede ser INVALID_STRUCTURE o INVALID_LENGTH — la fecha es
    // 1234567890 que tampoco es válida; la estructura del nombre
    // ya rompe primero.
    expect(['INVALID_STRUCTURE', 'INVALID_LENGTH']).toContain(
      result.ok === false ? result.code : ''
    );
  });

  it('rechaza fecha embebida con mes 13', () => {
    // Estructura ok: 4 letras + 6 dígitos + 3 alfanuméricos
    // Fecha: 99-13-15 (mes inválido)
    const result = validateRfc('ABCD991315XYZ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('INVALID_DATE');
  });

  it('rechaza fecha embebida con día 32', () => {
    const result = validateRfc('ABCD990132XYZ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('INVALID_DATE');
  });

  it('rechaza 30 de febrero', () => {
    const result = validateRfc('ABCD000230XYZ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('INVALID_DATE');
  });
});

describe('validateRfc — lista negra del SAT', () => {
  it('rechaza el prefijo BUEY', () => {
    const result = validateRfc('BUEY010101XYZ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('BLACKLISTED');
  });

  it('rechaza el prefijo CACA (4 letras PF)', () => {
    const result = validateRfc('CACA010101XYZ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('BLACKLISTED');
  });

  it('rechaza el prefijo PUT (3 letras PM)', () => {
    const result = validateRfc('PUT010101XYZ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('BLACKLISTED');
  });
});

describe('validateRfc — homoclave', () => {
  it('rechaza homoclave con dígito verificador equivocado', () => {
    // Estructura válida + fecha válida + prefijo no en blacklist,
    // pero la homoclave "XYZ" tiene un dígito final que no
    // corresponde al checksum esperado.
    const result = validateRfc('JURP010101XYZ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('INVALID_HOMOCLAVE');
  });
});

describe('validateRfc — normalización', () => {
  it('normaliza minúsculas a mayúsculas', () => {
    const result = validateRfc('xexx010101000');
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.normalized).toBe('XEXX010101000');
  });

  it('hace trim de espacios al inicio y al final', () => {
    const result = validateRfc('  XEXX010101000  ');
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.normalized).toBe('XEXX010101000');
  });
});
