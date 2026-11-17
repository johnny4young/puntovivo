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
        assignment({ unitId: 'unit-case', equivalence: 12, isBase: false, barcode: '7701234567890' }),
        assignment({ unitId: 'unit-box', equivalence: 24, isBase: false, barcode: '7701234567890' }),
      ] as Assignments)
    ).toThrow(/unique within a product/);
  });

  it('accepts distinct packaging barcodes', () => {
    expect(() =>
      validateUnitAssignments([
        assignment(),
        assignment({ unitId: 'unit-case', equivalence: 12, isBase: false, barcode: '7701234567890' }),
        assignment({ unitId: 'unit-box', equivalence: 24, isBase: false, barcode: '7701234567891' }),
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
});
