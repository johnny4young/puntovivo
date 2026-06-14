/**
 * Transfers tRPC Router (Phase 2 DB-102 / API-102 steps 1-3).
 *
 * Procedures:
 * - `transfers.create`  (manager+) — immediate or deferred transfer between two sites
 * - `transfers.list`    (manager+) — recent transfer history
 * - `transfers.getById` (manager+) — single transfer + line items for the detail drawer
 * - `transfers.receive` (manager+) — complete an in_transit transfer at destination
 * - `transfers.void`    (manager+) — reverse a completed or in_transit transfer
 *
 * @module trpc/routers/transfers
 */

import { TRPCError } from '@trpc/server';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { criticalCommandManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import {
  createInventoryTransfer,
  getInventoryTransferById,
  listRecentTransfers,
  receiveInventoryTransfer,
  voidInventoryTransfer,
} from '../../services/inventory-transfers/index.js';
import {
  createTransferInput,
  getTransferInput,
  listTransfersInput,
  receiveTransferInput,
  voidTransferInput,
} from '../schemas/transfers.js';
import { ServerErrorWithCode } from '../../lib/errorCodes.js';

export const transfersRouter = router({
  create: criticalCommandManagerOrAdminProcedure
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

  getById: managerOrAdminProcedure
    .input(getTransferInput)
    .query(async ({ ctx, input }) => {
      const detail = await getInventoryTransferById(ctx.db, ctx.tenantId, input.id);
      if (!detail) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Transfer not found',
          cause: new ServerErrorWithCode(
            'TRANSFER_NOT_FOUND',
            'Transfer not found',
            { transferId: input.id }
          ),
        });
      }
      return detail;
    }),

  receive: criticalCommandManagerOrAdminProcedure
    .input(receiveTransferInput)
    .mutation(async ({ ctx, input }) => {
      return receiveInventoryTransfer(ctx.db, {
        tenantId: ctx.tenantId,
        transferId: input.transferId,
        receivedBy: ctx.user!.id,
        lines: input.lines,
        discrepancyNotes: input.discrepancyNotes ?? null,
      });
    }),

  void: criticalCommandManagerOrAdminProcedure
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
