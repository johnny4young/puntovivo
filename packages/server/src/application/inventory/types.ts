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
  /**
   * Finish the idempotency reservation inside the use-case write
   * transaction, the same seam the procurement commands use. Completing here
   * rather than after the commit is what stops a retryable post-commit
   * failure from letting the client re-apply the same stock delta.
   */
  completeInTransaction: (db: DatabaseInstance, resultRef: unknown) => void;
}
