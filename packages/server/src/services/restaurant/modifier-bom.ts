/**
 * Restaurant modifier BOM component management and transactional sale/return stock hooks.
 *
 * A modifier catalog entry can declare 1+ inventory ingredient products in
 * `restaurant_modifier_bom_components`. When ordered (excluding `without` removals),
 * each ingredient's site stock is deducted atomically and snapshotted in
 * `sale_item_modifier_bom_components` so discards, voids, and returns reverse exact usage.
 */
import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, sum } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  inventoryMovements,
  productBundleComponents,
  products,
  restaurantModifierBomComponents,
  restaurantModifierCatalog,
  saleItemModifierBomComponents,
  saleItems,
  saleReturnItems,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import { writeAuditLog } from '../audit-logs.js';
import { applyInventoryBalanceDelta, getProductStockTotals } from '../inventory-balances.js';
import {
  allocateInventoryValue,
  fromInventoryCents,
  toInventoryCents,
} from '../inventory-valuation.js';

export interface ModifierBomComponentEntry {
  componentProductId: string;
  quantity: number;
}

export interface ModifierBomComponentDetail {
  id: string;
  catalogId: string;
  componentProductId: string;
  componentName: string;
  componentSku: string;
  quantity: number;
  tracksStock: boolean;
  unitCost: number;
}

export function assertModifierBomInventoryPolicy(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    productId: string;
    nextTracksStock: boolean;
    nextTracksLots: boolean;
    nextTracksSerials: boolean;
  }
): void {
  if (!args.nextTracksStock || args.nextTracksLots || args.nextTracksSerials) {
    const usedInBom = db
      .select({ id: restaurantModifierBomComponents.id })
      .from(restaurantModifierBomComponents)
      .where(
        and(
          eq(restaurantModifierBomComponents.tenantId, args.tenantId),
          eq(restaurantModifierBomComponents.componentProductId, args.productId)
        )
      )
      .get();
    if (usedInBom) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'PRODUCT_BUNDLE_COMPONENT_CUSTODY',
        message:
          'A modifier recipe ingredient must remain a standard stock-tracked product without lot or serial custody',
        details: { productId: args.productId },
      });
    }
  }
}

export function getModifierBomComponents(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  catalogId: string
): ModifierBomComponentDetail[] {
  return db
    .select({
      id: restaurantModifierBomComponents.id,
      catalogId: restaurantModifierBomComponents.catalogId,
      componentProductId: restaurantModifierBomComponents.componentProductId,
      componentName: products.name,
      componentSku: products.sku,
      quantity: restaurantModifierBomComponents.quantity,
      tracksStock: products.tracksStock,
      unitCost: products.cost,
    })
    .from(restaurantModifierBomComponents)
    .innerJoin(
      restaurantModifierCatalog,
      and(
        eq(restaurantModifierCatalog.id, restaurantModifierBomComponents.catalogId),
        eq(restaurantModifierCatalog.tenantId, tenantId),
        eq(restaurantModifierCatalog.siteId, siteId)
      )
    )
    .innerJoin(
      products,
      and(
        eq(products.id, restaurantModifierBomComponents.componentProductId),
        eq(products.tenantId, tenantId)
      )
    )
    .where(
      and(
        eq(restaurantModifierBomComponents.tenantId, tenantId),
        eq(restaurantModifierBomComponents.catalogId, catalogId)
      )
    )
    .orderBy(asc(products.name), asc(restaurantModifierBomComponents.id))
    .all();
}

