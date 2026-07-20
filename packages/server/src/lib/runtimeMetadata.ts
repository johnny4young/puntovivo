/**
 * Runtime metadata helpers for the `/api/health` surface.
 *
 * Two pure-ish helpers + one read-only DB query that the health
 * endpoint needs to render an Authority Node status snapshot for
 * Operations Center consumers (and operator curl checks):
 *
 * - `fingerprintDbPath(path)` — SHA-256 of the dbPath string
 * truncated to 12 hex chars. Identifies a hub box across boots
 * without leaking the operator's filesystem layout.
 * - `getCurrentSchemaVersion(db)` — reads the applied migration
 * count from `__drizzle_migrations`. Lets a support ticket
 * compare the deployed schema against the journal in the repo.
 * - `countActiveDevices(db)` — system-wide aggregate of
 * `devices.is_active = 1`. Tenant-scoped per-row breakdown is
 * 's Operations Center Authority tab.
 *
 * @module lib/runtimeMetadata
 */

import { createHash } from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import { devices } from '../db/schema.js';

const FINGERPRINT_HEX_LENGTH = 12;

/**
 * Stable 12-char SHA-256 fingerprint of the dbPath. Reproducible
 * across boots for the same input; never reversible to the raw
 * path. Used by `/api/health` so operators can confirm two
 * processes share the same DB without exposing
 * `/Users/jane/Library/Application Support/...` to a support
 * ticket.
 *
 * Special cases:
 * - `':memory:'` returns the literal string `'memory'` so the
 * test fixture is identifiable at a glance.
 */
export function fingerprintDbPath(dbPath: string): string {
  if (dbPath === ':memory:') return 'memory';
  return createHash('sha256').update(dbPath).digest('hex').slice(0, FINGERPRINT_HEX_LENGTH);
}

/**
 * Number of applied migrations recorded in `__drizzle_migrations`.
 * Returns `null` when the table does not exist yet (very early-boot
 * edge case before `initDatabase` has run); production callers always
 * invoke this AFTER the server has booted.
 *
 * Uses `COUNT(*)` rather than `MAX(id)` because drizzle-orm's SQLite
 * migration runner inserts rows without an explicit autoincrement
 * id, so `id` is `null` on every row. The count reproduces the
 * journal-entry count in [`packages/server/src/db/migrations/meta/_journal.json`](../db/migrations/meta/_journal.json),
 * which is what an operator wants to compare against the deployed
 * binary's expected schema state.
 */
export function getCurrentSchemaVersion(db: DatabaseInstance): number | null {
  try {
    const row = db
      .select({ value: sql<number>`COUNT(*)` })
      .from(sql`__drizzle_migrations`)
      .get() as { value: number } | undefined;
    return typeof row?.value === 'number' ? row.value : null;
  } catch {
    return null;
  }
}

/**
 * System-wide count of active devices across tenants. The hub
 * typically serves one tenant; multi-tenant hubs sum across
 * tenants.  will surface a per-tenant breakdown through a
 * tRPC procedure inside the Operations Center Authority tab.
 */
export function countActiveDevices(db: DatabaseInstance): number {
  const row = db.select({ value: count() }).from(devices).where(eq(devices.isActive, true)).get();
  return Number(row?.value ?? 0);
}
