import type { DatabaseInstance } from '../../db/index.js';

/** Critical-command context shared by every regulated pharmacy mutation. */
export interface CriticalPharmacyContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  user: { id: string; role: string };
  envelope: { operationId: string; idempotencyKey: string };
  deviceId: string;
  completeInTransaction: (db: DatabaseInstance, resultRef: unknown) => void;
}

export function pharmacySyncContext(ctx: CriticalPharmacyContext, db: DatabaseInstance) {
  return {
    db,
    tenantId: ctx.tenantId,
    envelope: ctx.envelope,
    deviceId: ctx.deviceId,
  };
}

/**
 * Keep server-backed pharmacy registers on a real page after a filter or
 * mutation shrinks the result set. The returned page remains one-based, and
 * an empty register is represented by page 1 so clients never need an effect
 * that mutates pagination state after render.
 */
export function clampPharmacyPage(total: number, perPage: number, requestedPage: number): number {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  return Math.min(Math.max(1, requestedPage), pageCount);
}
