import type { TFunction } from 'i18next';

import type { CustomerCatalogItem } from '@/types';
import type { CustomerCatalogKey } from './customerCatalogConfig';

interface LegacySeedDefinition {
  legacyNames: readonly string[];
  translationKey: string;
}

type CatalogSeedDefinitions = Partial<Record<string, LegacySeedDefinition>>;

/**
 * Names shipped by the original installer and the richer development seed.
 * Matching stays deliberately exact: an operator-owned label with the same
 * fiscal code is business data and must never be replaced by UI translation.
 */
const legacySeedDefinitions: Record<CustomerCatalogKey, CatalogSeedDefinitions> = {
  identificationTypes: {
    CC: {
      legacyNames: ['Cedula de Ciudadania', 'Cédula de ciudadanía'],
      translationKey: 'seededNames.identificationTypes.CC',
    },
    NIT: {
      legacyNames: ['Numero de Identificacion Tributaria', 'NIT'],
      translationKey: 'seededNames.identificationTypes.NIT',
    },
    CE: {
      legacyNames: ['Cedula de Extranjeria', 'Cédula de extranjería'],
      translationKey: 'seededNames.identificationTypes.CE',
    },
    PA: {
      legacyNames: ['Pasaporte'],
      translationKey: 'seededNames.identificationTypes.PA',
    },
    TI: {
      legacyNames: ['Tarjeta de identidad'],
      translationKey: 'seededNames.identificationTypes.TI',
    },
  },
  personTypes: {
    natural: {
      legacyNames: ['Natural Person', 'Persona natural'],
      translationKey: 'seededNames.personTypes.natural',
    },
    juridica: {
      legacyNames: ['Legal Entity', 'Persona jurídica'],
      translationKey: 'seededNames.personTypes.juridica',
    },
  },
  regimeTypes: {
    simplified: {
      legacyNames: ['Simplified Regime'],
      translationKey: 'seededNames.regimeTypes.simplified',
    },
    common: {
      legacyNames: ['Common Regime'],
      translationKey: 'seededNames.regimeTypes.common',
    },
    responsable_iva: {
      legacyNames: ['Responsable de IVA'],
      translationKey: 'seededNames.regimeTypes.responsable_iva',
    },
    no_responsable_iva: {
      legacyNames: ['No responsable de IVA'],
      translationKey: 'seededNames.regimeTypes.no_responsable_iva',
    },
  },
  clientTypes: {
    retail: {
      legacyNames: ['Retail Customer', 'Cliente minorista'],
      translationKey: 'seededNames.clientTypes.retail',
    },
    wholesale: {
      legacyNames: ['Wholesale Customer', 'Cliente mayorista'],
      translationKey: 'seededNames.clientTypes.wholesale',
    },
  },
  commercialActivities: {
    '4711': {
      legacyNames: [
        'Retail Trade in General Stores',
        'Comercio al por menor en establecimientos no especializados',
      ],
      translationKey: 'seededNames.commercialActivities.4711',
    },
    '4649': {
      legacyNames: ['Wholesale Trade in Consumer Goods'],
      translationKey: 'seededNames.commercialActivities.4649',
    },
    '4723': {
      legacyNames: ['Comercio al por menor de bebidas y productos del tabaco'],
      translationKey: 'seededNames.commercialActivities.4723',
    },
  },
};

/**
 * Resolve a known installer-supplied name into the active locale without
 * changing its stored name or stable fiscal/commercial code.
 */
export function resolveCustomerCatalogDisplayName(
  t: TFunction<'customerCatalogs'>,
  catalog: CustomerCatalogKey,
  item: Pick<CustomerCatalogItem, 'code' | 'name'>
): string {
  const definition = legacySeedDefinitions[catalog][item.code];

  if (!definition?.legacyNames.includes(item.name)) {
    return item.name;
  }

  return t(definition.translationKey);
}
