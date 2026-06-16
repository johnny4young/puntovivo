/**
 * Create a draft purchase from an OCR-extracted invoice (used by the AI
 * invoice-upload flow in `trpc/routers/ai.ts`).
 *
 * ENG-178 — relocated verbatim from the former monolithic
 * `trpc/routers/purchases.ts` during the megafile decomposition; the only
 * change is the `ctx` parameter type (the standalone `PurchaseContext`
 * instead of the tRPC-coupled `PurchaseMutationContext`).
 *
 * @module application/purchases/createOcrDraftPurchase
 */
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { purchaseItems, purchases, sequentials } from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  getPurchaseSequentialContext,
  getPurchaseSiteContext,
  validateProvider,
} from './helpers.js';
import { getPurchaseRecord } from './purchase-read.js';
import { resolvePurchaseItems } from './resolveItems.js';
import type { CreateOcrDraftPurchaseInput, PurchaseContext } from './types.js';

export async function createOcrDraftPurchase(
  ctx: PurchaseContext,
  input: CreateOcrDraftPurchaseInput
) {
  await validateProvider(ctx.db, ctx.tenantId, input.providerId);

  const now = new Date().toISOString();
  const purchaseId = nanoid();
  const sequentialContext = await getPurchaseSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
  const purchaseSite = await getPurchaseSiteContext(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    sequentialContext.siteId
  );
  const resolvedItems = await resolvePurchaseItems(ctx.db, ctx.tenantId, input.items);
  const total = resolvedItems.subtotal;
  const nextSequentialValue = sequentialContext.currentValue + 1;
  const purchaseNumber = `${sequentialContext.prefix}${String(nextSequentialValue).padStart(6, '0')}`;

  ctx.db.transaction(tx => {
    tx.update(sequentials)
      .set({
        currentValue: nextSequentialValue,
        updatedAt: now,
      })
      .where(eq(sequentials.id, sequentialContext.id))
      .run();

    tx.insert(purchases)
      .values({
        id: purchaseId,
        tenantId: ctx.tenantId,
        purchaseNumber,
        providerId: input.providerId,
        orderId: null,
        siteId: purchaseSite.id,
        status: 'draft',
        subtotal: total,
        total,
        notes: input.notes ?? null,
        createdBy: ctx.user!.id,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const row of resolvedItems.rows) {
      tx.insert(purchaseItems)
        .values({
          id: row.id,
          purchaseId,
          productId: row.productId,
          quantity: row.quantity,
          unitId: row.unitId,
          unitEquivalence: row.unitEquivalence,
          costPerUnit: row.costPerUnit,
          baseUnitCost: row.baseUnitCost,
          total: row.total,
        })
        .run();
    }
  });

  await enqueueSync(ctx, {
    entityType: 'purchases',
    entityId: purchaseId,
    operation: 'create',
    data: {
      id: purchaseId,
      purchaseNumber,
      providerId: input.providerId,
      total,
      siteId: purchaseSite.id,
      status: 'draft',
    },
  });

  return getPurchaseRecord(ctx.db, ctx.tenantId, purchaseId);
}
