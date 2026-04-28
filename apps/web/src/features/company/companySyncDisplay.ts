import type { TFunction } from 'i18next';

const SYNC_ENTITY_LABEL_KEYS: Record<string, string> = {
  categories: 'company.sync.entities.categories',
  customers: 'company.sync.entities.customers',
  inventory_movements: 'company.sync.entities.inventoryMovements',
  locations: 'company.sync.entities.locations',
  location_x_site: 'company.sync.entities.locationSiteLinks',
  logos: 'company.sync.entities.logos',
  order_items: 'company.sync.entities.orderItems',
  orders: 'company.sync.entities.orders',
  person_types: 'company.sync.entities.personTypes',
  products: 'company.sync.entities.products',
  providers: 'company.sync.entities.providers',
  purchase_items: 'company.sync.entities.purchaseItems',
  purchase_return_items: 'company.sync.entities.purchaseReturnItems',
  purchase_returns: 'company.sync.entities.purchaseReturns',
  purchases: 'company.sync.entities.purchases',
  regime_types: 'company.sync.entities.regimeTypes',
  sale_items: 'company.sync.entities.saleItems',
  sale_returns: 'company.sync.entities.saleReturns',
  sales: 'company.sync.entities.sales',
  sequentials: 'company.sync.entities.sequentials',
  sites: 'company.sync.entities.sites',
  units: 'company.sync.entities.units',
  users: 'company.sync.entities.users',
  vat_rates: 'company.sync.entities.vatRates',
};

const SYNC_OPERATION_LABEL_KEYS: Record<string, string> = {
  create: 'company.sync.operations.create',
  delete: 'company.sync.operations.delete',
  update: 'company.sync.operations.update',
};

export function getSyncEntityLabel(t: TFunction, entityType?: string | null) {
  if (!entityType) {
    return t('company.sync.entities.record');
  }

  return t(SYNC_ENTITY_LABEL_KEYS[entityType] ?? 'company.sync.entities.record');
}

export function getSyncOperationLabel(t: TFunction, operation?: string | null) {
  if (!operation) {
    return t('company.sync.operations.change');
  }

  return t(SYNC_OPERATION_LABEL_KEYS[operation] ?? 'company.sync.operations.change');
}

export function getSyncQueueIssueMessage(t: TFunction, lastError?: string | null) {
  if (!lastError) {
    return null;
  }

  const normalizedError = lastError.toLowerCase();

  if (normalizedError.includes('local record is missing')) {
    return t('company.sync.queue.errorLocalMissing');
  }

  if (normalizedError.includes('pending conflict blocks')) {
    return t('company.sync.queue.errorConflictBlocked');
  }

  if (normalizedError.includes('unsupported sync entity type')) {
    return t('company.sync.queue.errorUnsupportedEntity');
  }

  return t('company.sync.queue.errorGeneric');
}
