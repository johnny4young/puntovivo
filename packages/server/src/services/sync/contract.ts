/**
 * ENG-064 — Sync payload contract manifest.
 *
 * Closes ADR-0004's promise of an exhaustive entity-to-policy
 * mapping. Every entity type emitted to `sync_outbox` MUST have an
 * entry here; TypeScript exhaustiveness on `Record<EntityType, ...>`
 * + a runtime test (`sync-contract-manifest.test.ts`) catch new
 * entity types that land without a deliberate policy decision.
 *
 * The manifest is the single source of truth that ENG-068+ peers
 * consume via `sync.getContract()` to negotiate the contract before
 * exchanging payloads. Bumping `SYNC_PAYLOAD_VERSION` invalidates
 * cached snapshots on the consumer side.
 *
 * @module services/sync/contract
 */

/**
 * Conflict resolution policy per ADR-0004:
 *
 * - `manual`: high-risk entities (money, fiscal, cash, inventory,
 *   audit). The operator MUST resolve any divergence; auto-resolve
 *   is forbidden because a wrong choice causes silent data loss
 *   on a sale total or a fiscal CUFE.
 *
 * - `auto_lww`: catalog and preferences. Last-write-wins is safe
 *   because the loser's edit can be re-applied without altering
 *   any committed money/fiscal artifact. ENG-064 v1 ships only the
 *   marker; the actual auto-resolution branch in `sync.push` is
 *   parked for a follow-up.
 */
export type SyncConflictPolicy = 'manual' | 'auto_lww';

/**
 * Current payload version. Bump when a payload's shape changes in
 * a way the consumer cannot infer. Old versions stay readable via
 * a per-version codec lookup at the consumer side (ENG-068+).
 */
export const SYNC_PAYLOAD_VERSION = 1 as const;

/**
 * Closed list of every entity type the server can emit to
 * `sync_outbox`. Entities are grouped by ADR-0004 risk class.
 *
 * **Adding a new entity type**: add the literal string here AND an
 * entry to `SYNC_CONFLICT_POLICY` below. TypeScript will fail the
 * build until both halves agree.
 */
export const SYNC_ENTITY_TYPES = [
  // --- High-risk: ADR-0004 manual list ---
  'sales',
  'sale_items',
  'sale_payments',
  'sale_returns',
  'cash_sessions',
  'cash_movements',
  'fiscal_documents',
  'fiscal_document_items',
  'fiscal_numbering_resolutions',
  'fiscal_certificates',
  'inventory_movements',
  'inventory_balances',
  'initial_inventory',
  'transfer_orders',
  'transfer_order_items',
  'stock_adjustments',
  'audit_logs',
  // Money-bound flows that ADR-0004 names alongside sales.
  'orders',
  'order_items',
  'purchases',
  'purchase_returns',
  'purchase_return_items',

  // --- Auto-LWW: catalog + preferences + geography ---
  'customers',
  'products',
  'categories',
  'category_x_provider',
  'units',
  'providers',
  'vat_rates',
  'identification_types',
  'client_types',
  'commercial_activities',
  'regime_types',
  'person_types',
  'cities',
  'countries',
  'departments',
  'companies',
  'sites',
  'locations',
  'location_x_site',
  'logos',
  'sequentials',
  'users',
  'customer_catalogs',
  'receipt_templates',
  'site_peripherals',
] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

/**
 * Per-entity conflict policy. Exhaustively keyed against
 * `SYNC_ENTITY_TYPES`. Adding an entity here without an entry —
 * or removing an entity from one list without removing its key —
 * fails the build via the `Record<SyncEntityType, ...>` type.
 */
