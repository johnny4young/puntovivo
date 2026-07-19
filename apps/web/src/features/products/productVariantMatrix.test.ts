import { describe, expect, it } from 'vitest';
import { buildVariantPreview, parseVariantAxes } from './productVariantMatrix';

describe('productVariantMatrix (ENG-110b)', () => {
  it('builds the same deterministic cartesian preview as the server', () => {
    const parsed = parseVariantAxes([
      { name: 'Size', valuesText: 'S, M' },
      { name: 'Color', valuesText: 'Blue, Red' },
    ]);
    expect(parsed.error).toBeNull();
    expect(buildVariantPreview({ name: 'Classic Shirt', sku: 'SHIRT' }, parsed.axes)).toEqual([
      {
        name: 'Classic Shirt · S / Blue',
        sku: 'SHIRT-S-BLUE',
        values: { Size: 'S', Color: 'Blue' },
      },
      { name: 'Classic Shirt · S / Red', sku: 'SHIRT-S-RED', values: { Size: 'S', Color: 'Red' } },
      {
        name: 'Classic Shirt · M / Blue',
        sku: 'SHIRT-M-BLUE',
        values: { Size: 'M', Color: 'Blue' },
      },
      { name: 'Classic Shirt · M / Red', sku: 'SHIRT-M-RED', values: { Size: 'M', Color: 'Red' } },
    ]);
  });

  it('rejects duplicate axes, duplicate values and matrices above 100 combinations', () => {
    expect(
      parseVariantAxes([
        { name: 'Color', valuesText: 'Blue' },
        { name: 'color', valuesText: 'Red' },
      ]).error
    ).toBe('duplicateAxis');
    expect(parseVariantAxes([{ name: 'Color', valuesText: 'Blue, blue' }]).error).toBe(
      'duplicateValue'
    );
    expect(
      parseVariantAxes([
        { name: 'A', valuesText: Array.from({ length: 11 }, (_, index) => `A${index}`).join(',') },
        { name: 'B', valuesText: Array.from({ length: 10 }, (_, index) => `B${index}`).join(',') },
      ]).error
    ).toBe('tooManyCombinations');
  });

  it('disambiguates SKU tokens that normalize to the same value', () => {
    const axes = parseVariantAxes([{ name: 'Style', valuesText: 'Rojo!, Rojo' }]).axes;
    expect(buildVariantPreview({ name: 'Camisa', sku: 'CAM' }, axes).map(row => row.sku)).toEqual([
      'CAM-ROJO-1',
      'CAM-ROJO-2',
    ]);
  });

  it('keeps adversarial suffix collisions and Unicode SKU cuts deterministic', () => {
    const sameAxis = buildVariantPreview(
      { name: 'Collision', sku: 'COLLISION' },
      parseVariantAxes([{ name: 'Style', valuesText: 'A, A!, A-1' }]).axes
    );
    expect(sameAxis.map(row => row.sku)).toEqual([
      'COLLISION-A-1',
      'COLLISION-A-2',
      'COLLISION-A-1-2',
    ]);

    const crossAxis = buildVariantPreview(
      { name: 'Cross axis', sku: 'CROSS' },
      parseVariantAxes([
        { name: 'Left', valuesText: 'A, A-B' },
        { name: 'Right', valuesText: 'B-C, C' },
      ]).axes
    );
    expect(crossAxis.map(row => row.sku)).toEqual([
      'CROSS-A-B-C',
      'CROSS-A-C',
      'CROSS-A-B-B-C',
      'CROSS-A-B-C-2',
    ]);
    expect(new Set(crossAxis.map(row => row.sku)).size).toBe(crossAxis.length);

    const unicodeParentSku = `${'A'.repeat(97)}😀B`;
    expect(unicodeParentSku).toHaveLength(100);
    const unicode = buildVariantPreview(
      { name: 'Unicode SKU', sku: unicodeParentSku },
      parseVariantAxes([{ name: 'Size', valuesText: 'S' }]).axes
    );
    expect(unicode[0]?.sku).toBe(`${'A'.repeat(97)}-S`);
    expect(unicode[0]?.sku).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it('reserves name space for the option label when the parent name is maximal', () => {
    const axes = parseVariantAxes([
      { name: 'Color', valuesText: 'Ocean Blue, Sunset Red' },
    ]).axes;
    const preview = buildVariantPreview({ name: 'P'.repeat(255), sku: 'MAX' }, axes);

    expect(preview.map(row => row.name)).toEqual([
      expect.stringMatching(/ · Ocean Blue$/),
      expect.stringMatching(/ · Sunset Red$/),
    ]);
    expect(preview.every(row => row.name.length <= 255)).toBe(true);
    expect(new Set(preview.map(row => row.name)).size).toBe(2);

    const unicodeParentName = `${'A'.repeat(241)}😀${'B'.repeat(12)}`;
    expect(unicodeParentName).toHaveLength(255);
    const unicodePreview = buildVariantPreview(
      { name: unicodeParentName, sku: 'UNICODE' },
      parseVariantAxes([{ name: 'Color', valuesText: 'Ocean Blue' }]).axes
    );
    expect(unicodePreview[0]?.name).toBe(`${'A'.repeat(241)} · Ocean Blue`);
  });
});
