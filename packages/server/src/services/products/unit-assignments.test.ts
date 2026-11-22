import { describe, expect, it } from 'vitest';
import { validateUnitAssignments } from './mutation-helpers';

type Assignments = Parameters<typeof validateUnitAssignments>[0];
type Assignment = Assignments[number];

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    unitId: 'unit-each',
    equivalence: 1,
    price: 1000,
    price2: 0,
    price3: 0,
    isBase: true,
    ...overrides,
  } as Assignment;
}

describe('validateUnitAssignments packaging barcodes', () => {
  it('rejects two presentations sharing a barcode', () => {
    expect(() =>
      validateUnitAssignments([
        assignment(),
        assignment({
          unitId: 'unit-case',
          equivalence: 12,
          isBase: false,
          barcode: '7701234567897',
        }),
        assignment({
          unitId: 'unit-box',
          equivalence: 24,
          isBase: false,
          barcode: '7701234567897',
        }),
      ] as Assignments)
    ).toThrow(/unique within a product/);
  });

  it('accepts distinct packaging barcodes', () => {
    expect(() =>
      validateUnitAssignments([
        assignment(),
        assignment({
          unitId: 'unit-case',
          equivalence: 12,
          isBase: false,
          barcode: '7701234567897',
        }),
        assignment({
          unitId: 'unit-box',
          equivalence: 24,
          isBase: false,
          barcode: '7701234567880',
        }),
      ] as Assignments)
    ).not.toThrow();
  });

  it('ignores blank barcodes so two presentations can both have none', () => {
    expect(() =>
      validateUnitAssignments([
        assignment(),
        assignment({ unitId: 'unit-case', equivalence: 12, isBase: false, barcode: '' }),
        assignment({ unitId: 'unit-box', equivalence: 24, isBase: false, barcode: '   ' }),
      ] as Assignments)
    ).not.toThrow();
  });
  it('rejects a non-base presentation that reuses the product barcode', () => {
    expect(() =>
      validateUnitAssignments(
        [
          assignment(),
          assignment({ unitId: 'unit-case', equivalence: 12, isBase: false, barcode: '770111' }),
        ] as Assignments,
        '770111'
      )
    ).toThrow(/cannot equal the product barcode/);
  });

  it('rejects a new presentation GTIN with a bad check digit but keeps stored ones', () => {
    const bad = [
      assignment(),
      assignment({ unitId: 'unit-case', equivalence: 12, isBase: false, barcode: '7701234567890' }),
    ] as Assignments;
    expect(() => validateUnitAssignments(bad)).toThrow(/check digit/);
    expect(() => validateUnitAssignments(bad, null, new Set(['7701234567890']))).not.toThrow();
  });

  it('lets the base presentation reuse the product barcode', () => {
    expect(() =>
      validateUnitAssignments([assignment({ barcode: '770111' })] as Assignments, '770111')
    ).not.toThrow();
  });
});
