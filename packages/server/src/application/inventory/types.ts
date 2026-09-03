/**
 * Public types for inventory stock mutation use-cases.
 *
 * The context is deliberately structural: tRPC resolvers and direct tests can
 * provide only the authenticated tenant, site and command-envelope data that
 * inventory orchestration consumes.
 *
 * @module application/inventory/types
 */
import type { DatabaseInstance } from '../../db/index.js';
import type { PuntovivoLogger } from '../../logging/logger.js';

export type InventoryLogger = Pick<PuntovivoLogger, 'warn'>;

export interface InventoryContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  user: { id: string; role: string };
  envelope?: { operationId: string; idempotencyKey?: string } | null;
  deviceId?: string | null;
  log?: InventoryLogger;
}

export interface CriticalInventoryContext extends InventoryContext {
  envelope: { operationId: string; idempotencyKey?: string };
}

/** Critical command whose domain result is finalized inside its write transaction. */
export interface TransactionalInventoryContext extends CriticalInventoryContext {
  /** Server-owned operation clock; direct unit tests may omit and use UTC fallback. */
  nowIso?: string;
  businessDate?: string;
  businessTimezone?: string;
  countryCode?: string;
  localeVersion?: number;
  completeInTransaction: (db: DatabaseInstance, resultRef: unknown) => void;
}

/** Inventory command that evaluates date-only lot or pharmacy policy. */
export interface ClockedTransactionalInventoryContext extends TransactionalInventoryContext {
  businessDate: string;
  businessTimezone: string;
  countryCode: string;
  localeVersion: number;
}
