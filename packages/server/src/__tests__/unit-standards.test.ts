/**
 * Unit standards catalog (Auditoría 2026-07 — units foundation).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_UNIT_STANDARD_CODE,
  dimensionsAreCoherent,
  inferUnitDimension,
  lookupUnitStandard,
  normalizeUnitKey,
  resolveUnitStandardCode,
} from '../services/units/unit-standards.js';

describe('normalizeUnitKey', () => {
  it('upper-cases, folds superscripts/accents, strips non-alphanumerics', () => {
    expect(normalizeUnitKey('kg')).toBe('KG');
    expect(normalizeUnitKey('Kg.')).toBe('KG');
    expect(normalizeUnitKey('m²')).toBe('M2');
    expect(normalizeUnitKey('m³')).toBe('M3');
    expect(normalizeUnitKey(' Und. ')).toBe('UND');
  });
});

describe('lookupUnitStandard / inferUnitDimension', () => {
  it('maps common LatAm units to the right dimension + Rec 20 code', () => {
    expect(lookupUnitStandard('KG')).toEqual({
      dimension: 'mass',
      standardCode: 'KGM',
      referenceFactor: 1000,
    });
    expect(lookupUnitStandard('gr')).toEqual({
      dimension: 'mass',
      standardCode: 'GRM',
      referenceFactor: 1,
    });
    expect(lookupUnitStandard('LT')?.standardCode).toBe('LTR');
    expect(lookupUnitStandard('und')?.standardCode).toBe('C62');
    expect(inferUnitDimension('metro')).toBe('length');
  });

  it('folds aliases onto the same entry (Kilo == KG)', () => {
    expect(lookupUnitStandard('Kilo')).toEqual(lookupUnitStandard('KG'));
  });

  it('returns null for unknown units (best-effort, never throws)', () => {
    expect(lookupUnitStandard('ZZZ')).toBeNull();
    expect(inferUnitDimension('ZZZ')).toBeNull();
  });

  it('reference factors convert within a dimension (1 kg = 1000 g)', () => {
    const kg = lookupUnitStandard('KG')!;
    const gr = lookupUnitStandard('GR')!;
    // 2 kg expressed in grams via reference factors.
    expect((2 * kg.referenceFactor) / gr.referenceFactor).toBe(2000);
  });
});

describe('resolveUnitStandardCode (fiscal hook)', () => {
  it('prefers the explicit stored code', () => {
    expect(resolveUnitStandardCode({ standardCode: 'KGM', abbreviation: 'anything' })).toBe('KGM');
  });

  it('falls back to the catalog by abbreviation', () => {
    expect(resolveUnitStandardCode({ standardCode: null, abbreviation: 'LT' })).toBe('LTR');
  });

  it('falls back to the piece code when everything is unknown (never empty)', () => {
    expect(resolveUnitStandardCode({ standardCode: null, abbreviation: 'ZZZ' })).toBe(
      DEFAULT_UNIT_STANDARD_CODE
    );
    expect(resolveUnitStandardCode({ abbreviation: '' })).toBe(DEFAULT_UNIT_STANDARD_CODE);
  });

  it('ignores a blank stored code', () => {
    expect(resolveUnitStandardCode({ standardCode: '   ', abbreviation: 'KG' })).toBe('KGM');
  });
});

describe('dimensionsAreCoherent', () => {
  it('accepts a single dimension, nulls, and count mixed in', () => {
    expect(dimensionsAreCoherent(['mass'])).toBe(true);
    expect(dimensionsAreCoherent(['mass', 'mass'])).toBe(true);
    expect(dimensionsAreCoherent(['mass', null, 'count'])).toBe(true);
    expect(dimensionsAreCoherent([])).toBe(true);
  });

  it('rejects mixing incompatible physical dimensions (mass + length)', () => {
    expect(dimensionsAreCoherent(['mass', 'length'])).toBe(false);
    expect(dimensionsAreCoherent(['volume', 'mass'])).toBe(false);
  });
});
