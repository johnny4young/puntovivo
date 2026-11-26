/**
 * Retail combo/kit component management and transactional sale/return stock hooks.
 *
 * A bundle product declares 1+ physical component products in `product_bundle_components`.
 * On checkout, each sold bundle line atomically validates and deducts every component's
 * site inventory balance and snapshots the exact deducted quantities in
 * `sale_item_bundle_components` so returns and voids reverse what was actually consumed.
 */
import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import type { DatabaseInstance } from '../db/index.js';
import {
  inventoryBalances,
  inventoryMovements,
  productBundleComponents,
  products,
  saleItemBundleComponents,
  saleItems,
} from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import { QUANTITY_EPSILON } from '../lib/quantity.js';
import { writeAuditLog } from './audit-logs.js';
import { applyInventoryBalanceDelta, getProductStockTotals } from './inventory-balances.js';

export interface BundleComponentEntry {
  componentProductId: string;
  quantity: number;
}

export interface BundleComponentDetail {
  id: string;
  bundleProductId: string;
  componentProductId: string;
  componentName: string;
  componentSku: string;
  quantity: number;
  tracksStock: boolean;
  unitCost: number;
}

export function getBundleComponents(
  db: DatabaseInstance,
  tenantId: string,
  bundleProductId: string
): BundleComponentDetail[] {
  return db
    .select({
      id: productBundleComponents.id,
      bundleProductId: productBundleComponents.bundleProductId,
      componentProductId: productBundleComponents.componentProductId,
      componentName: products.name,
      componentSku: products.sku,
      quantity: productBundleComponents.quantity,
      tracksStock: products.tracksStock,
      unitCost: products.cost,
    })
    .from(productBundleComponents)
    .innerJoin(
      products,
      and(
        eq(products.id, productBundleComponents.componentProductId),
        eq(products.tenantId, tenantId)
      )
    )
    .where(
      and(
        eq(productBundleComponents.tenantId, tenantId),
        eq(productBundleComponents.bundleProductId, bundleProductId)
      )
    )
    .orderBy(asc(products.name), asc(productBundleComponents.id))
    .all();
}

