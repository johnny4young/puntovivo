/** ENG-123b — Public structural context for provider mutation use-cases. */
import type { DatabaseInstance } from '../../db/index.js';

export interface ProviderMutationContext {
  db: DatabaseInstance;
  tenantId: string;
  envelope?: { operationId: string; idempotencyKey?: string } | null;
  deviceId?: string | null;
}
