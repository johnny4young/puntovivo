/**
 * ENG-068 — Module activation manifest.
 *
 * Single source of truth for every gateable module the kernel knows
 * about. Every module:
 *
 *   - Has a stable, human-readable `id` (kebab-case) used as the JSON
 *     key in `tenants.settings.modules` AND as the i18n suffix.
 *   - Has a `defaultEnabled` boolean — the state new tenants and
 *     tenants without an explicit toggle resolve to.
 *   - Has an i18n key (`modules.<i18nKey>.label` /
 *     `modules.<i18nKey>.description`) so the admin toggle UI shows
 *     a translated label per locale.
 *
 * The manifest is intentionally `as const` + `Record<ModuleId, ...>`
 * so a forgotten arm fails at compile time. Adding a module = (a)
 * append the id to `MODULE_IDS`, (b) add the descriptor to
 * `MODULES_MANIFEST`, (c) wire the gate in the call site (see
 * `trpc/middleware/modules.ts::createModuleGuard`), (d) add the i18n
 * strings under `apps/web/src/i18n/locales/{en,es}/modules.json`.
 *
 * Mirrors the ENG-064 sync contract pattern in
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
  // ENG-069 — surface modules. Each new surface (POS Touch, KDS,
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
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

/**
 * Per-module metadata consumed by the admin UI + the kernel. Stays
 * deliberately minimal — anything site-specific (e.g. "this module
 * affects sites X and Y") belongs in the call site, not here.
 */
export interface ModuleDescriptor {
  id: ModuleId;
  /**
   * The state the kernel resolves to when:
   *   - the tenant has never been touched (no `settings.modules`);
   *   - or `settings.modules[id]` is missing / not a boolean.
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
}

/**
 * Exhaustive descriptor map. TypeScript's `Record<ModuleId, ...>`
 * shape forces every entry of `MODULE_IDS` to land here — a compile
 * error catches a forgotten one before runtime.
 */
export const MODULES_MANIFEST: Record<ModuleId, ModuleDescriptor> = {
  'copilot': {
    id: 'copilot',
    defaultEnabled: true,
    adminVisibilityRole: 'admin',
    i18nKey: 'copilot',
  },
  'operations-center': {
    id: 'operations-center',
    defaultEnabled: true,
    adminVisibilityRole: 'admin',
    i18nKey: 'operationsCenter',
  },
  'quotations': {
    id: 'quotations',
    defaultEnabled: true,
    adminVisibilityRole: 'admin',
    i18nKey: 'quotations',
  },
  'anomaly-detection': {
    id: 'anomaly-detection',
    defaultEnabled: true,
    adminVisibilityRole: 'admin',
    i18nKey: 'anomalyDetection',
  },
  'semantic-search': {
    id: 'semantic-search',
    defaultEnabled: true,
    adminVisibilityRole: 'admin',
    i18nKey: 'semanticSearch',
  },
  // ENG-069 — surface modules default OFF so existing tenants do not
  // see new sidebar entries appear after the kernel ships. The
  // surfaces themselves render placeholders until ENG-039 (vertical
  // restaurant Mexico) plugs the real workflows.
  'pos-touch': {
    id: 'pos-touch',
    defaultEnabled: false,
    adminVisibilityRole: 'admin',
    i18nKey: 'posTouch',
  },
  'kds': {
    id: 'kds',
    defaultEnabled: false,
    adminVisibilityRole: 'admin',
    i18nKey: 'kds',
  },
  'customer-display': {
    id: 'customer-display',
    defaultEnabled: false,
    adminVisibilityRole: 'admin',
    i18nKey: 'customerDisplay',
  },
  'mobile-waiter': {
    id: 'mobile-waiter',
    defaultEnabled: false,
    adminVisibilityRole: 'admin',
    i18nKey: 'mobileWaiter',
  },
};

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
 *   - Missing / null / non-object input → defaults (every module
 *     resolves to its `defaultEnabled`).
 *   - Unknown keys (stale toggles for modules that have been
 *     removed from `MODULE_IDS`) → silently dropped.
 *   - Non-boolean values → ignored, fall back to default.
 *
 * Returns a complete `Record<ModuleId, boolean>` keyed on every
 * known module so callers don't have to special-case missing keys.
 */
export function resolveModulesState(raw: unknown): Record<ModuleId, boolean> {
  const out = {} as Record<ModuleId, boolean>;
  const blob =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
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