export const SYNC_CONFLICT_POLICY: Record<SyncEntityType, SyncConflictPolicy> = {
  // --- Manual (high-risk) ---
  sales: 'manual',
  sale_items: 'manual',
  sale_payments: 'manual',
  sale_returns: 'manual',
  cash_sessions: 'manual',
  cash_movements: 'manual',
  fiscal_documents: 'manual',
  fiscal_document_items: 'manual',
  fiscal_numbering_resolutions: 'manual',
  fiscal_certificates: 'manual',
  inventory_movements: 'manual',
  inventory_balances: 'manual',
  initial_inventory: 'manual',
  transfer_orders: 'manual',
  transfer_order_items: 'manual',
  stock_adjustments: 'manual',
  audit_logs: 'manual',
  orders: 'manual',
  order_items: 'manual',
  purchases: 'manual',
  purchase_returns: 'manual',
  purchase_return_items: 'manual',

  // --- Auto-LWW (catalog + preferences) ---
  customers: 'auto_lww',
  products: 'auto_lww',
  categories: 'auto_lww',
  category_x_provider: 'auto_lww',
  units: 'auto_lww',
  providers: 'auto_lww',
  vat_rates: 'auto_lww',
  identification_types: 'auto_lww',
  client_types: 'auto_lww',
  commercial_activities: 'auto_lww',
  regime_types: 'auto_lww',
  person_types: 'auto_lww',
  cities: 'auto_lww',
  countries: 'auto_lww',
  departments: 'auto_lww',
  companies: 'auto_lww',
  sites: 'auto_lww',
  locations: 'auto_lww',
  location_x_site: 'auto_lww',
  logos: 'auto_lww',
  sequentials: 'auto_lww',
  users: 'auto_lww',
  customer_catalogs: 'auto_lww',
  receipt_templates: 'auto_lww',
  site_peripherals: 'auto_lww',
};

/**
 * Resolve the conflict policy for an entity type. Throws when the
 * type is unknown so writers cannot silently route an unregistered
 * entity through the queue (build-time exhaustiveness already
 * catches this; the runtime guard is defense-in-depth for code
 * paths that bypass the helper).
 */
export function resolveConflictPolicy(entityType: string): SyncConflictPolicy {
  const policy = (SYNC_CONFLICT_POLICY as Record<string, SyncConflictPolicy | undefined>)[entityType];
  if (!policy) {
    throw new Error(
      `[sync.contract] Unknown entityType '${entityType}'. Add it to SYNC_ENTITY_TYPES + SYNC_CONFLICT_POLICY in services/sync/contract.ts.`,
      {
        cause: {
          manifest: 'sync.contract',
          helper: 'resolveConflictPolicy',
          unknownEntityType: entityType,
        },
      }
    );
  }
  return policy;
}

/**
 * Default sync priority by entity type. Higher = drains first.
 *
 * - `audit_logs` (10): legal / compliance — must reach the central
 *   server quickly when present.
 * - Money-bound (`sales`, `cash_*`, `fiscal_*`, `inventory_*`) (5):
 *   business-critical; ahead of catalog churn but behind audit.
 * - Everything else (0): catalog / preferences default.
 *
 * The default can be overridden per call via `enqueueSync({...,
 * priority: <number>})`. Floating-point values let operators slot
 * urgent rows between defaults without renumbering.
 */
export function resolveDefaultPriority(entityType: string): number {
  if (entityType === 'audit_logs') return 10;
  const policy = (SYNC_CONFLICT_POLICY as Record<string, SyncConflictPolicy | undefined>)[entityType];
  if (policy === 'manual') return 5;
  return 0;
}

/**
 * Public manifest shape for `sync.getContract()`.
 */
export interface SyncContractManifest {
  payloadVersion: number;
  entities: Array<{
    entityType: SyncEntityType;
    conflictPolicy: SyncConflictPolicy;
    defaultPriority: number;
  }>;
}

export function buildSyncContractManifest(): SyncContractManifest {
  return {
    payloadVersion: SYNC_PAYLOAD_VERSION,
    entities: SYNC_ENTITY_TYPES.map(entityType => ({
      entityType,
      conflictPolicy: SYNC_CONFLICT_POLICY[entityType],
      defaultPriority: resolveDefaultPriority(entityType),
    })),
  };
}
