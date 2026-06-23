import { and, asc, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { sites } from '../../db/schema.js';

export function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Resolves the tenant's primary site — the earliest-created active site.
 *
 * Used as the migration anchor for balance seeding and as the fallback site
 * for admin-level mutations that don't carry an explicit site context.
 * Returns `null` when the tenant has no active sites (legacy path).
 */
export function getPrimarySiteId(tx: DatabaseInstance, tenantId: string): string | null {
  const primarySite = tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .orderBy(asc(sites.createdAt), asc(sites.id))
    .limit(1)
    .get();

  return primarySite?.id ?? null;
}
