import { describe, expect, it } from 'vitest';

import { buildProductTemplateApplication } from './verticalProductTemplates';

const units = [
  { id: 'unit-each', name: 'Unit', abbreviation: 'UND', dimension: 'count' as const },
  {
    id: 'unit-kilo',
    name: 'Kilogram',
    abbreviation: 'kg',
    dimension: 'mass' as const,
    referenceFactor: 1000,
  },
  { id: 'unit-metre', name: 'Metre', abbreviation: 'MT', dimension: 'length' as const },
];

describe('buildProductTemplateApplication', () => {
  it.each([
    ['hardware-length', 'unit-metre', true, false, false, false],
    ['hardware-serialized', 'unit-each', false, false, true, true],
    ['hardware-lot', 'unit-each', false, true, false, true],
    ['butchery-weighted-cut', 'unit-kilo', true, true, false, true],
    ['butchery-packaged-cut', 'unit-each', false, true, false, true],
  ] as const)(
    'builds %s with the expected unit and mutually exclusive tracking',
    (templateId, unitId, sellByFraction, tracksLots, tracksSerials, resetsDirectStock) => {
      const result = buildProductTemplateApplication({
        templateId,
        units,
        prices: { cost: 20, price: 40, price2: 0, price3: 0 },
      });

      expect(result).toMatchObject({
        ok: true,
        application: {
          values: { sellByFraction, tracksLots, tracksSerials },
          unitAssignment: { unitId },
          resetsDirectStock,
        },
      });
    }
  );

  it('builds a weighted-cut patch with thousandths, lots and the existing KG unit', () => {
    const result = buildProductTemplateApplication({
      templateId: 'butchery-weighted-cut',
      units,
      prices: { cost: 20, price: 40, price2: 35, price3: 0 },
    });

    expect(result).toMatchObject({
      ok: true,
      application: {
        values: {
          sellByFraction: true,
          fractionStep: 0.001,
          fractionMinimum: 0.001,
          tracksLots: true,
          tracksSerials: false,
          price: 40,
          price2: 35,
          price3: 40,
        },
        unitAssignment: {
          unitId: 'unit-kilo',
          equivalence: 1,
          price: 40,
          price2: 35,
          price3: 40,
          isBase: true,
        },
        resetsDirectStock: true,
      },
    });
  });

  it('keeps hardware-length stock direct and never enables incompatible tracking modes', () => {
    const result = buildProductTemplateApplication({
      templateId: 'hardware-length',
      units,
      prices: { cost: 5, price: 10, price2: 0, price3: 0 },
    });
    expect(result).toMatchObject({
      ok: true,
      application: {
        values: { sellByFraction: true, tracksLots: false, tracksSerials: false },
        unitAssignment: { unitId: 'unit-metre' },
        resetsDirectStock: false,
      },
    });
  });

  it('returns a missing-unit result without fabricating a catalog row', () => {
    expect(
      buildProductTemplateApplication({
        templateId: 'butchery-weighted-cut',
        units: [{ id: 'each', name: 'Unit', abbreviation: 'UND', dimension: 'count' }],
        prices: { cost: 0, price: 0, price2: 0, price3: 0 },
      })
    ).toEqual({ ok: false, missingAbbreviations: ['KG', 'KGS', 'KILO'] });
  });

  it('rejects inactive or physically incompatible units with a matching abbreviation', () => {
    for (const candidate of [
      {
        id: 'inactive-kg',
        name: 'Inactive kilogram',
        abbreviation: 'KG',
        isActive: false,
        dimension: 'mass' as const,
        referenceFactor: 1000,
      },
      {
        id: 'count-kg',
        name: 'Misclassified kilogram',
        abbreviation: 'KG',
        isActive: true,
        dimension: 'count' as const,
        referenceFactor: 1,
      },
      {
        id: 'factorless-kg',
        name: 'Unconvertible kilogram',
        abbreviation: 'KG',
        isActive: true,
        dimension: 'mass' as const,
        referenceFactor: null,
      },
    ]) {
      expect(
        buildProductTemplateApplication({
          templateId: 'butchery-weighted-cut',
          units: [candidate],
          prices: { cost: 0, price: 0, price2: 0, price3: 0 },
        })
      ).toEqual({ ok: false, missingAbbreviations: ['KG', 'KGS', 'KILO'] });
    }
  });
});
