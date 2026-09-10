import { describe, expect, it } from 'vitest';

import { createDefaultValues } from './productForm.helpers';
import { buildProductPayload } from './productPayload';

describe('buildProductPayload', () => {
  it('omits derived stock from tracked product updates', async () => {
    const values = { ...createDefaultValues(), stock: 8, tracksLots: true };

    expect(await buildProductPayload(values, { includeStock: false })).not.toHaveProperty('stock');
    expect(await buildProductPayload(values)).toHaveProperty('stock', 8);
  });

  it('never sends stock for a service item, whatever includeStock says', async () => {
    const values = { ...createDefaultValues(), stock: 8, tracksStock: false };

    expect(await buildProductPayload(values)).not.toHaveProperty('stock');
    expect(await buildProductPayload(values, { includeStock: true })).not.toHaveProperty('stock');
    expect(await buildProductPayload(values)).toHaveProperty('tracksStock', false);
  });

  it('sends stock again once the item is back to physical', async () => {
    const values = { ...createDefaultValues(), stock: 8, tracksStock: true };

    expect(await buildProductPayload(values)).toHaveProperty('stock', 8);
    expect(await buildProductPayload(values)).toHaveProperty('tracksStock', true);
  });

  it('omits the optional unit assignment collection when no unit was selected', async () => {
    expect(await buildProductPayload(createDefaultValues())).not.toHaveProperty('unitAssignments');
  });

  it('includes complete unit assignments', async () => {
    const values = {
      ...createDefaultValues(),
      unitAssignments: [
        {
          unitId: 'unit-each',
          equivalence: 1,
          price: 7000,
          price2: 6500,
          price3: 6000,
          isBase: true,
        },
      ],
    };

    expect(await buildProductPayload(values)).toHaveProperty('unitAssignments', [
      {
        unitId: 'unit-each',
        equivalence: 1,
        price: 7000,
        price2: 6500,
        price3: 6000,
        isBase: true,
      },
    ]);
  });

  it('serializes ordered normalized tax components only when selected', async () => {
    expect(await buildProductPayload(createDefaultValues())).not.toHaveProperty('taxComponents');

    const values = {
      ...createDefaultValues(),
      vatRateId: 'iva-19',
      taxRate: 19,
      taxComponentVatRateIds: ['iva-19', 'inc-8'],
    };
    expect(await buildProductPayload(values)).toHaveProperty('taxComponents', [
      { vatRateId: 'iva-19' },
      { vatRateId: 'inc-8' },
    ]);
  });

  it('normalizes the optional pharmacy profile without leaking blank strings', async () => {
    const values = createDefaultValues(true);
    values.pharmacy.activeIngredient = '  Acetaminophen  ';
    values.pharmacy.sanitaryRegistration = ' INVIMA 2026M-001 ';
    values.pharmacy.classification = 'prescription';
    values.pharmacy.requiresColdChain = true;

    expect(await buildProductPayload(values)).toHaveProperty('pharmacy', {
      activeIngredient: 'Acetaminophen',
      genericName: null,
      concentration: null,
      dosageForm: null,
      administrationRoute: null,
      presentation: null,
      manufacturer: null,
      authorizationHolder: null,
      sanitaryRegistration: 'INVIMA 2026M-001',
      registrationExpiresAt: null,
      classification: 'prescription',
      storageConditions: null,
      requiresColdChain: true,
    });
  });

  it('removes the pharmacy profile explicitly when medicine management is disabled', async () => {
    expect(await buildProductPayload(createDefaultValues())).toHaveProperty('pharmacy', null);
  });
});
