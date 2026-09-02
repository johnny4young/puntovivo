/** Atomic execution of a saved BOM/cut/recipe against site stock. */

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
  inventoryTransformationRecipeInputs,
  inventoryTransformationRecipeOutputs,
  inventoryTransformationRecipes,
  inventoryTransformations,
  inventoryTransformationWaste,
  products,
  sites,
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
  receiveInventoryLot,
} from '../../services/inventory-lots/index.js';
import {
  getInventoryTransformationRecord,
  getInventoryTransformationSyncAggregate,
} from '../../services/inventory-transformations/index.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { ExecuteInventoryTransformationInput } from '../../trpc/schemas/inventoryTransformations.js';
import type { TransactionalInventoryContext } from './types.js';

function equalQuantity(left: number, right: number): boolean {
  return Math.abs(left - right) <= QUANTITY_EPSILON;
}

/**
 * Transformation allocation is performed in integer cents. Reject values that
 * cannot retain an exact, finite cent representation before they reach SQLite;
 * SQLite REAL accepts Infinity and its ordinary money CHECKs do not reject it.
 */
function roundTransformationMoney(value: number): number {
  const rounded = tryRoundMoneyToSafeCents(value);
  if (rounded === null || rounded < 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFORMATION_COST_OUT_OF_RANGE',
      message: 'Transformation cost is outside the exact supported cent range',
    });
  }
  return rounded;
}

/**
 * Allocate an exact money total without letting per-line rounding make the
 * final output negative. Floors establish a safe baseline, then the largest
 * fractional remainders receive the remaining cents in stable line order.
 */
function allocateMoneyByWeights(total: number, weights: readonly number[]): number[] {
  const totalCents = Math.round(roundTransformationMoney(total) * 100);
  const maxWeight = Math.max(...weights);
  const normalizedWeights = weights.map(weight => weight / maxWeight);
  const normalizedTotal = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  const shares = normalizedWeights.map((weight, index) => {
    const exactCents = (totalCents * weight) / normalizedTotal;
    const cents = Math.floor(exactCents);
    return { index, cents, remainder: exactCents - cents };
  });
  const remainingCents = totalCents - shares.reduce((sum, share) => sum + share.cents, 0);
  const byRemainder = [...shares].sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index
  );
  for (let index = 0; index < remainingCents; index += 1) {
    byRemainder[index % byRemainder.length]!.cents += 1;
  }
  return shares.map(share => roundTransformationMoney(share.cents / 100));
}

function assertExactIds(
  actual: readonly string[],
  expected: readonly string[],
  errorCode: 'TRANSFORMATION_INPUT_MISMATCH' | 'TRANSFORMATION_OUTPUT_MISMATCH'
): void {
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    actual.some(id => !expected.includes(id))
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode,
      message: 'Execution lines must match every frozen recipe line exactly once',
    });
  }
}

function readSiteOnHand(
  tx: DatabaseInstance,
  input: { tenantId: string; siteId: string; productId: string }
): number {
  const row = tx
    .select({ onHand: inventoryBalances.onHand })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.tenantId, input.tenantId),
        eq(inventoryBalances.siteId, input.siteId),
        eq(inventoryBalances.productId, input.productId)
      )
    )
    .get();
  // inventory_balances is authoritative. Falling back to the tenant-wide sum
  // when this site has no row would duplicate stock held at another site and
  // could let a transformation consume inventory that is not physically here.
  return row?.onHand ?? 0;
}

