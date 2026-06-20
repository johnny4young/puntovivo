/**
 * Sync tRPC Router
 *
 * Local sync outbox management and sync status.
 *
 * Procedures (implemented):
 * - sync.status          (tenant) - Get current sync status
 * - sync.listQueue       (tenant, manager/admin) - List pending sync_outbox items
 * - sync.addToQueue      (tenant, manager/admin) - Add an operation to the sync_outbox
 * - sync.removeFromQueue (tenant, manager/admin) - Remove an item from the sync_outbox
 * - sync.listConflicts   (tenant, manager/admin) - List unresolved sync conflicts
 *
 * Additional procedures:
 * - sync.push    - Process queued local changes
 * - sync.pull    - Return a sync snapshot
 * - sync.resolve - Resolve a sync conflict
 *
 * ENG-064 contract v1 procedures:
 * - sync.getContract   - Manifest negotiation for ENG-068+ multi-store sync
 * - sync.peekOutbox    - Operations Center tail
 * - sync.retry         - Operator-driven retry of stuck rows
 *
 * ENG-178 — decomposed into per-concern record modules (status / queue /
 * conflicts / push / contract) + a `helpers.ts` leaf. This barrel re-assembles
 * the flat router so every path (`sync.status` … `sync.retry`) is preserved.
 *
 * @module trpc/routers/sync
 */

import { router } from '../../init.js';
import { syncStatusProcedures } from './status.js';
import { syncQueueProcedures } from './queue.js';
import { syncConflictsProcedures } from './conflicts.js';
import { syncPushProcedures } from './push.js';
import { syncContractProcedures } from './contract.js';

export const syncRouter = router({
  ...syncStatusProcedures,
  ...syncQueueProcedures,
  ...syncConflictsProcedures,
  ...syncPushProcedures,
  ...syncContractProcedures,
});
