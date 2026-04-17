/**
 * Transfers tRPC Router (Phase 2 DB-102 / API-102 steps 1-3).
 *
 * Procedures:
 * - `transfers.create`  (manager+) — immediate or deferred transfer between two sites
 * - `transfers.list`    (manager+) — recent transfer history
 * - `transfers.receive` (manager+) — complete an in_transit transfer at destination
 * - `transfers.void`    (manager+) — reverse a completed or in_transit transfer
 *
 * @module trpc/routers/transfers
 */

import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import {
  createInventoryTransfer,
  listRecentTransfers,
  receiveInventoryTransfer,
  voidInventoryTransfer,
} from '../../services/inventory-transfers.js';
import {
  createTransferInput,
  listTransfersInput,
  receiveTransferInput,
  voidTransferInput,
} from '../schemas/transfers.js';

export const transfersRouter = router({
  create: managerOrAdminProcedure
    .input(createTransferInput)
    .mutation(async ({ ctx, input }) => {
      return createInventoryTransfer(ctx.db, {
        tenantId: ctx.tenantId,
        fromSiteId: input.fromSiteId,
        toSiteId: input.toSiteId,
        items: input.items,
        notes: input.notes ?? null,
        createdBy: ctx.user!.id,
        defer: input.defer ?? false,
      });
    }),

  list: managerOrAdminProcedure.input(listTransfersInput).query(async ({ ctx, input }) => {
    const items = await listRecentTransfers(ctx.db, ctx.tenantId, {
      limit: input?.limit,
    });
    return { items };
  }),

  receive: managerOrAdminProcedure
    .input(receiveTransferInput)
    .mutation(async ({ ctx, input }) => {
      return receiveInventoryTransfer(ctx.db, {
        tenantId: ctx.tenantId,
        transferId: input.transferId,
        receivedBy: ctx.user!.id,
      });
    }),

  void: managerOrAdminProcedure
    .input(voidTransferInput)
    .mutation(async ({ ctx, input }) => {
      return voidInventoryTransfer(ctx.db, {
        tenantId: ctx.tenantId,
        transferId: input.transferId,
        reason: input.reason ?? null,
        voidedBy: ctx.user!.id,
      });
    }),
});