export function setModifierBomComponents(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    actorId: string;
    catalogId: string;
    components: readonly ModifierBomComponentEntry[];
  }
): ModifierBomComponentDetail[] {
  const now = new Date().toISOString();
  db.transaction(
    tx => {
      const catalog = tx
        .select({ id: restaurantModifierCatalog.id, name: restaurantModifierCatalog.name })
        .from(restaurantModifierCatalog)
        .where(
          and(
            eq(restaurantModifierCatalog.id, args.catalogId),
            eq(restaurantModifierCatalog.tenantId, args.tenantId),
            eq(restaurantModifierCatalog.siteId, args.siteId)
          )
        )
        .get();
      if (!catalog) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Restaurant modifier not found at this site',
        });
      }

      const seen = new Set<string>();
      for (const component of args.components) {
        if (!(component.quantity > 0) || !Number.isFinite(component.quantity)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Modifier ingredient quantity must be positive',
          });
        }
        if (seen.has(component.componentProductId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Duplicate ingredient product in modifier recipe',
          });
        }
        seen.add(component.componentProductId);
      }

      const componentIds = [...seen];
      if (componentIds.length > 0) {
        const componentRows = tx
          .select({
            id: products.id,
            catalogType: products.catalogType,
            tracksStock: products.tracksStock,
            tracksLots: products.tracksLots,
            tracksSerials: products.tracksSerials,
          })
          .from(products)
          .where(and(eq(products.tenantId, args.tenantId), inArray(products.id, componentIds)))
          .all();
        if (componentRows.length !== componentIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'One or more modifier ingredients do not belong to this business',
          });
        }
        const bundleParentIds = new Set(
          tx
            .select({ id: productBundleComponents.bundleProductId })
            .from(productBundleComponents)
            .where(
              and(
                eq(productBundleComponents.tenantId, args.tenantId),
                inArray(productBundleComponents.bundleProductId, componentIds)
              )
            )
            .all()
            .map(r => r.id)
        );
        for (const row of componentRows) {
          if (
            !row.tracksStock ||
            row.catalogType === 'variant_parent' ||
            row.tracksLots ||
            row.tracksSerials ||
            bundleParentIds.has(row.id)
          ) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Modifier ingredients must be standard stock products without lot, serial, or bundle custody',
            });
          }
        }
      }

      const before = tx
        .select({
          componentProductId: restaurantModifierBomComponents.componentProductId,
          quantity: restaurantModifierBomComponents.quantity,
        })
        .from(restaurantModifierBomComponents)
        .where(
          and(
            eq(restaurantModifierBomComponents.tenantId, args.tenantId),
            eq(restaurantModifierBomComponents.catalogId, args.catalogId)
          )
        )
        .all();

      tx.delete(restaurantModifierBomComponents)
        .where(
          and(
            eq(restaurantModifierBomComponents.tenantId, args.tenantId),
            eq(restaurantModifierBomComponents.catalogId, args.catalogId)
          )
        )
        .run();

      for (const component of args.components) {
        tx.insert(restaurantModifierBomComponents)
          .values({
            id: nanoid(),
            tenantId: args.tenantId,
            catalogId: args.catalogId,
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
        action: 'restaurant_modifier.bom_updated',
        resourceType: 'restaurant_modifier',
        resourceId: args.catalogId,
        before: { bomComponents: before },
        after: {
          bomComponents: args.components.map(c => ({
            componentProductId: c.componentProductId,
            quantity: roundQuantity(c.quantity, 6),
          })),
        },
        metadata: { siteId: args.siteId, modifierName: catalog.name },
      });
    },
    { behavior: 'immediate' }
  );

  return getModifierBomComponents(db, args.tenantId, args.siteId, args.catalogId);
}

export interface DeductModifierBomLine {
  saleItemId: string;
  productName: string;
  normalizedQuantity: number;
  modifiers: ReadonlyArray<{
    catalogId?: string | null | undefined;
    groupKind?: string | null | undefined;
    name: string;
    quantity: number;
  }>;
}

/**
 * Inside a sale or round transaction, deduct stock for all ordered modifiers that
 * carry a BOM recipe and persist immutable reversal snapshots.
 */
