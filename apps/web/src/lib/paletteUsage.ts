/**
 * local usage tracking for the CommandPalette.
 *
 * Records how often (and how recently) each palette action is
 * performed so the palette can surface a "Recent" section with the
 * operator's real workflow on top. The data is DEVICE-LOCAL by
 * design: it lives in localStorage under a tenant-scoped key
 * (mirroring features/tenant/siteStorage.ts) and never travels to
 * the server — a cashier's ranking is about THEIR muscle memory,
 * not fleet aggregation, so there is no consent surface involved.
 *
 * Every reader/writer is defensive: SSR-safe (`typeof window`
 * guards), tolerant of corrupt JSON (falls back to an empty map),
 * and tolerant of a full/blocked storage (writes are best-effort).
 * A palette that cannot remember usage must degrade to the plain
 * catalogue order, never crash.
 *
 * @module lib/paletteUsage
 */

/**
 * Usage record for one palette action on this device+tenant.
 * `count` is the lifetime number of activations; `lastUsedAt` is a
 * Unix epoch in ms used as the tiebreaker between equal counts and
 * as the eviction key when the map outgrows {@link MAX_TRACKED}.
 */
export interface PaletteActionUsage {
  count: number;
  lastUsedAt: number;
}

/**
 * Map of action id (`navigate.dashboard`, `command.logout`, ...) to
 * its usage record. Ids not present were never used on this device.
 */
export type PaletteUsageMap = Record<string, PaletteActionUsage>;

const STORAGE_PREFIX = 'palette_usage:';

/** How many actions the "Recent" section surfaces at most. */
export const MAX_RECENT_ACTIONS = 5;

/**
 * Defensive cap on stored entries. The catalogue holds ~24 stable
 * ids, so this should never trigger; it exists so retired action
 * ids accumulated across app versions cannot grow the blob without
 * bound. Eviction drops the least-recently-used entry.
 */
const MAX_TRACKED = 64;

function storageKey(tenantId: string): string {
  return `${STORAGE_PREFIX}${tenantId}`;
}

function isUsageRecord(value: unknown): value is PaletteActionUsage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PaletteActionUsage).count === 'number' &&
    Number.isFinite((value as PaletteActionUsage).count) &&
    typeof (value as PaletteActionUsage).lastUsedAt === 'number' &&
    Number.isFinite((value as PaletteActionUsage).lastUsedAt)
  );
}

/**
 * Read the usage map for a tenant. Returns an empty map when the
 * tenant is unknown, the environment has no window/localStorage,
 * the blob is missing, or the JSON is corrupt — every failure mode
 * degrades to "no usage yet". Entries with an invalid shape are
 * dropped individually so one bad record cannot poison the rest.
 */
export function loadPaletteUsage(tenantId: string | null | undefined): PaletteUsageMap {
  if (!tenantId || typeof window === 'undefined') {
    return {};
  }
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey(tenantId));
  } catch {
    return {};
  }
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const usage: PaletteUsageMap = {};
    for (const [actionId, record] of Object.entries(parsed)) {
      if (isUsageRecord(record)) {
        usage[actionId] = { count: record.count, lastUsedAt: record.lastUsedAt };
      }
    }
    return usage;
  } catch {
    return {};
  }
}

/**
 * Record one activation of `actionId` for the tenant. Best-effort:
 * silently a no-op when the tenant is unknown, the environment has
 * no storage, or the write throws (full quota, private mode). When
 * the map exceeds {@link MAX_TRACKED} entries, the least-recently
 * used one is evicted before writing.
 */
export function recordPaletteActionUsage(
  actionId: string,
  tenantId: string | null | undefined
): void {
  if (!tenantId || typeof window === 'undefined') {
    return;
  }
  const usage = loadPaletteUsage(tenantId);
  const previous = usage[actionId];
  usage[actionId] = {
    count: (previous?.count ?? 0) + 1,
    lastUsedAt: Date.now(),
  };
  const entries = Object.entries(usage);
  if (entries.length > MAX_TRACKED) {
    entries.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    const evictCount = entries.length - MAX_TRACKED;
    for (const [staleId] of entries.slice(0, evictCount)) {
      delete usage[staleId];
    }
  }
  try {
    window.localStorage.setItem(storageKey(tenantId), JSON.stringify(usage));
  } catch {
    /* best-effort: a full or blocked storage never breaks the palette */
  }
}

/**
 * Rank the actions the "Recent" section should surface: the used
 * subset of `actions`, ordered by count desc, then lastUsedAt desc,
 * capped at `max`. Ids present in the usage map but absent from
 * `actions` (retired from the catalogue, or gated away from this
 * role/module set) are pruned implicitly — ranking runs AFTER the
 * role/module visibility filter by contract.
 */
export function rankRecentActions<T extends { id: string }>(
  actions: readonly T[],
  usage: PaletteUsageMap,
  max: number = MAX_RECENT_ACTIONS
): T[] {
  const used = actions.filter(action => usage[action.id] !== undefined);
  used.sort((a, b) => {
    const ua = usage[a.id]!;
    const ub = usage[b.id]!;
    if (ub.count !== ua.count) return ub.count - ua.count;
    return ub.lastUsedAt - ua.lastUsedAt;
  });
  return used.slice(0, Math.max(0, max));
}

/** Test-only: remove a tenant's stored usage between cases. */
export function __clearPaletteUsageForTests(tenantId: string | null | undefined): void {
  if (!tenantId || typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey(tenantId));
  } catch {
    /* ignore */
  }
}
