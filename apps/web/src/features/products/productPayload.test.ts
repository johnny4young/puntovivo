import { describe, expect, it } from 'vitest';

import { createDefaultValues } from './productForm.helpers';
import { buildProductPayload } from './productPayload';

describe('buildProductPayload (ENG-110a)', () => {
  it('omits derived stock from tracked product updates', () => {
    const values = { ...createDefaultValues(), stock: 8, tracksLots: true };

    expect(buildProductPayload(values, { includeStock: false })).not.toHaveProperty('stock');
    expect(buildProductPayload(values)).toHaveProperty('stock', 8);
  });
});
