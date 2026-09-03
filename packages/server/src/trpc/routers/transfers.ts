/**
 * Transfers tRPC router.
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
  receiveInventoryTransfer,
  voidInventoryTransfer,
} from '../../application/inventory/index.js';
import {
  getInventoryTransferById,
  listRecentTransfers,
} from '../../services/inventory-transfers/index.js';
import {
  createTransferInput,
  getTransferInput,
  listTransfersInput,
  receiveTransferInput,
  voidTransferInput,
} from '../schemas/transfers.js';
import { ServerErrorWithCode } from '../../lib/errorCodes.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { resolveTenantBusinessClock } from '../../services/pharmacy/business-clock.js';

export const transfersRouter = router({
  create: criticalCommandManagerOrAdminProcedure
    .input(createTransferInput)
    .mutation(async ({ ctx, input }) => {
      const critical = asCriticalCommandContext(ctx);
      const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
      return createInventoryTransfer(ctx.db, {
        tenantId: ctx.tenantId,
        fromSiteId: input.fromSiteId,
        toSiteId: input.toSiteId,
        items: input.items,
        notes: input.notes ?? null,
        createdBy: ctx.user!.id,
        defer: input.defer ?? false,
        nowIso: clock.nowIso,
        businessDate: clock.businessDate,
        businessTimezone: clock.timezone,
        countryCode: clock.countryCode,
        localeVersion: clock.localeVersion,
        syncContext: critical,
        completeInTransaction: critical.completeInTransaction,
      });
    }),

  list: managerOrAdminProcedure.input(listTransfersInput).query(async ({ ctx, input }) => {
    const items = await listRecentTransfers(ctx.db, ctx.tenantId, {
      limit: input?.limit,
    });
    return { items };
  }),

  getById: managerOrAdminProcedure.input(getTransferInput).query(async ({ ctx, input }) => {
    const detail = await getInventoryTransferById(ctx.db, ctx.tenantId, input.id);
    if (!detail) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Transfer not found',
        cause: new ServerErrorWithCode('TRANSFER_NOT_FOUND', 'Transfer not found', {
          transferId: input.id,
        }),
      });
    }
    return detail;
  }),

  receive: criticalCommandManagerOrAdminProcedure
    .input(receiveTransferInput)
    .mutation(async ({ ctx, input }) => {
      const critical = asCriticalCommandContext(ctx);
      const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
      return receiveInventoryTransfer(ctx.db, {
        tenantId: ctx.tenantId,
        transferId: input.transferId,
        receivedBy: ctx.user!.id,
        lines: input.lines,
        discrepancyNotes: input.discrepancyNotes ?? null,
        nowIso: clock.nowIso,
        businessDate: clock.businessDate,
        businessTimezone: clock.timezone,
        countryCode: clock.countryCode,
        localeVersion: clock.localeVersion,
        syncContext: critical,
        completeInTransaction: critical.completeInTransaction,
      });
    }),

  void: criticalCommandManagerOrAdminProcedure
    .input(voidTransferInput)
    .mutation(async ({ ctx, input }) => {
      const critical = asCriticalCommandContext(ctx);
      const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
      return voidInventoryTransfer(ctx.db, {
        tenantId: ctx.tenantId,
        transferId: input.transferId,
        reason: input.reason ?? null,
        voidedBy: ctx.user!.id,
        nowIso: clock.nowIso,
        businessDate: clock.businessDate,
        businessTimezone: clock.timezone,
        countryCode: clock.countryCode,
        localeVersion: clock.localeVersion,
        syncContext: critical,
        completeInTransaction: critical.completeInTransaction,
      });
    }),
});