export function setBundleComponents(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    actorId: string;
    bundleProductId: string;
    components: readonly BundleComponentEntry[];
  }
): BundleComponentDetail[] {
  const now = new Date().toISOString();
  db.transaction(
    tx => {
      const bundle = tx
        .select({
          id: products.id,
          name: products.name,
          catalogType: products.catalogType,
        })
        .from(products)
        .where(and(eq(products.tenantId, args.tenantId), eq(products.id, args.bundleProductId)))
        .get();
      if (!bundle || bundle.catalogType === 'variant_parent') {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bundle product not found',
        });
      }

      const seen = new Set<string>();
      for (const component of args.components) {
        if (component.componentProductId === args.bundleProductId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A bundle cannot include itself as a component',
          });
        }
        if (!(component.quantity > 0) || !Number.isFinite(component.quantity)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Component quantity must be positive',
          });
        }
        if (seen.has(component.componentProductId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Duplicate component product in bundle',
          });
        }
        seen.add(component.componentProductId);
      }

      const componentIds = [...seen];
      if (componentIds.length > 0) {
        // Prevent bundle chains (a product used as a component cannot itself hold components).
        const existingParent = tx
          .select({ id: productBundleComponents.id })
          .from(productBundleComponents)
          .where(
            and(
              eq(productBundleComponents.tenantId, args.tenantId),
              eq(productBundleComponents.componentProductId, args.bundleProductId)
            )
          )
          .get();
        if (existingParent) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A product used inside another bundle cannot define nested components',
          });
        }

        const nestedBundle = tx
          .select({ id: productBundleComponents.bundleProductId })
          .from(productBundleComponents)
          .where(
            and(
              eq(productBundleComponents.tenantId, args.tenantId),
              inArray(productBundleComponents.bundleProductId, componentIds)
            )
          )
          .get();
        if (nestedBundle) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Bundle components cannot themselves be bundles',
          });
        }

        const componentRows = tx
          .select({
            id: products.id,
            catalogType: products.catalogType,
            tracksLots: products.tracksLots,
            tracksSerials: products.tracksSerials,
          })
          .from(products)
          .where(and(eq(products.tenantId, args.tenantId), inArray(products.id, componentIds)))
          .all();
        if (componentRows.length !== componentIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'One or more bundle components do not belong to this business',
          });
        }
        for (const row of componentRows) {
          if (row.catalogType === 'variant_parent' || row.tracksLots || row.tracksSerials) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Bundle components must be standard stock products without lot or serial custody',
            });
          }
        }
      }

      const before = tx
        .select({
          componentProductId: productBundleComponents.componentProductId,
          quantity: productBundleComponents.quantity,
        })
        .from(productBundleComponents)
        .where(
          and(
            eq(productBundleComponents.tenantId, args.tenantId),
            eq(productBundleComponents.bundleProductId, args.bundleProductId)
          )
        )
        .all();

      tx.delete(productBundleComponents)
        .where(
          and(
            eq(productBundleComponents.tenantId, args.tenantId),
            eq(productBundleComponents.bundleProductId, args.bundleProductId)
          )
        )
        .run();

      for (const component of args.components) {
        tx.insert(productBundleComponents)
          .values({
            id: nanoid(),
            tenantId: args.tenantId,
            bundleProductId: args.bundleProductId,
            componentProductId: component.componentProductId,
            quantity: roundQuantity(component.quantity, 6),
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: 'product.update',
        resourceType: 'product',
        resourceId: args.bundleProductId,
        before: { bundleComponents: before },
        after: {
          bundleComponents: args.components.map(c => ({
            componentProductId: c.componentProductId,
            quantity: roundQuantity(c.quantity, 6),
          })),
        },
        metadata: { kind: 'bundle_components' },
      });
    },
    { behavior: 'immediate' }
  );

  return getBundleComponents(db, args.tenantId, args.bundleProductId);
}

/**
 * Inside a sale transaction, validate component availability, deduct each
 * component's site balance, emit inventory movements, and persist immutable
 * `sale_item_bundle_components` snapshots for exact return/void reversals.
 */