export function deductModifierBomInTransaction(args: {
  tx: DatabaseInstance;
  tenantId: string;
  siteId: string;
  saleId: string;
  saleNumber: string;
  siteName: string;
  userId: string;
  now: string;
  lines: readonly DeductModifierBomLine[];
  productStockState: Map<string, number>;
}): string[] {
  const catalogIds = [
    ...new Set(
      args.lines.flatMap(line =>
        line.modifiers.flatMap(mod =>
          mod.catalogId && mod.groupKind !== 'without' ? [mod.catalogId] : []
        )
      )
    ),
  ];
  if (catalogIds.length === 0) return [];

  const definitions = args.tx
    .select({
      catalogId: restaurantModifierBomComponents.catalogId,
      componentProductId: restaurantModifierBomComponents.componentProductId,
      quantity: restaurantModifierBomComponents.quantity,
      componentName: products.name,
      tracksStock: products.tracksStock,
      unitCost: products.cost,
    })
    .from(restaurantModifierBomComponents)
    .innerJoin(
      restaurantModifierCatalog,
      and(
        eq(restaurantModifierCatalog.id, restaurantModifierBomComponents.catalogId),
        eq(restaurantModifierCatalog.tenantId, args.tenantId),
        eq(restaurantModifierCatalog.siteId, args.siteId)
      )
    )
    .innerJoin(
      products,
      and(
        eq(products.id, restaurantModifierBomComponents.componentProductId),
        eq(products.tenantId, args.tenantId)
      )
    )
    .where(
      and(
        eq(restaurantModifierBomComponents.tenantId, args.tenantId),
        inArray(restaurantModifierBomComponents.catalogId, catalogIds)
      )
    )
    .orderBy(
      asc(restaurantModifierBomComponents.catalogId),
      asc(restaurantModifierBomComponents.id)
    )
    .all();

  if (definitions.length === 0) return [];

  const defsByCatalog = new Map<string, typeof definitions>();
  for (const def of definitions) {
    const list = defsByCatalog.get(def.catalogId) ?? [];
    list.push(def);
    defsByCatalog.set(def.catalogId, list);
  }

  const requiredByComponent = new Map<string, { requested: number; name: string }>();
  for (const line of args.lines) {
    for (const mod of line.modifiers) {
      if (!mod.catalogId || mod.groupKind === 'without') continue;
      const comps = defsByCatalog.get(mod.catalogId);
      if (!comps) continue;
      for (const comp of comps) {
        if (!comp.tracksStock) continue;
        const qty = roundQuantity(comp.quantity * mod.quantity * line.normalizedQuantity, 12);
        const prev = requiredByComponent.get(comp.componentProductId);
        requiredByComponent.set(comp.componentProductId, {
          requested: roundQuantity((prev?.requested ?? 0) + qty, 12),
          name: comp.componentName,
        });
      }
    }
  }

  const componentIds = [...requiredByComponent.keys()];
  if (componentIds.length === 0) return [];

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
        message: `Insufficient stock for modifier ingredient "${req.name}" at the active site. Available: ${available}, requested: ${req.requested}`,
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

  const movementIds: string[] = [];

  for (const line of args.lines) {
    for (const mod of line.modifiers) {
      if (!mod.catalogId || mod.groupKind === 'without') continue;
      const comps = defsByCatalog.get(mod.catalogId);
      if (!comps) continue;
      for (const comp of comps) {
        if (!comp.tracksStock) continue;
        const totalDeducted = roundQuantity(
          comp.quantity * mod.quantity * line.normalizedQuantity,
          12
        );
        const snapshotId = nanoid();
        args.tx
          .insert(saleItemModifierBomComponents)
          .values({
            id: snapshotId,
            tenantId: args.tenantId,
            saleItemId: line.saleItemId,
            catalogId: mod.catalogId,
            modifierName: mod.name,
            componentProductId: comp.componentProductId,
            componentQuantityPerModifier: comp.quantity,
            totalQuantityDeducted: totalDeducted,
            unitCostAtSale: comp.unitCost,
            createdAt: args.now,
          })
          .run();

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
            notes: `Modifier ${mod.name} (${line.productName}) · Sale ${args.saleNumber} · ${args.siteName}`,
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
          onValueDelta: value => {
            if (!value) return;
            const inventoryCents = toInventoryCents(-value.inventoryValue);
            const cogsCents = toInventoryCents(-value.cogsValue);
            args.tx
              .update(saleItemModifierBomComponents)
              .set({ inventoryCostCents: inventoryCents, cogsCostCents: cogsCents })
              .where(
                and(
                  eq(saleItemModifierBomComponents.id, snapshotId),
                  eq(saleItemModifierBomComponents.tenantId, args.tenantId)
                )
              )
              .run();
            args.tx
              .update(inventoryMovements)
              .set({
                inventoryValueDeltaCents: toInventoryCents(value.inventoryValue),
                cogsValueDeltaCents: toInventoryCents(value.cogsValue),
              })
              .where(
                and(
                  eq(inventoryMovements.id, movementId),
                  eq(inventoryMovements.tenantId, args.tenantId)
                )
              )
              .run();
          },
          initialOnHandIfMissing: previousStock,
          now: args.now,
        });
      }
    }
  }

  return movementIds;
}

