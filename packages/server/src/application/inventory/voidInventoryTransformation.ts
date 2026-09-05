/** Fail-closed reversal of an untouched inventory transformation. */

import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  inventoryLots,
  inventoryMovements,
  inventoryTransformationInputs,
  inventoryTransformationOutputs,
  inventoryTransformations,
  products,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { tryRoundMoneyToSafeCents } from '../../lib/money.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  applyInventoryBalanceDelta,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import {
  consumeExactInventoryLots,
  enqueueInventoryLotSnapshotsInTransaction,
  isLotExpiredAt,
  restoreExactInventoryLot,
} from '../../services/inventory-lots/index.js';
import {
  getInventoryTransformationRecord,
  getInventoryTransformationSyncAggregate,
} from '../../services/inventory-transformations/index.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { TransactionalInventoryContext } from './types.js';

export function voidInventoryTransformation(
  ctx: TransactionalInventoryContext,
  input: { id: string; reason: string }
) {
  const now = new Date().toISOString();
  return ctx.db.transaction(
    rawTx => {
      const tx = rawTx as unknown as DatabaseInstance;
      const header = tx
        .select()
        .from(inventoryTransformations)
        .where(
          and(
            eq(inventoryTransformations.tenantId, ctx.tenantId),
            eq(inventoryTransformations.id, input.id)
          )
        )
        .get();
      if (!header) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'TRANSFORMATION_NOT_FOUND',
          message: 'Inventory transformation was not found',
        });
      }
      if (header.status !== 'completed') {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'TRANSFORMATION_NOT_COMPLETED',
          message: 'Only a completed inventory transformation can be voided',
          details: { status: header.status },
        });
      }

      const inputs = tx
        .select()
        .from(inventoryTransformationInputs)
        .where(
          and(
            eq(inventoryTransformationInputs.tenantId, ctx.tenantId),
            eq(inventoryTransformationInputs.transformationId, input.id)
          )
        )
        .all();
      const outputs = tx
        .select()
        .from(inventoryTransformationOutputs)
        .where(
          and(
            eq(inventoryTransformationOutputs.tenantId, ctx.tenantId),
            eq(inventoryTransformationOutputs.transformationId, input.id)
          )
        )
        .all();
      if (inputs.length === 0 || outputs.length === 0) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'TRANSFORMATION_NOT_COMPLETED',
          message: 'Transformation provenance is incomplete and cannot be reversed',
        });
      }

      const inputLotIds = inputs.flatMap(transformationInput =>
        transformationInput.lotId ? [transformationInput.lotId] : []
      );
      const inputLots =
        inputLotIds.length === 0
          ? []
          : tx
              .select({
                id: inventoryLots.id,
                productId: inventoryLots.productId,
                lotNumber: inventoryLots.lotNumber,
                expiresAt: inventoryLots.expiresAt,
              })
              .from(inventoryLots)
              .where(
                and(
                  eq(inventoryLots.tenantId, ctx.tenantId),
                  eq(inventoryLots.siteId, header.siteId),
                  inArray(inventoryLots.id, inputLotIds)
                )
              )
              .all();
      const inputLotById = new Map(inputLots.map(lot => [lot.id, lot]));
      for (const transformationInput of inputs) {
        if (!transformationInput.lotId) continue;
        const lot = inputLotById.get(transformationInput.lotId);
        if (
          !lot ||
          lot.productId !== transformationInput.productId ||
          lot.lotNumber !== transformationInput.lotNumberSnapshot ||
          lot.expiresAt !== transformationInput.expiresAtSnapshot
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'TRANSFORMATION_INPUT_CHANGED',
            message: 'An exact input lot identity changed after the transformation',
            details: {
              transformationInputId: transformationInput.id,
              lotId: transformationInput.lotId,
            },
          });
        }
      }

      const outputProductIds = [...new Set(outputs.map(output => output.productId))];
      const outputProducts = tx
        .select({
          id: products.id,
          cost: products.cost,
          initialCost: products.initialCost,
          syncVersion: products.syncVersion,
        })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, outputProductIds)))
        .all();
      const outputProductById = new Map(outputProducts.map(product => [product.id, product]));

      // Prove that none of the resulting stock or cost has been touched since
      // execution. Aggregate stock cannot identify physical units, so the
      // site-balance revision is the conservative provenance boundary.
      for (const output of outputs) {
        const product = outputProductById.get(output.productId);
        const currentCost = product ? tryRoundMoneyToSafeCents(product.cost) : null;
        const currentInitialCost = product ? tryRoundMoneyToSafeCents(product.initialCost) : null;
        const resultingCost = tryRoundMoneyToSafeCents(output.resultingProductCost);
        const resultingInitialCost = tryRoundMoneyToSafeCents(output.resultingProductInitialCost);
        const previousCost = tryRoundMoneyToSafeCents(output.previousProductCost);
        const previousInitialCost = tryRoundMoneyToSafeCents(output.previousProductInitialCost);
        if (
          !product ||
          currentCost === null ||
          currentCost < 0 ||
          currentInitialCost === null ||
          currentInitialCost < 0 ||
          resultingCost === null ||
          resultingCost < 0 ||
          resultingInitialCost === null ||
          resultingInitialCost < 0 ||
          previousCost === null ||
          previousCost < 0 ||
          previousInitialCost === null ||
          previousInitialCost < 0 ||
          currentCost !== resultingCost ||
          currentInitialCost !== resultingInitialCost ||
          product.syncVersion !== output.resultingProductSyncVersion
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'TRANSFORMATION_COST_CHANGED',
            message: 'A resulting product cost changed after the transformation',
            details: { productId: output.productId },
          });
        }
        const balance = tx
          .select({ onHand: inventoryBalances.onHand, version: inventoryBalances.version })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, ctx.tenantId),
              eq(inventoryBalances.siteId, header.siteId),
              eq(inventoryBalances.productId, output.productId)
            )
          )
          .get();
        if (
          !balance ||
          !Number.isFinite(balance.onHand) ||
          balance.version !== output.resultingBalanceVersion ||
          balance.onHand + QUANTITY_EPSILON < output.baseQuantity
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'TRANSFORMATION_OUTPUT_CONSUMED',
            message: 'Resulting stock changed after the transformation',
            details: {
              productId: output.productId,
              expectedBalanceVersion: output.resultingBalanceVersion,
              currentBalanceVersion: balance?.version ?? null,
            },
          });
        }
        if (output.lotId) {
          const lot = tx
            .select({
              lotNumber: inventoryLots.lotNumber,
              expiresAt: inventoryLots.expiresAt,
              status: inventoryLots.status,
              onHand: inventoryLots.onHand,
              unitCost: inventoryLots.unitCost,
            })
            .from(inventoryLots)
            .where(
              and(
                eq(inventoryLots.tenantId, ctx.tenantId),
                eq(inventoryLots.siteId, header.siteId),
                eq(inventoryLots.productId, output.productId),
                eq(inventoryLots.id, output.lotId)
              )
            )
            .get();
          const frozenStatus = isLotExpiredAt(output.expiresAtSnapshot, header.createdAt)
            ? 'expired'
            : 'active';
          const currentStatus =
            lot?.status === 'quarantined' || lot?.status === 'expired'
              ? lot.status
              : isLotExpiredAt(lot?.expiresAt ?? null, now)
                ? 'expired'
                : lot?.status;
          if (
            !lot ||
            lot.lotNumber !== output.lotNumberSnapshot ||
            lot.expiresAt !== output.expiresAtSnapshot ||
            currentStatus !== frozenStatus ||
            !equalNumber(lot.onHand, output.baseQuantity) ||
            !equalNumber(lot.unitCost, output.unitCost)
          ) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'TRANSFORMATION_OUTPUT_CONSUMED',
              message: 'The exact output lot changed after the transformation',
              details: { productId: output.productId, lotId: output.lotId },
            });
          }
        }
      }

      const movementIds: string[] = [];
      const mutatedLotIds = new Set<string>();
      const restoredCostByProductId = new Map<string, { cost: number; initialCost: number }>();
      const recordMovement = (productId: string, quantity: number, notes: string): void => {
        const previousStock = getProductStockTotal(tx, ctx.tenantId, productId);
        const newStock = roundQuantity(previousStock + quantity, 12);
        if (!Number.isFinite(previousStock) || !Number.isFinite(newStock)) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'INVENTORY_QUANTITY_OUT_OF_RANGE',
            message: 'Transformation reversal movement totals must remain finite',
            details: { productId },
          });
        }
        const balance = tx
          .select({ onHand: inventoryBalances.onHand })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, ctx.tenantId),
              eq(inventoryBalances.siteId, header.siteId),
              eq(inventoryBalances.productId, productId)
            )
          )
          .get();
        if (!balance || (quantity < 0 && balance.onHand + QUANTITY_EPSILON < Math.abs(quantity))) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'TRANSFORMATION_OUTPUT_CONSUMED',
            message: 'Transformation stock is no longer available for reversal',
            details: { productId },
          });
        }
        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: header.siteId,
          productId,
          delta: quantity,
          initialOnHandIfMissing: balance.onHand,
          now,
        });
        const movementId = nanoid();
        tx.insert(inventoryMovements)
          .values({
            id: movementId,
            tenantId: ctx.tenantId,
            productId,
            siteId: header.siteId,
            type: 'transformation',
            quantity,
            previousStock,
            newStock,
            reference: input.id,
            notes,
            createdBy: ctx.user.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
        movementIds.push(movementId);
      };

      // Remove outputs before restoring inputs. Every precondition above was
      // checked before the first write, and BEGIN IMMEDIATE excludes another
      // writer from invalidating those proofs mid-command.
      for (const output of outputs) {
        if (output.lotId) {
          consumeExactInventoryLots(tx, {
            tenantId: ctx.tenantId,
            siteId: header.siteId,
            productId: output.productId,
            allocations: [{ lotId: output.lotId, quantity: output.baseQuantity }],
            now,
          });
          mutatedLotIds.add(output.lotId);
        }
        recordMovement(output.productId, -output.baseQuantity, header.recipeNameSnapshot);
        const changed = tx
          .update(products)
          .set({
            cost: output.previousProductCost,
            initialCost: output.previousProductInitialCost,
            syncStatus: 'pending',
            syncVersion: output.resultingProductSyncVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(products.tenantId, ctx.tenantId),
              eq(products.id, output.productId),
              eq(products.cost, output.resultingProductCost),
              eq(products.initialCost, output.resultingProductInitialCost),
              eq(products.syncVersion, output.resultingProductSyncVersion)
            )
          )
          .run();
        if (changed.changes !== 1) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'TRANSFORMATION_COST_CHANGED',
            message: 'Resulting product cost changed during reversal',
            details: { productId: output.productId },
          });
        }
        restoredCostByProductId.set(output.productId, {
          cost: output.previousProductCost,
          initialCost: output.previousProductInitialCost,
        });
      }

      for (const transformationInput of inputs) {
        if (transformationInput.lotId) {
          restoreExactInventoryLot(tx, {
            tenantId: ctx.tenantId,
            siteId: header.siteId,
            productId: transformationInput.productId,
            lotId: transformationInput.lotId,
            quantity: transformationInput.baseQuantity,
            unitCost: transformationInput.unitCost,
            now,
          });
          mutatedLotIds.add(transformationInput.lotId);
        }
        recordMovement(
          transformationInput.productId,
          transformationInput.baseQuantity,
          header.recipeNameSnapshot
        );
      }

      const statusChange = tx
        .update(inventoryTransformations)
        .set({
          status: 'voided',
          voidedBy: ctx.user.id,
          voidedAt: now,
          voidReason: input.reason.trim(),
          syncStatus: 'pending',
          syncVersion: (header.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryTransformations.tenantId, ctx.tenantId),
            eq(inventoryTransformations.id, input.id),
            eq(inventoryTransformations.status, 'completed'),
            header.syncVersion === null
              ? isNull(inventoryTransformations.syncVersion)
              : eq(inventoryTransformations.syncVersion, header.syncVersion)
          )
        )
        .run();
      if (statusChange.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'TRANSFORMATION_NOT_COMPLETED',
          message: 'Transformation state changed during reversal',
        });
      }

      writeAuditLog({
        tx: rawTx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'inventory.transformation.void',
        resourceType: 'inventory_transformation',
        resourceId: input.id,
        before: { status: 'completed' },
        after: { status: 'voided', voidedAt: now },
        metadata: {
          siteId: header.siteId,
          recipeId: header.recipeId,
          recipeName: header.recipeNameSnapshot,
          reason: input.reason.trim(),
          inputCount: inputs.length,
          outputCount: outputs.length,
        },
        operationId: ctx.envelope.operationId,
      });

      const syncContext = { ...ctx, db: tx };
      const syncAggregate = getInventoryTransformationSyncAggregate(tx, ctx.tenantId, input.id);
      if (!syncAggregate) {
        throw new Error('Voided inventory transformation aggregate is missing');
      }
      enqueueSyncInTransaction(syncContext, {
        entityType: 'inventory_transformations',
        entityId: input.id,
        operation: 'update',
        data: syncAggregate,
      });
      for (const movementId of movementIds) {
        enqueueSyncInTransaction(syncContext, {
          entityType: 'inventory_movements',
          entityId: movementId,
          operation: 'create',
          data: { id: movementId, transformationId: input.id, reversal: true },
        });
      }
      for (const [productId, costs] of restoredCostByProductId) {
        enqueueSyncInTransaction(syncContext, {
          entityType: 'products',
          entityId: productId,
          operation: 'update',
          data: {
            id: productId,
            cost: costs.cost,
            initialCost: costs.initialCost,
            transformationId: input.id,
            reversal: true,
          },
        });
      }
      enqueueInventoryLotSnapshotsInTransaction(syncContext, [...mutatedLotIds], {
        transformationId: input.id,
        reversal: true,
      });

      const result = getInventoryTransformationRecord(tx, ctx.tenantId, input.id)!;
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

function equalNumber(left: number, right: number): boolean {
  return (
    Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= QUANTITY_EPSILON
  );
}
