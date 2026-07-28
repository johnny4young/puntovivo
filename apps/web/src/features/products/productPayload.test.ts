import { describe, expect, it } from 'vitest';

import { createDefaultValues } from './productForm.helpers';
import { buildProductPayload } from './productPayload';

describe('buildProductPayload', () => {
  it('omits derived stock from tracked product updates', () => {
    const values = { ...createDefaultValues(), stock: 8, tracksLots: true };

    expect(buildProductPayload(values, { includeStock: false })).not.toHaveProperty('stock');
    expect(buildProductPayload(values)).toHaveProperty('stock', 8);
  });

  it('omits the optional unit assignment collection when no unit was selected', () => {
    expect(buildProductPayload(createDefaultValues())).not.toHaveProperty('unitAssignments');
  });

  it('includes complete unit assignments', () => {
    const values = {
      ...createDefaultValues(),
      unitAssignments: [{ unitId: 'unit-each', equivalence: 1, price: 7000, isBase: true }],
    };

    expect(buildProductPayload(values)).toHaveProperty('unitAssignments', [
      { unitId: 'unit-each', equivalence: 1, price: 7000, isBase: true },
    ]);
  });
});
