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

/**
 * Normalize the `lastError` field which can be:
 * - a plain string (legacy IndexedDB offline buffer shape, retained
 *   for backward-compat),
 * - a `NormalizedOutboxError` JSON object `{ kind, message? }` from
 *   the server `sync_outbox` rows (post ENG-064b cutover),
 * - or null/undefined when no error has been recorded.
 *
 * `message` is preferred when present; otherwise we fall back to
 * `kind` so the operator at least sees the machine-readable error
 * tag (e.g. `NETWORK_TIMEOUT`) instead of a blank row.
 */
export function normalizeSyncLastError(
  lastError?: string | Record<string, unknown> | null
): string | null {
  if (!lastError) {
    return null;
  }
  if (typeof lastError === 'string') {
    return lastError;
  }
  const message = lastError.message;
  if (typeof message === 'string') {
    return message;
  }
  const kind = lastError.kind;
  return typeof kind === 'string' ? kind : null;
}

export function getSyncQueueIssueMessage(
  t: TFunction,
  lastError?: string | Record<string, unknown> | null
) {
  const normalizedMessage = normalizeSyncLastError(lastError);
  if (!normalizedMessage) {
    return null;
  }

  const lowered = normalizedMessage.toLowerCase();

  if (lowered.includes('local record is missing')) {
    return t('company.sync.queue.errorLocalMissing');
  }

  if (lowered.includes('pending conflict blocks')) {
    return t('company.sync.queue.errorConflictBlocked');
  }

  if (lowered.includes('unsupported sync entity type')) {
    return t('company.sync.queue.errorUnsupportedEntity');
  }

  return t('company.sync.queue.errorGeneric');
}