export function deductBundleComponentsInTransaction(args: {
  tx: DatabaseInstance;
  tenantId: string;
  siteId: string;
  saleId: string;
  saleNumber: string;
  siteName: string;
  userId: string;
  now: string;
  rows: ReadonlyArray<{
    id: string;
    productId: string;
    productName: string;
    normalizedQuantity: number;
  }>;
  productStockState: Map<string, number>;
}): string[] {
  const soldProductIds = [...new Set(args.rows.map(row => row.productId))];
  if (soldProductIds.length === 0) return [];

  const definitions = args.tx
    .select({
      bundleProductId: productBundleComponents.bundleProductId,
      componentProductId: productBundleComponents.componentProductId,
      quantity: productBundleComponents.quantity,
      componentName: products.name,
      tracksStock: products.tracksStock,
      unitCost: products.cost,
    })
    .from(productBundleComponents)
    .innerJoin(
      products,
      and(
        eq(products.id, productBundleComponents.componentProductId),
        eq(products.tenantId, args.tenantId)
      )
    )
    .where(
      and(
        eq(productBundleComponents.tenantId, args.tenantId),
        inArray(productBundleComponents.bundleProductId, soldProductIds)
      )
    )
    .orderBy(asc(productBundleComponents.bundleProductId), asc(productBundleComponents.id))
    .all();

  if (definitions.length === 0) return [];

  const defsByBundle = new Map<string, typeof definitions>();
  for (const def of definitions) {
    const list = defsByBundle.get(def.bundleProductId) ?? [];
    list.push(def);
    defsByBundle.set(def.bundleProductId, list);
  }

  // Aggregate total required stock per physical component at the active site.
  const requiredByComponent = new Map<string, { requested: number; name: string }>();
  for (const row of args.rows) {
    const comps = defsByBundle.get(row.productId);
    if (!comps) continue;
    for (const comp of comps) {
      if (!comp.tracksStock) continue;
      const qty = roundQuantity(comp.quantity * row.normalizedQuantity, 12);
      const prev = requiredByComponent.get(comp.componentProductId);
      requiredByComponent.set(comp.componentProductId, {
        requested: roundQuantity((prev?.requested ?? 0) + qty, 12),
        name: comp.componentName,
      });
    }
  }

  const componentIds = [...requiredByComponent.keys()];
  if (componentIds.length > 0) {
    const siteRows = args.tx
      .select({ productId: inventoryBalances.productId, onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, args.tenantId),
          eq(inventoryBalances.siteId, args.siteId),
          inArray(inventoryBalances.productId, componentIds)
        )
      )
      .all();
    const siteStock = new Map(siteRows.map(r => [r.productId, r.onHand] as const));
    for (const [componentId, req] of requiredByComponent) {
      const available = siteStock.get(componentId) ?? 0;
      if (available + QUANTITY_EPSILON < req.requested) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'SALE_INSUFFICIENT_STOCK',
          message: `Insufficient stock for bundle component "${req.name}" at the active site. Available: ${available}, requested: ${req.requested}`,
          details: { productName: req.name, available, requested: req.requested },
        });
      }
    }

    const missingTotals = componentIds.filter(id => !args.productStockState.has(id));
    if (missingTotals.length > 0) {
      const totals = getProductStockTotals(args.tx, args.tenantId, missingTotals);
      for (const id of missingTotals) {
        args.productStockState.set(id, totals.get(id) ?? 0);
      }
    }
  }

  const movementIds: string[] = [];
  for (const row of args.rows) {
    const comps = defsByBundle.get(row.productId);
    if (!comps) continue;
    for (const comp of comps) {
      const totalDeducted = roundQuantity(comp.quantity * row.normalizedQuantity, 12);
      args.tx
        .insert(saleItemBundleComponents)
        .values({
          id: nanoid(),
          tenantId: args.tenantId,
          saleItemId: row.id,
          componentProductId: comp.componentProductId,
          componentQuantityPerUnit: comp.quantity,
          totalQuantityDeducted: totalDeducted,
          unitCostAtSale: comp.unitCost,
          createdAt: args.now,
        })
        .run();

      if (!comp.tracksStock) continue;
      const previousStock = args.productStockState.get(comp.componentProductId) ?? 0;
      const newStock = roundQuantity(previousStock - totalDeducted, 12);
      args.productStockState.set(comp.componentProductId, newStock);

      const movementId = nanoid();
      args.tx
        .insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: args.tenantId,
          productId: comp.componentProductId,
          siteId: args.siteId,
          type: 'sale',
          quantity: totalDeducted,
          previousStock,
          newStock,
          reference: args.saleId,
          notes: `Bundle ${row.productName} · Sale ${args.saleNumber} · ${args.siteName}`,
          createdBy: args.userId,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: args.now,
        })
        .run();
      movementIds.push(movementId);

      applyInventoryBalanceDelta(args.tx, {
        tenantId: args.tenantId,
        siteId: args.siteId,
        productId: comp.componentProductId,
        delta: -totalDeducted,
        initialOnHandIfMissing: previousStock,
        now: args.now,
      });
    }
  }

  return movementIds;
}

const BUNDLE_REVERSAL_LABEL: Record<'return' | 'void' | 'discard', string> = {
  return: 'Refunded bundle sale',
  void: 'Voided bundle sale',
  discard: 'Discarded bundle draft',
};

/**
 * Restore bundle component stock proportionally for partial/full returns, voids,
 * and discarded drafts using the frozen `sale_item_bundle_components` snapshots.
 */
