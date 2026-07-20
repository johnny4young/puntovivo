/** serialized inventory receipt, availability and warranty lookup. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { inventoryMovements, products } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  applyInventoryBalanceDelta,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import {
  listProductSerialUnits,
  lookupProductSerialWarranty,
  receiveProductSerialUnits,
} from '../../services/product-serials.js';
import { assertCatalogStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { assertTenantSite } from '../../services/devices/authority/helpers.js';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import {
  listProductSerialsInput,
  lookupProductSerialInput,
  receiveProductSerialsInput,
} from '../schemas/productSerials.js';

export const productSerialsRouter = router({
  receive: managerOrAdminProcedure
    .input(receiveProductSerialsInput)
    .mutation(async ({ ctx, input }) => {
      await assertTenantSite(ctx.db, ctx.tenantId, input.siteId);
      const product = await ctx.db
        .select({
          id: products.id,
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
          catalogType: products.catalogType,
        })
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
        .get();
      if (!product) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PRODUCT_SERIAL_PRODUCT_NOT_FOUND',
          message: 'Product not found for this tenant',
        });
      }
      assertCatalogStockMutationAllowed({
        catalogType: product.catalogType,
        delta: input.serialNumbers.length,
      });
      if (!product.tracksSerials) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PRODUCT_SERIAL_TRACKING_REQUIRED',
          message: 'Serial tracking must be enabled before receiving serial units',
        });
      }
      if (product.tracksLots) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PRODUCT_SERIAL_TRACKING_CONFLICT',
          message: 'Lot tracking and serial tracking cannot be enabled together',
        });
      }

      const now = new Date().toISOString();
      const movementId = nanoid();
      const result = ctx.db.transaction(tx => {
        const syncContext = { ...ctx, db: tx as unknown as typeof ctx.db };
        const previousStock = getProductStockTotal(tx, ctx.tenantId, input.productId);
        const rows = receiveProductSerialUnits(tx as unknown as typeof ctx.db, {
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          productId: input.productId,
          serialNumbers: input.serialNumbers,
          unitCost: input.unitCost,
          warrantyExpiresAt: input.warrantyExpiresAt ?? null,
          notes: input.notes ?? null,
          now,
          syncContext,
        });
        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          productId: input.productId,
          delta: rows.length,
          initialOnHandIfMissing: 0,
          serialAware: true,
          now,
        });
        tx.insert(inventoryMovements)
          .values({
            id: movementId,
            tenantId: ctx.tenantId,
            productId: input.productId,
            type: 'purchase',
            quantity: rows.length,
            previousStock,
            newStock: previousStock + rows.length,
            reference: rows[0]!.id,
            notes: input.notes ?? `Serial receipt · ${rows.length} units`,
            createdBy: ctx.user!.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
        enqueueSyncInTransaction(syncContext, {
          entityType: 'inventory_movements',
          entityId: movementId,
          operation: 'create',
          data: { id: movementId, productId: input.productId, quantity: rows.length },
        });
        return { items: rows };
      });
      return { ...result, count: result.items.length };
    }),

  list: tenantProcedure.input(listProductSerialsInput).query(async ({ ctx, input }) => {
    await assertTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return {
      items: listProductSerialUnits(ctx.db, {
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        productId: input.productId,
        sellableOnly: input.sellableOnly,
      }),
    };
  }),

  lookup: tenantProcedure.input(lookupProductSerialInput).query(({ ctx, input }) => ({
    items: lookupProductSerialWarranty(ctx.db, {
      tenantId: ctx.tenantId,
      serialNumber: input.serialNumber,
    }),
  })),
});