const MODIFIER_REVERSAL_LABEL: Record<'return' | 'void' | 'discard', string> = {
  return: 'Refunded modifier BOM',
  void: 'Voided modifier BOM',
  discard: 'Discarded modifier BOM draft',
};

/**
 * Restore modifier BOM ingredient stock on returns, voids, and discarded drafts.
 */
export function reverseModifierBomInTransaction(args: {
  tx: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  saleId: string;
  saleNumber: string;
  reversalKind: 'return' | 'void' | 'discard';
  userId: string;
  now: string;
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
      saleItemId: saleItemModifierBomComponents.saleItemId,
      componentProductId: saleItemModifierBomComponents.componentProductId,
      totalQuantityDeducted: saleItemModifierBomComponents.totalQuantityDeducted,
      inventoryCostCents: saleItemModifierBomComponents.inventoryCostCents,
      cogsCostCents: saleItemModifierBomComponents.cogsCostCents,
      soldQuantity: saleItems.quantity,
      soldEquivalence: saleItems.unitEquivalence,
    })
    .from(saleItemModifierBomComponents)
    .innerJoin(
      products,
      and(
        eq(products.id, saleItemModifierBomComponents.componentProductId),
        eq(products.tenantId, args.tenantId)
      )
    )
    .innerJoin(saleItems, eq(saleItems.id, saleItemModifierBomComponents.saleItemId))
    .where(
      and(
        eq(saleItemModifierBomComponents.tenantId, args.tenantId),
        inArray(saleItemModifierBomComponents.saleItemId, saleItemIds)
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

  const returnedBaseByItem = new Map<string, number>();
  if (args.itemFractions.some(entry => entry.returnedBaseQuantity !== undefined)) {
    const rows = args.tx
      .select({
        saleItemId: saleReturnItems.saleItemId,
        returned: sum(saleReturnItems.baseQuantity),
      })
      .from(saleReturnItems)
      .where(
        and(
          eq(saleReturnItems.tenantId, args.tenantId),
          inArray(saleReturnItems.saleItemId, saleItemIds)
        )
      )
      .groupBy(saleReturnItems.saleItemId)
      .all();
    for (const row of rows) returnedBaseByItem.set(row.saleItemId, Number(row.returned ?? 0));
  }

  const movementIds: string[] = [];
  const note = `${MODIFIER_REVERSAL_LABEL[args.reversalKind]} ${args.saleNumber}`;
  for (const snap of snapshots) {
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

    let valueDelta: { inventoryValue: number; cogsValue: number } | undefined;
    if (snap.inventoryCostCents !== null && snap.cogsCostCents !== null) {
      const creditMoney = (centsValue: number): number => {
        const totalMoney = fromInventoryCents(centsValue);
        if (entry.returnedBaseQuantity !== undefined && soldBase > 0) {
          const returnedAfter = Math.min(
            soldBase,
            roundQuantity(returnedBaseByItem.get(snap.saleItemId) ?? 0, 12)
          );
          const returnedBefore = Math.max(
            0,
            roundQuantity(returnedAfter - entry.returnedBaseQuantity, 12)
          );
          const cumulativeAt = (qty: number): number =>
            qty <= 0
              ? 0
              : qty >= soldBase
                ? totalMoney
                : allocateInventoryValue(totalMoney, soldBase, qty).consumedValue;
          return roundMoney(cumulativeAt(returnedAfter) - cumulativeAt(returnedBefore));
        }
        if (fraction >= 1) return totalMoney;
        return fromInventoryCents(Math.round(centsValue * fraction));
      };
      valueDelta = {
        inventoryValue: creditMoney(snap.inventoryCostCents),
        cogsValue: creditMoney(snap.cogsCostCents),
      };
    }

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
      ...(valueDelta ? { valueDelta } : {}),
      onValueDelta: value => {
        if (!value) return;
        args.tx
          .update(inventoryMovements)
          .set({
            inventoryValueDeltaCents: toInventoryCents(value.inventoryValue),
            cogsValueDeltaCents: toInventoryCents(value.cogsValue),
          })
          .where(
            and(
              eq(inventoryMovements.id, movementId),
              eq(inventoryMovements.tenantId, args.tenantId)
            )
          )
          .run();
      },
      initialOnHandIfMissing: previousStock,
      serviceReversal: true,
      now: args.now,
    });
  }

  return movementIds;
}
