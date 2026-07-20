/**
 * Module activation manifest.
 *
 * Single source of truth for every gateable module the kernel knows
 * about. Every module:
 *
 * - Has a stable, human-readable `id` (kebab-case) used as the JSON
 * key in `tenants.settings.modules` AND as the i18n suffix.
 * - Has a `defaultEnabled` boolean — the state new tenants and
 * tenants without an explicit toggle resolve to.
 * - Has an i18n key (`modules.<i18nKey>.label` /
 * `modules.<i18nKey>.description`) so the admin toggle UI shows
 * a translated label per locale.
 *
 * The manifest is intentionally `as const` + `Record<ModuleId, ...>`
 * so a forgotten arm fails at compile time. Adding a module = (a)
 * append the id to `MODULE_IDS`, (b) add the descriptor to
 * `MODULES_MANIFEST`, (c) wire the gate in the call site (see
 * `trpc/middleware/modules.ts::createModuleGuard`), (d) add the i18n
 * strings under `apps/web/src/i18n/locales/{en,es}/modules.json`.
 *
 * Mirrors the  sync contract pattern in
 * `services/sync/contract.ts`. Keep this file PURE — no DB calls, no
 * tRPC types — so the renderer can import the same constants for the
 * client-side gate.
 *
 * @module services/modules/manifest
 */

/**
 * Schema version of the `tenants.settings.modules` JSON shape.
 * Currently `1`: a flat `Record<ModuleId, boolean>`. Bumping this
 * implies migrating every tenant's settings; document the migration
 * protocol in ADR-0007 if it ever happens.
 */
export const MODULES_SCHEMA_VERSION = 1 as const;

/**
 * The closed list of module ids the kernel knows about. Order is
 * presentation-only (the admin tab renders in this order). Adding a
 * module here without a `MODULES_MANIFEST` entry is a TS compile
 * error.
 */
