import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import { resolveCustomerCatalogDisplayName } from './customerCatalogDisplayName';

describe('resolveCustomerCatalogDisplayName', () => {
  it('localizes both installer and development seed names', () => {
    const tEnglish = i18next.getFixedT('en', 'customerCatalogs');
    const tSpanish = i18next.getFixedT('es', 'customerCatalogs');

    expect(
      resolveCustomerCatalogDisplayName(tEnglish, 'identificationTypes', {
        code: 'CC',
        name: 'Cédula de ciudadanía',
      })
    ).toBe('Citizenship ID');
    expect(
      resolveCustomerCatalogDisplayName(tSpanish, 'identificationTypes', {
        code: 'CC',
        name: 'Cedula de Ciudadania',
      })
    ).toBe('Cédula de ciudadanía');
    expect(
      resolveCustomerCatalogDisplayName(tSpanish, 'commercialActivities', {
        code: '4649',
        name: 'Wholesale Trade in Consumer Goods',
      })
    ).toBe('Comercio al por mayor de bienes de consumo');
  });

  it('preserves customized and unknown names even when their code is recognized', () => {
    const tEnglish = i18next.getFixedT('en', 'customerCatalogs');

    expect(
      resolveCustomerCatalogDisplayName(tEnglish, 'clientTypes', {
        code: 'retail',
        name: 'Neighborhood member',
      })
    ).toBe('Neighborhood member');
    expect(
      resolveCustomerCatalogDisplayName(tEnglish, 'clientTypes', {
        code: 'VIP',
        name: 'Priority customer',
      })
    ).toBe('Priority customer');
  });
});
