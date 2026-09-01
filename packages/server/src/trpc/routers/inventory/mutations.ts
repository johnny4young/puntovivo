/**
 * Thin tRPC adapters for inventory stock mutations.
 *
 * Transactional orchestration lives in `application/inventory/`; this module
 * owns only role/input middleware and the retained reconciliation endpoint.
 *
 * @module trpc/routers/inventory/mutations
 */
import {
  approveInventoryCount,
  adjustInventoryStock,
  createInventoryCount,
  createInventoryMovement,
  recordInventoryEntry,
  rejectInventoryCount,
  saveInventoryCount,
  submitInventoryCount,
} from '../../../application/inventory/index.js';
import { reconcileProductStockFromBalances } from '../../../services/inventory-balances.js';
import { asCriticalCommandContext } from '../../middleware/commandEnvelope.js';
import { criticalCommandManagerOrAdminProcedure } from '../../middleware/criticalCommand.js';
import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import {
  adjustStockInput,
  approveInventoryCountInput,
  createInventoryCountInput,
  createMovementInput,
  recordEntryInput,
  rejectInventoryCountInput,
  saveInventoryCountInput,
  submitInventoryCountInput,
} from '../../schemas/inventory.js';

export const inventoryMutationProcedures = {
  createCountSession: criticalCommandManagerOrAdminProcedure
    .input(createInventoryCountInput)
    .mutation(({ ctx, input }) => createInventoryCount(asCriticalCommandContext(ctx), input)),

  saveCountSession: criticalCommandManagerOrAdminProcedure
    .input(saveInventoryCountInput)
    .mutation(({ ctx, input }) => saveInventoryCount(asCriticalCommandContext(ctx), input)),

  submitCountSession: criticalCommandManagerOrAdminProcedure
    .input(submitInventoryCountInput)
    .mutation(({ ctx, input }) => submitInventoryCount(asCriticalCommandContext(ctx), input)),

  approveCountSession: criticalCommandManagerOrAdminProcedure
    .input(approveInventoryCountInput)
    .mutation(({ ctx, input }) => approveInventoryCount(asCriticalCommandContext(ctx), input)),

  rejectCountSession: criticalCommandManagerOrAdminProcedure
    .input(rejectInventoryCountInput)
    .mutation(({ ctx, input }) => rejectInventoryCount(asCriticalCommandContext(ctx), input)),

  recordEntry: managerOrAdminProcedure
    .input(recordEntryInput)
    .mutation(({ ctx, input }) => recordInventoryEntry({ ...ctx, user: ctx.user! }, input)),

  createMovement: criticalCommandManagerOrAdminProcedure
    .input(createMovementInput)
    .mutation(({ ctx, input }) => createInventoryMovement(asCriticalCommandContext(ctx), input)),

  adjustStock: criticalCommandManagerOrAdminProcedure
    .input(adjustStockInput)
    .mutation(({ ctx, input }) => adjustInventoryStock(asCriticalCommandContext(ctx), input)),

  /**
   * Compatibility no-op: inventory_balances is already the stock source of
   * truth, so there is no denormalized product cache to reconcile.
   *
   * @deprecated The Operations client no longer calls this mutation. Remove
   * after 2026-10-01 together with reports.inventory.discrepancies.
   */
  reconcileBalances: adminProcedure.mutation(async ({ ctx }) => {
    const result = reconcileProductStockFromBalances(ctx.db, ctx.tenantId);
    return { ...result, reconciledAt: new Date().toISOString() };
  }),
};