export const MODULE_IDS = [
  'copilot',
  'operations-center',
  'quotations',
  'anomaly-detection',
  'semantic-search',
  // surface modules. Each new surface (POS Touch, KDS,
  // Customer Display, Mobile Waiter) gates behind a dedicated module
  // id from the same kernel. POS Desktop is the implicit default and
  // does not have a module — the existing /sales etc. routes ship as
  // they do today. All four ship with defaultEnabled=false so existing
  // tenants do not see new sidebar entries appear after the kernel
  // ships; operators flip them on per tenant via /company?tab=modules.
  'pos-touch',
  'kds',
  'customer-display',
  'mobile-waiter',
  // Public events foundation. When the module is ON, every
  // succeeded critical command projects through `services/events`
  // and lands in `webhook_outbox`.  adds the HTTP delivery
  // worker that drains the outbox to subscriber URLs. Default OFF so
  // existing tenants do not start emitting webhooks on the kernel
  // ship — operators opt-in per tenant via /company?tab=modules.
  'events-api',
  // Domicilios touch V5. The server-side scaffold
  // (deliveryOrders router + delivery_orders table) shipped in 0c75ca1
  // independent of the module gate. This entry adds the runtime gate
  // for the `/delivery` UI surface. Default OFF so non-delivery
  // tenants do not see the sidebar entry appear after the kernel
  // ships; operators flip it on per tenant via /company?tab=modules.
  'delivery',
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

/**
 * Product classification () that drives the Ring-1 retail scope gate.
 *
 * - `core`         — required for Ring-1 retail sellability; ON for a fresh
 * retail tenant by default.
 * - `compliance`   — fiscal / legal obligation. Reserved: fiscal documents and
 * audit logs are NOT module-gated today, so no module carries this class
 * yet; kept so a future DIAN/INVIMA module has a home.
 * - `optional`     — useful but not part of the Ring-1 core; OFF for a fresh
 * retail tenant, opt-in per tenant via `/company?tab=modules`.
 * - `experimental` — beta / unproven. Reserved for future AI Wave 2 and
 * payment-terminal adapters; no module carries this class yet.
 */
export type ModuleClassification = 'core' | 'compliance' | 'optional' | 'experimental';

/**
 * Per-module metadata consumed by the admin UI + the kernel. Stays
 * deliberately minimal — anything site-specific (e.g. "this module
 * affects sites X and Y") belongs in the call site, not here.
 */
export interface ModuleDescriptor {
  id: ModuleId;
  /**
   * The state the kernel resolves to when:
   * - the tenant has never been touched (no `settings.modules`);
   * - or `settings.modules[id]` is missing / not a boolean.
   *
   * Default `true` for every demo module so existing tenants see no
   * behavior change after the kernel ships. Future modules MAY ship
   * with `defaultEnabled: false` (paid-tier features, beta gates).
   */
  defaultEnabled: boolean;
  /**
   * Lowest role allowed to SEE the toggle in the admin UI. The
   * runtime gate (`createModuleGuard`) is independent: it always
   * runs the boolean check regardless of who toggled it.
   */
  adminVisibilityRole: 'admin' | 'manager' | 'cashier';
  /**
   * Suffix under the `modules.*` i18n namespace. The admin UI reads
   * `modules.<i18nKey>.label` and `modules.<i18nKey>.description`.
   * Locale-parity test (`apps/web/src/i18n/locale-parity.test.ts`)
   * gates that both en + es ship the keys.
   */
  i18nKey: string;
  /**
   * Product classification (). Drives `RING1_RETAIL_PROFILE`: only
   * `core` modules are ON for a fresh retail tenant. Independent of
   * `defaultEnabled` (the resolution fallback for unconfigured tenants) so
   * changing the retail profile never silently flips an existing tenant.
   */
  classification: ModuleClassification;
  /**
   * Market ring this module serves ():
   * `1` = generic retail MVP (Ring-1), `2` = restaurant + pharmacy,
   * `3` = service verticals. A fresh retail tenant only enables Ring-1
   * `core` modules; Ring-2/3 surfaces are pulled forward when a pilot makes
   * that vertical the wedge.
   */
  ring: 1 | 2 | 3;
}

/**
 * Exhaustive descriptor map. TypeScript's `Record<ModuleId, ...>`
 * shape forces every entry of `MODULE_IDS` to land here — a compile
 * error catches a forgotten one before runtime.
 */
export const MODULES_MANIFEST: Record<ModuleId, ModuleDescriptor> = {
  copilot: {
    id: 'copilot',
    defaultEnabled: true,
    adminVisibilityRole: 'admin',
    i18nKey: 'copilot',
    classification: 'optional',
    ring: 1,
  },
  'operations-center': {
    id: 'operations-center',
    defaultEnabled: true,
    adminVisibilityRole: 'admin',
    i18nKey: 'operationsCenter',
    classification: 'core',
    ring: 1,
  },
  quotations: {
    id: 'quotations',
    defaultEnabled: true,
    adminVisibilityRole: 'admin',
    i18nKey: 'quotations',
    classification: 'core',
    ring: 1,
  },
  'anomaly-detection': {
    id: 'anomaly-detection',
    defaultEnabled: true,
    adminVisibilityRole: 'admin',
    i18nKey: 'anomalyDetection',
    classification: 'optional',
    ring: 1,
  },
  'semantic-search': {
    id: 'semantic-search',
    defaultEnabled: true,
    adminVisibilityRole: 'admin',
    i18nKey: 'semanticSearch',
    classification: 'optional',
    ring: 1,
  },
  // surface modules default OFF so existing tenants do not
  // see new sidebar entries appear after the kernel ships. The
  // surfaces themselves render placeholders until  (vertical
  // restaurant) plugs the real workflows.
  'pos-touch': {
    id: 'pos-touch',
    defaultEnabled: false,
    adminVisibilityRole: 'admin',
    i18nKey: 'posTouch',
    classification: 'optional',
    ring: 2,
  },
  kds: {
    id: 'kds',
    defaultEnabled: false,
    adminVisibilityRole: 'admin',
    i18nKey: 'kds',
    classification: 'optional',
    ring: 2,
  },
  'customer-display': {
    id: 'customer-display',
    defaultEnabled: false,
    adminVisibilityRole: 'admin',
    i18nKey: 'customerDisplay',
    classification: 'optional',
    ring: 2,
  },
  'mobile-waiter': {
    id: 'mobile-waiter',
    defaultEnabled: false,
    adminVisibilityRole: 'admin',
    i18nKey: 'mobileWaiter',
    classification: 'optional',
    ring: 2,
  },
  // Public events module. Default OFF so existing tenants
  // do not start emitting webhooks on ship; operators opt-in per
  // tenant via /company?tab=modules.  lands the HTTP delivery
  // worker; v1 ships only the kernel (contract + projector + outbox).
  'events-api': {
    id: 'events-api',
    defaultEnabled: false,
    adminVisibilityRole: 'admin',
    i18nKey: 'eventsApi',
    classification: 'optional',
    ring: 1,
  },
  // Domicilios touch V5. Gates the `/delivery` UI route.
  // The server `deliveryOrders.*` router enforces role + site scopes
  // independent of this flag; the manifest entry hides the renderer
  // surface (sidebar entry + route) so non-delivery tenants do not
  // see it after the kernel ships.
  delivery: {
    id: 'delivery',
    defaultEnabled: false,
    adminVisibilityRole: 'admin',
    i18nKey: 'delivery',
    classification: 'optional',
    ring: 2,
  },
};

/**
 * the explicit module profile written into `settings.modules`
 * for a fresh RETAIL tenant at creation time (see `db/seed.ts`). Derived
 * from the manifest so it can never drift: a module is ON only when its
 * `classification` is `core`, so a fresh retail tenant sees only the
 * Ring-1 sellability surfaces (operations + quotations) plus the always-on
 * non-gated core (sales, inventory, catalog, customers, setup). Restaurant
 * / KDS / customer-display / mobile-waiter / delivery / public-API / AI
 * modules stay OFF until an admin enables them per tenant via
 * `/company?tab=modules`.
 *
 * Written EXPLICITLY (every id present) rather than relying on
 * `defaultEnabled`, so it never depends on — and never silently flips —
 * the resolution fallback that preserves existing tenants.
 */
export const RING1_RETAIL_PROFILE: Record<ModuleId, boolean> = Object.fromEntries(
  MODULE_IDS.map(id => [id, MODULES_MANIFEST[id].classification === 'core'])
) as Record<ModuleId, boolean>;

const MODULE_ID_SET: ReadonlySet<string> = new Set(MODULE_IDS);

/**
 * Type guard for runtime ingress — used by Zod refines on
 * `modules.setActive` input to reject unknown ids.
 */
export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && MODULE_ID_SET.has(value);
}

