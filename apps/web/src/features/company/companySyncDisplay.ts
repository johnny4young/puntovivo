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

/** A single field whose serialized value differs between local and remote. */
export interface ConflictDiffField {
  key: string;
  localValue: string;
  remoteValue: string;
}

type ConflictDiffData = Record<string, unknown> | null | undefined;

/**
 * Keys skipped from the inline conflict diff — internal plumbing that always
 * differs between replicas and means nothing to the operator. Shared by both
 * §09 sync surfaces (write-side `CompanySyncPreviewSections`, read-side
 * `operations/SyncHealthPanel`) so they ignore exactly the same fields.
 */
export const DIFF_IGNORED_KEYS = new Set([
  'id',
  'tenantId',
  'version',
  'createdAt',
  'updatedAt',
  'syncedAt',
]);

/**
 * Default value serializer for the inline diff (write-side
 * `CompanySyncPreviewSections` semantics): empty strings collapse to the
 * em-dash placeholder and a non-serializable value falls back to the same
 * placeholder rather than throwing.
 */
export function formatConflictDiffValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.length === 0 ? '—' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

/**
 * Compute the inline diff between the local and remote payloads of a sync
 * conflict. Only fields whose serialized value differs are kept, so the
 * operator sees exactly what changed (price, stock, ...) without opening the
 * technical-details JSON.
 *
 * The value serializer is injectable so each surface keeps its exact current
 * rendering: the write-side preview uses the default `formatConflictDiffValue`
 * (empty string → em-dash, try/catch guard); the read-only Sync Health panel
 * passes its own formatter. The diff-walking loop and the ignored-key set are
 * the shared, bug-prone parts that this util centralizes.
 */
export function computeConflictDiff(
  localData: ConflictDiffData,
  remoteData: ConflictDiffData,
  formatValue: (value: unknown) => string = formatConflictDiffValue
): ConflictDiffField[] {
  const local = localData ?? {};
  const remote = remoteData ?? {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const fields: ConflictDiffField[] = [];

  for (const key of keys) {
    if (DIFF_IGNORED_KEYS.has(key)) {
      continue;
    }
    const localValue = formatValue(local[key]);
    const remoteValue = formatValue(remote[key]);
    if (localValue !== remoteValue) {
      fields.push({ key, localValue, remoteValue });
    }
  }

  return fields;
}
