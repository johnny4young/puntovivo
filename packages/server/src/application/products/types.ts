/** ENG-207 — Public structural context for product catalog mutation use-cases. */
import type { DatabaseInstance } from '../../db/index.js';

export interface ProductMutationContext {
  db: DatabaseInstance;
  tenantId: string;
  envelope?: { operationId: string; idempotencyKey?: string } | null;
  deviceId?: string | null;
}
