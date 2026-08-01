export type CustomerCatalogKey =
  'identificationTypes' | 'personTypes' | 'regimeTypes' | 'clientTypes' | 'commercialActivities';

/**
 * Stable task order for customer fiscal catalogs. Visible labels and guidance
 * live in the feature namespace so this module remains locale-independent.
 */
export const customerCatalogTabs: readonly CustomerCatalogKey[] = [
  'identificationTypes',
  'personTypes',
  'regimeTypes',
  'clientTypes',
  'commercialActivities',
];