/**
 * Resolve the effective module state for a tenant from a raw JSON
 * blob (typically `tenants.settings.modules`). Defensive in three
 * directions:
 *
 * - Missing / null / non-object input → defaults (every module
 * resolves to its `defaultEnabled`).
 * - Unknown keys (stale toggles for modules that have been
 * removed from `MODULE_IDS`) → silently dropped.
 * - Non-boolean values → ignored, fall back to default.
 *
 * Returns a complete `Record<ModuleId, boolean>` keyed on every
 * known module so callers don't have to special-case missing keys.
 */
export function resolveModulesState(raw: unknown): Record<ModuleId, boolean> {
  const out = {} as Record<ModuleId, boolean>;
  const blob =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  for (const id of MODULE_IDS) {
    const stored = blob?.[id];
    out[id] = typeof stored === 'boolean' ? stored : MODULES_MANIFEST[id].defaultEnabled;
  }
  return out;
}

/**
 * Convenience: return only the descriptor list visible to a given
 * actor role. Used by `modules.list` to scope the admin-tab UI.
 */
export function visibleDescriptors(
  actorRole: 'admin' | 'manager' | 'cashier' | 'viewer'
): ModuleDescriptor[] {
  return MODULE_IDS.map(id => MODULES_MANIFEST[id]).filter(descriptor => {
    if (descriptor.adminVisibilityRole === 'admin') return actorRole === 'admin';
    if (descriptor.adminVisibilityRole === 'manager') {
      return actorRole === 'admin' || actorRole === 'manager';
    }
    // cashier-visible modules: anyone who isn't a viewer
    return actorRole !== 'viewer';
  });
}

/**
 * Build the raw JSON blob from a partial state map. Used by tests +
 * the dev seed to write a complete manifest snapshot.
 */
export function buildModulesBlob(
  partial: Partial<Record<ModuleId, boolean>>
): Record<ModuleId, boolean> {
  const out = {} as Record<ModuleId, boolean>;
  for (const id of MODULE_IDS) {
    out[id] = partial[id] ?? MODULES_MANIFEST[id].defaultEnabled;
  }
  return out;
}

/**
 * Resolve the active state of a single module from a tenant's full
 * settings blob (the JSON column). Convenience for hot paths
 * (operation-journal hook, fiscal worker) that don't need the
 * complete state map. Falls back to the manifest default when the
 * blob doesn't carry an explicit boolean for the id.
 */
export function isModuleActiveInSettings(tenantSettings: unknown, moduleId: ModuleId): boolean {
  if (
    tenantSettings === null ||
    typeof tenantSettings !== 'object' ||
    Array.isArray(tenantSettings)
  ) {
    return MODULES_MANIFEST[moduleId].defaultEnabled;
  }
  const blob = tenantSettings as Record<string, unknown>;
  const modules = blob.modules;
  if (modules === null || typeof modules !== 'object' || Array.isArray(modules)) {
    return MODULES_MANIFEST[moduleId].defaultEnabled;
  }
  const stored = (modules as Record<string, unknown>)[moduleId];
  return typeof stored === 'boolean' ? stored : MODULES_MANIFEST[moduleId].defaultEnabled;
}
