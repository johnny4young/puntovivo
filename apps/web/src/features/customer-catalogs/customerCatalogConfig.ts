export type CustomerCatalogKey =
  | 'identificationTypes'
  | 'personTypes'
  | 'regimeTypes'
  | 'clientTypes'
  | 'commercialActivities';

export interface CustomerCatalogConfig {
  singularLabel: string;
  pluralLabel: string;
  description: string;
  searchPlaceholder: string;
}

export const customerCatalogConfig: Record<CustomerCatalogKey, CustomerCatalogConfig> = {
  identificationTypes: {
    singularLabel: 'Identification Type',
    pluralLabel: 'Identification Types',
    description: 'Manage the identification code catalog used by customer tax profiles.',
    searchPlaceholder: 'Search identification types...',
  },
  personTypes: {
    singularLabel: 'Person Type',
    pluralLabel: 'Person Types',
    description: 'Manage natural-person and legal-entity classifications for customers.',
    searchPlaceholder: 'Search person types...',
  },
  regimeTypes: {
    singularLabel: 'Regime Type',
    pluralLabel: 'Regime Types',
    description: 'Manage tax-regime codes used in customer fiscal classification.',
    searchPlaceholder: 'Search regime types...',
  },
  clientTypes: {
    singularLabel: 'Client Type',
    pluralLabel: 'Client Types',
    description: 'Manage commercial client classifications such as retail and wholesale.',
    searchPlaceholder: 'Search client types...',
  },
  commercialActivities: {
    singularLabel: 'Commercial Activity',
    pluralLabel: 'Commercial Activities',
    description: 'Manage business activity codes used in customer fiscal and commercial classification.',
    searchPlaceholder: 'Search commercial activities...',
  },
};

export const customerCatalogTabs = Object.entries(customerCatalogConfig) as Array<
  [CustomerCatalogKey, CustomerCatalogConfig]
>;
