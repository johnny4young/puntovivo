import { adminProcedureWithModule } from '../../../middleware/modules.js';
import type { DiagnosticIncludeOutbox } from '../../../schemas/reports.js';
import type { RuntimeConfig } from '../../../../config/runtime.js';

/**
 * Hard cap per table at export time. Empirically a 7-day window for a
 * busy tenant lands ~1-2k rows per source; 30 days lands ~5-15k. The
 * 10k ceiling keeps the bundle below ~10MB serialised and surfaces a
 * narrowing hint to the operator instead of silently truncating. If a
 * tenant operationally needs more, this turns into a config knob in a
 * follow-up — not in scope for v1.
 */
export const ROW_LIMIT = 10_000;

/**
 * Best-effort estimate for `operation_events` + `operation_effects`
 * row sizes in bytes. Both tables carry a small JSON `summary` /
 * `effect_data` blob; 200 bytes is the median observed during dev.
 */
export const EVENT_AVG_SIZE_BYTES = 200;

export const SCHEMA_VERSION = 1;

// ENG-068 — `reports.diagnostics.*` exists only inside the Operations
// Center, so it is module-gated. Cash / inventory / fiscal sub-routers
// feed dedicated non-Operations Center surfaces too, so gating them
// would break the Cash, Inventory, and Fiscal Documents pages.
export const gatedAdmin = adminProcedureWithModule('operations-center');

/**
 * Names locked by ADR-0003. Returned in `manifest.counts` with `0`
 * for the gated outboxes so consumers can target a stable keyset.
 */
export const ALL_OUTBOX_NAMES = [
  'sync_outbox',
  'fiscal_outbox',
  'hardware_outbox',
  'payment_outbox',
  'webhook_outbox',
] as const;

type DiagnosticOutboxName = (typeof ALL_OUTBOX_NAMES)[number];

const INCLUDE_TO_TABLE: Record<DiagnosticIncludeOutbox, DiagnosticOutboxName> = {
  sync: 'sync_outbox',
  fiscal: 'fiscal_outbox',
  hardware: 'hardware_outbox',
};

export function isDefaultIncludeAll(
  include: readonly DiagnosticIncludeOutbox[] | undefined
): boolean {
  return include === undefined;
}

/**
 * ENG-072 — runtime metadata projection for the diagnostics manifest.
 * Mirrors the AUTHORITY-NODE.md `RuntimeConfig` shape but stays
 * additive (existing manifest fields untouched, schemaVersion still
 * 1) so the export bundle stays consumable by today's tooling. The
 * runtime config carries no secrets — `hubUrl` and `siteId` /
 * `deviceId` are operator-supplied identifiers, not credentials —
 * so the sanitizer needs no extension.
 */
export function projectRuntimeForManifest(runtime: RuntimeConfig): {
  authorityMode: RuntimeConfig['authorityMode'];
  bindHost: string;
  bindPort: number;
  hubUrl: string | null;
  siteId: string | null;
  deviceId: string | null;
  allowedLanOrigins: string[];
} {
  return {
    authorityMode: runtime.authorityMode,
    bindHost: runtime.bindHost,
    bindPort: runtime.bindPort,
    hubUrl: runtime.hubUrl,
    siteId: runtime.siteId,
    deviceId: runtime.deviceId,
    // Included so an admin debugging a CORS / LAN-bind issue in
    // ENG-073 `site_hub` mode sees the configured origin set in the
    // bundle. Empty array in the default `device_local` case is
    // informative ("no LAN origins configured"), not a leak.
    allowedLanOrigins: runtime.allowedLanOrigins,
  };
}

// Re-exported for tests so the assertion threshold tracks the source.
export const __TEST_ROW_LIMIT = ROW_LIMIT;
// Touch INCLUDE_TO_TABLE so it isn't tree-shaken into a lint warning.
void INCLUDE_TO_TABLE;