export function reverseBundleComponentsInTransaction(args: {
  tx: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  saleId: string;
  saleNumber: string;
  reversalKind: 'return' | 'void' | 'discard';
  userId: string;
  now: string;
  /** Either an explicit reversal fraction (1.0 for void/discard) or the returned base quantity. */
  itemFractions: ReadonlyArray<
    | { saleItemId: string; fraction: number; returnedBaseQuantity?: undefined }
    | { saleItemId: string; returnedBaseQuantity: number; fraction?: undefined }
  >;
  productStockState: Map<string, number>;
}): string[] {
  const saleItemIds = [...new Set(args.itemFractions.map(entry => entry.saleItemId))];
  if (saleItemIds.length === 0) return [];

  const snapshots = args.tx
    .select({
      saleItemId: saleItemBundleComponents.saleItemId,
      componentProductId: saleItemBundleComponents.componentProductId,
      totalQuantityDeducted: saleItemBundleComponents.totalQuantityDeducted,
      tracksStock: products.tracksStock,
      soldQuantity: saleItems.quantity,
      soldEquivalence: saleItems.unitEquivalence,
    })
    .from(saleItemBundleComponents)
    .innerJoin(
      products,
      and(
        eq(products.id, saleItemBundleComponents.componentProductId),
        eq(products.tenantId, args.tenantId)
      )
    )
    .innerJoin(saleItems, eq(saleItems.id, saleItemBundleComponents.saleItemId))
    .where(
      and(
        eq(saleItemBundleComponents.tenantId, args.tenantId),
        inArray(saleItemBundleComponents.saleItemId, saleItemIds)
      )
    )
    .all();

  if (snapshots.length === 0) return [];

  const entryByItem = new Map(args.itemFractions.map(entry => [entry.saleItemId, entry]));
  const compIds = [...new Set(snapshots.map(s => s.componentProductId))];
  const missing = compIds.filter(id => !args.productStockState.has(id));
  if (missing.length > 0) {
    const totals = getProductStockTotals(args.tx, args.tenantId, missing);
    for (const id of missing) args.productStockState.set(id, totals.get(id) ?? 0);
  }

  const movementIds: string[] = [];
  const note = `${BUNDLE_REVERSAL_LABEL[args.reversalKind]} ${args.saleNumber}`;
  for (const snap of snapshots) {
    if (!snap.tracksStock) continue;
    const entry = entryByItem.get(snap.saleItemId);
    if (!entry) continue;
    const soldBase = roundQuantity(snap.soldQuantity * (snap.soldEquivalence ?? 1), 12);
    const fraction =
      entry.fraction !== undefined
        ? entry.fraction
        : soldBase > 0
          ? Math.min(1, entry.returnedBaseQuantity / soldBase)
          : 0;
    if (!(fraction > 0)) continue;
    const restoreQty = roundQuantity(snap.totalQuantityDeducted * fraction, 12);
    if (!(restoreQty > 0)) continue;

    const previousStock = args.productStockState.get(snap.componentProductId) ?? 0;
    const newStock = roundQuantity(previousStock + restoreQty, 12);
    args.productStockState.set(snap.componentProductId, newStock);

    const movementId = nanoid();
    args.tx
      .insert(inventoryMovements)
      .values({
        id: movementId,
        tenantId: args.tenantId,
        productId: snap.componentProductId,
        siteId: args.siteId,
        type: 'return',
        quantity: restoreQty,
        previousStock,
        newStock,
        reference: args.saleId,
        notes: note,
        createdBy: args.userId,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: args.now,
      })
      .run();
    movementIds.push(movementId);

    applyInventoryBalanceDelta(args.tx, {
      tenantId: args.tenantId,
      siteId: args.siteId,
      productId: snap.componentProductId,
      delta: restoreQty,
      initialOnHandIfMissing: previousStock,
      serviceReversal: true,
      now: args.now,
    });
  }

  return movementIds;
}
