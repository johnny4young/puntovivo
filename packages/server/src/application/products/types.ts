/** Public structural context for product catalog mutation use-cases. */
import type { DatabaseInstance } from '../../db/index.js';

export interface ProductMutationContext {
  db: DatabaseInstance;
  tenantId: string;
  /** Active site of the request, already checked active and tenant-owned. */
  siteId?: string | null;
  user: { id: string; role: string };
  envelope?: { operationId: string; idempotencyKey?: string } | null;
  deviceId?: string | null;
}