export function executeInventoryTransformation(
  ctx: TransactionalInventoryContext,
  input: ExecuteInventoryTransformationInput
) {
  const now = new Date().toISOString();
  const transformationId = nanoid();

  return ctx.db.transaction(
    txRaw => {
      const tx = txRaw as unknown as DatabaseInstance;
      const recipe = tx
        .select()
        .from(inventoryTransformationRecipes)
        .where(
          and(
            eq(inventoryTransformationRecipes.tenantId, ctx.tenantId),
            eq(inventoryTransformationRecipes.id, input.recipeId)
          )
        )
        .get();
      if (!recipe) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'TRANSFORMATION_RECIPE_NOT_FOUND',
          message: 'Transformation recipe was not found',
        });
      }
      if (recipe.isActive === false) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'TRANSFORMATION_RECIPE_INACTIVE',
          message: 'Inactive transformation recipes cannot be executed',
        });
      }
      if (recipe.siteId !== null && recipe.siteId !== input.siteId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'TRANSFORMATION_SITE_NOT_FOUND',
          message: 'This transformation recipe is not available at the selected site',
        });
      }
      const site = tx
        .select({ id: sites.id, isActive: sites.isActive, name: sites.name })
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.siteId)))
        .get();
      if (!site || site.isActive === false) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'TRANSFORMATION_SITE_NOT_FOUND',
          message: 'Transformation site was not found or is inactive',
        });
      }

      const recipeInputs = tx
        .select()
        .from(inventoryTransformationRecipeInputs)
        .where(
          and(
            eq(inventoryTransformationRecipeInputs.tenantId, ctx.tenantId),
            eq(inventoryTransformationRecipeInputs.recipeId, recipe.id)
          )
        )
        .orderBy(inventoryTransformationRecipeInputs.position)
        .all();
      const recipeOutputs = tx
        .select()
        .from(inventoryTransformationRecipeOutputs)
        .where(
          and(
            eq(inventoryTransformationRecipeOutputs.tenantId, ctx.tenantId),
            eq(inventoryTransformationRecipeOutputs.recipeId, recipe.id)
          )
        )
        .orderBy(inventoryTransformationRecipeOutputs.position)
        .all();
      assertExactIds(
        input.inputs.map(line => line.recipeInputId),
        recipeInputs.map(line => line.id),
        'TRANSFORMATION_INPUT_MISMATCH'
      );
      assertExactIds(
        input.outputs.map(line => line.recipeOutputId),
        recipeOutputs.map(line => line.id),
        'TRANSFORMATION_OUTPUT_MISMATCH'
      );

      const productIds = [
        ...new Set([
          ...recipeInputs.map(line => line.productId),
          ...recipeOutputs.map(line => line.productId),
        ]),
      ];
      const productRows = tx
        .select({
          id: products.id,
          name: products.name,
          sku: products.sku,
          cost: products.cost,
          initialCost: products.initialCost,
          isActive: products.isActive,
          tracksStock: products.tracksStock,
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
          catalogType: products.catalogType,
          syncVersion: products.syncVersion,
        })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
        .all();
      const productById = new Map(productRows.map(row => [row.id, row]));
      for (const productId of productIds) {
        const product = productById.get(productId);
        if (
          !product ||
          product.isActive === false ||
          product.tracksStock === false ||
          product.catalogType === 'variant_parent'
        ) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFORMATION_PRODUCT_NOT_FOUND',
            message: 'A recipe product is not active stock',
            details: { productId },
          });
        }
        if (product.tracksSerials) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFORMATION_SERIAL_UNSUPPORTED',
            message: 'Serialized products cannot be transformed',
            details: { productId },
          });
        }
        roundTransformationMoney(product.cost);
        roundTransformationMoney(product.initialCost);
      }

      const inputByRecipeId = new Map(input.inputs.map(line => [line.recipeInputId, line]));
      const outputByRecipeId = new Map(input.outputs.map(line => [line.recipeOutputId, line]));
      const recipeInputById = new Map(recipeInputs.map(line => [line.id, line]));
      const stockState = new Map(
        productIds.map(productId => [productId, getProductStockTotal(tx, ctx.tenantId, productId)])
      );
      const movementIds: string[] = [];
      const mutatedLotIds = new Set<string>();
      const storedInputByKey = new Map<string, { id: string; quantity: number }>();
      const resultingCostByProductId = new Map<string, { cost: number; initialCost: number }>();

      tx.insert(inventoryTransformations)
        .values({
          id: transformationId,
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          recipeId: recipe.id,
          recipeNameSnapshot: recipe.name,
          kindSnapshot: recipe.kind,
          status: 'completed',
          totalInputCost: 0,
          totalOutputCost: 0,
          notes: input.notes?.trim() || null,
          executedBy: ctx.user.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const recordMovement = (productId: string, quantity: number, notes: string): number => {
        const previousStock = stockState.get(productId) ?? 0;
        const newStock = roundQuantity(previousStock + quantity, 12);
        if (!Number.isFinite(previousStock) || !Number.isFinite(newStock)) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'INVENTORY_QUANTITY_OUT_OF_RANGE',
            message: 'Transformation movement totals must remain finite',
            details: { productId },
          });
        }
        const currentSiteOnHand = readSiteOnHand(tx, {
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          productId,
        });
        if (quantity < 0 && currentSiteOnHand + QUANTITY_EPSILON < Math.abs(quantity)) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'TRANSFORMATION_INSUFFICIENT_STOCK',
            message: 'Transformation input exceeds stock at the selected site',
            details: {
              productId,
              siteId: input.siteId,
              available: currentSiteOnHand,
              requested: Math.abs(quantity),
            },
          });
        }
        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          productId,
          delta: quantity,
          initialOnHandIfMissing: currentSiteOnHand,
          now,
        });
        const resultingBalance = tx
          .select({ version: inventoryBalances.version })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, ctx.tenantId),
              eq(inventoryBalances.siteId, input.siteId),
              eq(inventoryBalances.productId, productId)
            )
          )
          .get();
        if (!resultingBalance) {
          throw new Error('Transformation balance update did not persist a balance row');
        }
        const movementId = nanoid();
        tx.insert(inventoryMovements)
          .values({
            id: movementId,
            tenantId: ctx.tenantId,
            productId,
            siteId: input.siteId,
            type: 'transformation',
            quantity,
            previousStock,
            newStock,
            reference: transformationId,
            notes,
            createdBy: ctx.user.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
        stockState.set(productId, newStock);
        movementIds.push(movementId);
        return resultingBalance.version;
      };

      let totalInputCost = 0;
      for (const recipeInput of recipeInputs) {
        const actual = inputByRecipeId.get(recipeInput.id)!;
        const product = productById.get(recipeInput.productId)!;
        if (product.tracksLots) {
          const allocations = actual.lotAllocations ?? [];
          const allocatedQuantity = allocations.reduce(
            (sum, allocation) => roundQuantity(sum + allocation.baseQuantity, 12),
            0
          );
          if (allocations.length === 0 || !equalQuantity(allocatedQuantity, actual.baseQuantity)) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'TRANSFORMATION_LOT_REQUIRED',
              message: 'Lot-tracked inputs require exact allocations matching the input quantity',
              details: {
                recipeInputId: recipeInput.id,
                allocated: allocatedQuantity,
                required: actual.baseQuantity,
              },
            });
          }
          const consumed = consumeExactInventoryLots(tx, {
            tenantId: ctx.tenantId,
            siteId: input.siteId,
            productId: product.id,
            allocations: allocations.map(allocation => ({
              lotId: allocation.lotId,
              quantity: allocation.baseQuantity,
            })),
            now,
          });
          for (const lot of consumed) {
            if (lot.sourceStatus === 'expired' || lot.sourceStatus === 'quarantined') {
              throwServerError({
                trpcCode: 'CONFLICT',
                errorCode: 'TRANSFORMATION_LOT_NOT_VENDABLE',
                message: 'Non-vendable lots cannot become transformed sellable output',
                details: { lotId: lot.lotId, status: lot.sourceStatus },
              });
            }
            roundTransformationMoney(lot.unitCost);
            const totalCost = roundTransformationMoney(lot.quantity * lot.unitCost);
            totalInputCost = roundTransformationMoney(totalInputCost + totalCost);
            const id = nanoid();
            tx.insert(inventoryTransformationInputs)
              .values({
                id,
                tenantId: ctx.tenantId,
                transformationId,
                recipeInputId: recipeInput.id,
                productId: product.id,
                lotId: lot.lotId,
                lotNumberSnapshot: lot.lotNumber,
                expiresAtSnapshot: lot.expiresAt,
                sourceStatusSnapshot: lot.sourceStatus,
                baseQuantity: lot.quantity,
                unitCost: lot.unitCost,
                totalCost,
                createdAt: now,
              })
              .run();
            storedInputByKey.set(`${recipeInput.id}:${lot.lotId}`, {
              id,
              quantity: lot.quantity,
            });
            mutatedLotIds.add(lot.lotId);
          }
        } else {
          if ((actual.lotAllocations?.length ?? 0) > 0) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'TRANSFORMATION_LOT_NOT_ALLOWED',
              message: 'Non-lot inputs cannot include lot allocations',
            });
          }
          const totalCost = roundTransformationMoney(actual.baseQuantity * product.initialCost);
          totalInputCost = roundTransformationMoney(totalInputCost + totalCost);
          const id = nanoid();
          tx.insert(inventoryTransformationInputs)
            .values({
              id,
              tenantId: ctx.tenantId,
              transformationId,
              recipeInputId: recipeInput.id,
              productId: product.id,
              lotId: null,
              lotNumberSnapshot: null,
              expiresAtSnapshot: null,
              sourceStatusSnapshot: null,
              baseQuantity: actual.baseQuantity,
              unitCost: product.initialCost,
              totalCost,
              createdAt: now,
            })
            .run();
          storedInputByKey.set(`${recipeInput.id}:`, { id, quantity: actual.baseQuantity });
        }
        recordMovement(product.id, -actual.baseQuantity, recipe.name);
      }

      const wasteByInputKey = new Map<string, number>();
      for (const waste of input.waste) {
        const recipeInput = recipeInputById.get(waste.recipeInputId);
        if (!recipeInput) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFORMATION_INPUT_MISMATCH',
            message: 'Waste references an input outside this recipe',
          });
        }
        const product = productById.get(recipeInput.productId)!;
        if (product.tracksLots && !waste.lotId) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFORMATION_LOT_REQUIRED',
            message: 'Waste from a lot-tracked input must identify its consumed lot',
          });
        }
        if (!product.tracksLots && waste.lotId) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFORMATION_LOT_NOT_ALLOWED',
            message: 'Waste from a non-lot input cannot identify a lot',
          });
        }
        const key = `${waste.recipeInputId}:${waste.lotId ?? ''}`;
        const storedInput = storedInputByKey.get(key);
        if (!storedInput) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFORMATION_INPUT_MISMATCH',
            message: 'Waste must reference an exact consumed input',
          });
        }
        const accumulated = roundQuantity((wasteByInputKey.get(key) ?? 0) + waste.baseQuantity, 12);
        if (accumulated - storedInput.quantity > QUANTITY_EPSILON) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFORMATION_WASTE_EXCEEDS_INPUT',
            message: 'Waste cannot exceed the exact consumed input quantity',
          });
        }
        wasteByInputKey.set(key, accumulated);
        tx.insert(inventoryTransformationWaste)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            transformationId,
            transformationInputId: storedInput.id,
            baseQuantity: waste.baseQuantity,
            reason: waste.reason.trim(),
            createdAt: now,
          })
          .run();
      }

      const weightedOutputs = recipeOutputs.map(recipeOutput => {
        const actual = outputByRecipeId.get(recipeOutput.id)!;
        return {
          recipeOutput,
          actual,
          allocationWeight: actual.allocationWeight ?? recipeOutput.allocationWeight,
        };
      });
      const allocatedCosts = allocateMoneyByWeights(
        totalInputCost,
        weightedOutputs.map(output => output.allocationWeight)
      );
      for (const [position, output] of weightedOutputs.entries()) {
        const product = productById.get(output.recipeOutput.productId)!;
        const allocatedCost = allocatedCosts[position]!;
        const unitCost = roundTransformationMoney(allocatedCost / output.actual.baseQuantity);
        const previousProductCost = product.cost;
        const previousProductInitialCost = product.initialCost;
        const resultingProductSyncVersion = (product.syncVersion ?? 0) + 1;
        const previousStock = stockState.get(product.id) ?? 0;
        const resultingProductCost =
          previousStock > QUANTITY_EPSILON
            ? roundTransformationMoney(
                (previousStock * previousProductCost + allocatedCost) /
                  (previousStock + output.actual.baseQuantity)
              )
            : unitCost;
        const resultingProductInitialCost =
          previousStock > QUANTITY_EPSILON
            ? roundTransformationMoney(
                (previousStock * previousProductInitialCost + allocatedCost) /
                  (previousStock + output.actual.baseQuantity)
              )
            : unitCost;

        let lotId: string | null = null;
        let lotNumberSnapshot: string | null = null;
        let expiresAtSnapshot: string | null = null;
        if (product.tracksLots) {
          if (!output.actual.lot) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'TRANSFORMATION_LOT_REQUIRED',
              message: 'Lot-tracked outputs require a new lot identity',
            });
          }
          const existingLot = tx
            .select({ id: inventoryLots.id })
            .from(inventoryLots)
            .where(
              and(
                eq(inventoryLots.tenantId, ctx.tenantId),
                eq(inventoryLots.siteId, input.siteId),
                eq(inventoryLots.productId, product.id),
                eq(inventoryLots.lotNumber, output.actual.lot.lotNumber)
              )
            )
            .get();
          if (existingLot) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'TRANSFORMATION_OUTPUT_LOT_EXISTS',
              message: 'Every transformed output batch requires a new lot number',
              details: { lotId: existingLot.id, lotNumber: output.actual.lot.lotNumber },
            });
          }
          const received = receiveInventoryLot(tx, {
            tenantId: ctx.tenantId,
            siteId: input.siteId,
            productId: product.id,
            lotNumber: output.actual.lot.lotNumber,
            expiresAt: output.actual.lot.expiresAt ?? null,
            quantity: output.actual.baseQuantity,
            unitCost,
            notes: output.actual.lot.notes ?? recipe.name,
            now,
          });
          if (!received.created) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'TRANSFORMATION_OUTPUT_LOT_EXISTS',
              message: 'Every transformed output batch requires a new lot number',
            });
          }
          lotId = received.lotId;
          lotNumberSnapshot = output.actual.lot.lotNumber;
          expiresAtSnapshot = output.actual.lot.expiresAt ?? null;
          mutatedLotIds.add(lotId);
        } else if (output.actual.lot) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFORMATION_LOT_NOT_ALLOWED',
            message: 'Non-lot outputs cannot include a lot identity',
          });
        }

        const costUpdate = tx
          .update(products)
          .set({
            cost: resultingProductCost,
            initialCost: resultingProductInitialCost,
            syncStatus: 'pending',
            syncVersion: resultingProductSyncVersion,
            updatedAt: now,
          })
          .where(
            and(
              eq(products.tenantId, ctx.tenantId),
              eq(products.id, product.id),
              eq(products.cost, previousProductCost),
              eq(products.initialCost, previousProductInitialCost),
              product.syncVersion === null
                ? isNull(products.syncVersion)
                : eq(products.syncVersion, product.syncVersion)
            )
          )
          .run();
        if (costUpdate.changes !== 1) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'TRANSFORMATION_COST_CHANGED',
            message: 'Product cost changed while the transformation was being recorded',
            details: { productId: product.id },
          });
        }

        resultingCostByProductId.set(product.id, {
          cost: resultingProductCost,
          initialCost: resultingProductInitialCost,
        });
        const resultingBalanceVersion = recordMovement(
          product.id,
          output.actual.baseQuantity,
          recipe.name
        );
        tx.insert(inventoryTransformationOutputs)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            transformationId,
            recipeOutputId: output.recipeOutput.id,
            productId: product.id,
            lotId,
            lotNumberSnapshot,
            expiresAtSnapshot,
            role: output.recipeOutput.role,
            baseQuantity: output.actual.baseQuantity,
            allocationWeight: output.allocationWeight,
            allocatedCost,
            unitCost,
            previousProductCost,
            previousProductInitialCost,
            resultingProductCost,
            resultingProductInitialCost,
            resultingProductSyncVersion,
            resultingBalanceVersion,
            createdAt: now,
          })
          .run();
      }

      tx.update(inventoryTransformations)
        .set({
          totalInputCost,
          totalOutputCost: totalInputCost,
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryTransformations.tenantId, ctx.tenantId),
            eq(inventoryTransformations.id, transformationId)
          )
        )
        .run();

      writeAuditLog({
        tx: txRaw,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'inventory.transformation.execute',
        resourceType: 'inventory_transformation',
        resourceId: transformationId,
        before: null,
        after: {
          status: 'completed',
          recipeId: recipe.id,
          recipeName: recipe.name,
          totalInputCost,
          totalOutputCost: totalInputCost,
        },
        metadata: {
          siteId: input.siteId,
          siteName: site.name,
          kind: recipe.kind,
          inputQuantity: input.inputs.reduce(
            (sum, line) => roundQuantity(sum + line.baseQuantity, 12),
            0
          ),
          outputQuantity: input.outputs.reduce(
            (sum, line) => roundQuantity(sum + line.baseQuantity, 12),
            0
          ),
          wasteQuantity: input.waste.reduce(
            (sum, line) => roundQuantity(sum + line.baseQuantity, 12),
            0
          ),
        },
        operationId: ctx.envelope.operationId,
      });

      const syncContext = { ...ctx, db: tx };
      const syncAggregate = getInventoryTransformationSyncAggregate(
        tx,
        ctx.tenantId,
        transformationId
      );
      if (!syncAggregate) {
        throw new Error('Committed inventory transformation aggregate is missing');
      }
      enqueueSyncInTransaction(syncContext, {
        entityType: 'inventory_transformations',
        entityId: transformationId,
        operation: 'create',
        data: syncAggregate,
      });
      for (const movementId of movementIds) {
        enqueueSyncInTransaction(syncContext, {
          entityType: 'inventory_movements',
          entityId: movementId,
          operation: 'create',
          data: { id: movementId, transformationId },
        });
      }
      for (const output of recipeOutputs) {
        const product = productById.get(output.productId)!;
        const resultingCosts = resultingCostByProductId.get(product.id)!;
        enqueueSyncInTransaction(syncContext, {
          entityType: 'products',
          entityId: product.id,
          operation: 'update',
          data: {
            id: product.id,
            cost: resultingCosts.cost,
            initialCost: resultingCosts.initialCost,
            transformationId,
          },
        });
      }
      enqueueInventoryLotSnapshotsInTransaction(syncContext, [...mutatedLotIds], {
        transformationId,
      });

      const result = getInventoryTransformationRecord(tx, ctx.tenantId, transformationId)!;
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
