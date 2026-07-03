/**
 * Inventory lots tRPC router (Auditoría 2026-07 — lots, expiry & costing).
 *
 * - `receive` (manager/admin) — record a received batch; increments an
 *   existing (site, product, lot) or inserts a new one, blending cost.
 * - `list` (tenant) — a product's lots at a site, FEFO-ordered.
 * - `expiring` (tenant) — lots with stock expiring within a window, for the
 *   expiry-alert surface.
 *
 * These form the lot foundation. Auto-consumption on the sale path (FEFO +
 * per-lot COGS behind `products.tracksLots`) is the next slice; the pure
 * selection/cost logic it will use already lives in
 * `services/inventory-lots/select-fefo.ts` and is unit-tested here.
 *
 * @module trpc/routers/inventoryLots
 */

import { and, eq } from 'drizzle-orm';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { products } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertTenantSite } from '../../services/devices/authority/helpers.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  listExpiringLots,
  listLotsForProduct,
  receiveInventoryLot,
} from '../../services/inventory-lots/index.js';
import {
  expiringLotsInput,
  listLotsInput,
  receiveLotInput,
} from '../schemas/inventoryLots.js';

export const inventoryLotsRouter = router({
  receive: managerOrAdminProcedure.input(receiveLotInput).mutation(async ({ ctx, input }) => {
    await assertTenantSite(ctx.db, ctx.tenantId, input.siteId);

    const product = await ctx.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
      .get();
    if (!product) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'LOT_PRODUCT_NOT_FOUND',
        message: 'Product not found for this tenant',
        details: { productId: input.productId },
      });
    }

    const now = new Date().toISOString();
    const result = receiveInventoryLot(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      lotNumber: input.lotNumber,
      expiresAt: input.expiresAt ?? null,
      quantity: input.quantity,
      unitCost: input.unitCost,
      notes: input.notes ?? null,
      now,
    });

    await enqueueSync(ctx, {
      entityType: 'inventory_lots',
      entityId: result.lotId,
      operation: result.created ? 'create' : 'update',
      data: {
        id: result.lotId,
        siteId: input.siteId,
        productId: input.productId,
        lotNumber: input.lotNumber,
        onHand: result.onHand,
        unitCost: result.unitCost,
      },
    });

    return result;
  }),

  list: tenantProcedure.input(listLotsInput).query(async ({ ctx, input }) => {
    const items = listLotsForProduct(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      activeOnly: input.activeOnly,
    });
    return { items };
  }),

  expiring: tenantProcedure.input(expiringLotsInput).query(async ({ ctx, input }) => {
    const cutoff = new Date(Date.now() + input.withinDays * 24 * 60 * 60 * 1000).toISOString();
    const items = listExpiringLots(ctx.db, {
      tenantId: ctx.tenantId,
      cutoffIso: cutoff,
      ...(input.siteId ? { siteId: input.siteId } : {}),
    });
    return { items, cutoff };
  }),
});
