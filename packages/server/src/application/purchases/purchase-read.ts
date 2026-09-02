/**
 * Purchase read model — single-purchase record with items + returns.
 *
 * extracted verbatim from the former monolithic
 * `trpc/routers/purchases.ts` during the megafile decomposition (mirrors
 * `application/sales/sale-read.ts`). Used by the router's `getById` and by
 * every mutation use-case to return the canonical record.
 *
 * @module application/purchases/purchase-read
 */
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  inventoryLots,
  orders,
  products,
  productSerials,
  providers,
  purchaseItemLots,
  purchaseItems,
  purchaseReturnItemLots,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
  sites,
  units,
  users,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';

export function getPurchaseRecord(db: DatabaseInstance, tenantId: string, purchaseId: string) {
  const purchase = db
    .select({
      id: purchases.id,
      tenantId: purchases.tenantId,
      purchaseNumber: purchases.purchaseNumber,
      providerId: purchases.providerId,
      providerName: providers.name,
      orderId: purchases.orderId,
      sourceOrderNumber: orders.orderNumber,
      siteId: purchases.siteId,
      siteName: sites.name,
      status: purchases.status,
      subtotal: purchases.subtotal,
      total: purchases.total,
      notes: purchases.notes,
      createdBy: purchases.createdBy,
      syncStatus: purchases.syncStatus,
      syncVersion: purchases.syncVersion,
      createdAt: purchases.createdAt,
      updatedAt: purchases.updatedAt,
    })
    .from(purchases)
    .innerJoin(
      providers,
      and(eq(purchases.providerId, providers.id), eq(providers.tenantId, tenantId))
    )
    .leftJoin(orders, and(eq(purchases.orderId, orders.id), eq(orders.tenantId, tenantId)))
    .innerJoin(sites, and(eq(purchases.siteId, sites.id), eq(sites.tenantId, tenantId)))
    .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, tenantId)))
    .get();

  if (!purchase) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase not found' });
  }

  const items = db
    .select({
      id: purchaseItems.id,
      purchaseId: purchaseItems.purchaseId,
      productId: purchaseItems.productId,
      sourceOrderItemId: purchaseItems.sourceOrderItemId,
      productName: products.name,
      productSku: products.sku,
      catalogType: products.catalogType,
      tracksStock: products.tracksStock,
      tracksLots: products.tracksLots,
      tracksSerials: products.tracksSerials,
      quantity: purchaseItems.quantity,
      unitId: purchaseItems.unitId,
      unitEquivalence: purchaseItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      costPerUnit: purchaseItems.costPerUnit,
      baseUnitCost: purchaseItems.baseUnitCost,
      total: purchaseItems.total,
    })
    .from(purchaseItems)
    .innerJoin(
      products,
      and(eq(purchaseItems.productId, products.id), eq(products.tenantId, tenantId))
    )
    .innerJoin(units, and(eq(purchaseItems.unitId, units.id), eq(units.tenantId, tenantId)))
    .where(eq(purchaseItems.purchaseId, purchaseId))
    .all();
  const itemProductIds = [...new Set(items.map(item => item.productId))];

  const serialRows = items.length
    ? db
        .select({
          id: productSerials.id,
          sourcePurchaseItemId: productSerials.sourcePurchaseItemId,
          serialNumber: productSerials.serialNumber,
          status: productSerials.status,
          currentSiteId: productSerials.currentSiteId,
        })
        .from(productSerials)
        .innerJoin(
          purchaseItems,
          and(
            eq(productSerials.sourcePurchaseItemId, purchaseItems.id),
            eq(productSerials.productId, purchaseItems.productId)
          )
        )
        .where(
          and(
            eq(productSerials.tenantId, tenantId),
            inArray(
              productSerials.sourcePurchaseItemId,
              items.map(item => item.id)
            )
          )
        )
        .orderBy(asc(productSerials.serialNumber))
        .all()
    : [];

  // A purchase line's remaining entitlement and the quantity that can
  // physically leave the receiving site are different facts. Read the site
  // balances once for ordinary stock; lot and serial lines derive their
  // returnability from their exact frozen provenance below. This projection
  // is advisory only — the return command re-reads every mutable row inside
  // its write transaction before debiting stock.
  const siteBalanceRows = items.length
    ? db
        .select({
          productId: inventoryBalances.productId,
          onHand: inventoryBalances.onHand,
        })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.siteId, purchase.siteId),
            inArray(inventoryBalances.productId, itemProductIds)
          )
        )
        .all()
    : [];
  const siteOnHandByProductId = new Map(
    siteBalanceRows.map(balance => [balance.productId, balance.onHand])
  );

  const purchaseLotRows = items.length
    ? db
        .select({
          id: purchaseItemLots.id,
          purchaseItemId: purchaseItemLots.purchaseItemId,
          inventoryLotId: purchaseItemLots.inventoryLotId,
          lotNumber: purchaseItemLots.lotNumberSnapshot,
          expiresAt: purchaseItemLots.expiresAtSnapshot,
          baseQuantity: purchaseItemLots.baseQuantity,
          unitCost: purchaseItemLots.unitCost,
          currentProductId: inventoryLots.productId,
          currentSiteId: inventoryLots.siteId,
          currentLotNumber: inventoryLots.lotNumber,
          currentExpiresAt: inventoryLots.expiresAt,
          currentOnHand: inventoryLots.onHand,
          currentStatus: inventoryLots.status,
          currentUnitCost: inventoryLots.unitCost,
        })
        .from(purchaseItemLots)
        .innerJoin(
          inventoryLots,
          and(
            eq(purchaseItemLots.inventoryLotId, inventoryLots.id),
            eq(inventoryLots.tenantId, tenantId)
          )
        )
        .where(
          and(
            eq(purchaseItemLots.tenantId, tenantId),
            inArray(
              purchaseItemLots.purchaseItemId,
              items.map(item => item.id)
            )
          )
        )
        .orderBy(asc(purchaseItemLots.lotNumberSnapshot))
        .all()
    : [];

  const returns = db
    .select({
      id: purchaseReturns.id,
      purchaseId: purchaseReturns.purchaseId,
      returnAmount: purchaseReturns.returnAmount,
      reason: purchaseReturns.reason,
      createdBy: purchaseReturns.createdBy,
      createdByName: users.name,
      createdAt: purchaseReturns.createdAt,
      updatedAt: purchaseReturns.updatedAt,
    })
    .from(purchaseReturns)
    .leftJoin(users, and(eq(purchaseReturns.createdBy, users.id), eq(users.tenantId, tenantId)))
    .where(and(eq(purchaseReturns.tenantId, tenantId), eq(purchaseReturns.purchaseId, purchaseId)))
    .orderBy(desc(purchaseReturns.createdAt))
    .all();

  const returnItems = db
    .select({
      id: purchaseReturnItems.id,
      purchaseReturnId: purchaseReturnItems.purchaseReturnId,
      purchaseItemId: purchaseReturnItems.purchaseItemId,
      productId: purchaseReturnItems.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: purchaseReturnItems.quantity,
      unitId: purchaseReturnItems.unitId,
      unitEquivalence: purchaseReturnItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      costPerUnit: purchaseReturnItems.costPerUnit,
      baseUnitCost: purchaseReturnItems.baseUnitCost,
      total: purchaseReturnItems.total,
    })
    .from(purchaseReturnItems)
    .innerJoin(
      purchaseReturns,
      and(
        eq(purchaseReturnItems.purchaseReturnId, purchaseReturns.id),
        eq(purchaseReturns.tenantId, tenantId)
      )
    )
    .innerJoin(
      products,
      and(eq(purchaseReturnItems.productId, products.id), eq(products.tenantId, tenantId))
    )
    .innerJoin(units, and(eq(purchaseReturnItems.unitId, units.id), eq(units.tenantId, tenantId)))
    .where(and(eq(purchaseReturns.tenantId, tenantId), eq(purchaseReturns.purchaseId, purchaseId)))
    .all();

  const returnLotRows = returnItems.length
    ? db
        .select({
          id: purchaseReturnItemLots.id,
          purchaseReturnItemId: purchaseReturnItemLots.purchaseReturnItemId,
          purchaseItemLotId: purchaseReturnItemLots.purchaseItemLotId,
          inventoryLotId: purchaseReturnItemLots.inventoryLotId,
          lotNumber: purchaseItemLots.lotNumberSnapshot,
          expiresAt: purchaseItemLots.expiresAtSnapshot,
          baseQuantity: purchaseReturnItemLots.baseQuantity,
          unitCost: purchaseReturnItemLots.unitCost,
        })
        .from(purchaseReturnItemLots)
        .innerJoin(
          purchaseItemLots,
          and(
            eq(purchaseReturnItemLots.purchaseItemLotId, purchaseItemLots.id),
            eq(purchaseItemLots.tenantId, tenantId)
          )
        )
        .where(
          and(
            eq(purchaseReturnItemLots.tenantId, tenantId),
            inArray(
              purchaseReturnItemLots.purchaseReturnItemId,
              returnItems.map(item => item.id)
            )
          )
        )
        .all()
    : [];

  const returnedQuantityByItem = new Map<string, number>();
  const returnItemsByReturnId = new Map<string, typeof returnItems>();
  for (const item of returnItems) {
    returnedQuantityByItem.set(
      item.purchaseItemId,
      roundQuantity((returnedQuantityByItem.get(item.purchaseItemId) ?? 0) + item.quantity, 12)
    );
    const grouped = returnItemsByReturnId.get(item.purchaseReturnId) ?? [];
    grouped.push(item);
    returnItemsByReturnId.set(item.purchaseReturnId, grouped);
  }

  const returnedBaseQuantityByPurchaseLot = new Map<string, number>();
  const returnLotsByReturnItemId = new Map<string, typeof returnLotRows>();
  for (const row of returnLotRows) {
    returnedBaseQuantityByPurchaseLot.set(
      row.purchaseItemLotId,
      roundQuantity(
        (returnedBaseQuantityByPurchaseLot.get(row.purchaseItemLotId) ?? 0) + row.baseQuantity,
        12
      )
    );
    const grouped = returnLotsByReturnItemId.get(row.purchaseReturnItemId) ?? [];
    grouped.push(row);
    returnLotsByReturnItemId.set(row.purchaseReturnItemId, grouped);
  }

  const serialsByPurchaseItemId = new Map<string, typeof serialRows>();
  for (const serial of serialRows) {
    if (!serial.sourcePurchaseItemId) continue;
    const grouped = serialsByPurchaseItemId.get(serial.sourcePurchaseItemId) ?? [];
    grouped.push(serial);
    serialsByPurchaseItemId.set(serial.sourcePurchaseItemId, grouped);
  }
  const lotsByPurchaseItemId = new Map<string, typeof purchaseLotRows>();
  for (const lot of purchaseLotRows) {
    const grouped = lotsByPurchaseItemId.get(lot.purchaseItemId) ?? [];
    grouped.push(lot);
    lotsByPurchaseItemId.set(lot.purchaseItemId, grouped);
  }

  const returnsWithItems = returns.map(returnRecord => ({
    ...returnRecord,
    items: (returnItemsByReturnId.get(returnRecord.id) ?? []).map(item => ({
      ...item,
      lots: returnLotsByReturnItemId.get(item.id) ?? [],
    })),
  }));

  const returnedAmount = returns.reduce(
    (sum, returnRecord) => roundMoney(sum + returnRecord.returnAmount),
    0
  );
  const returnedAt = returns[0]?.createdAt ?? null;
  const latestReturnReason = returns[0]?.reason ?? null;
  const latestReturnCreatedByName = returns[0]?.createdByName ?? null;

  return {
    ...purchase,
    returnedAmount,
    returnedAt,
    latestReturnReason,
    latestReturnCreatedByName,
    returnCount: returns.length,
    returns: returnsWithItems,
    items: items.map(item => {
      const { catalogType, tracksStock, ...publicItem } = item;
      const returnedQuantity = returnedQuantityByItem.get(item.id) ?? 0;
      const remainingQuantity = Math.max(0, roundQuantity(item.quantity - returnedQuantity, 12));
      const serials = serialsByPurchaseItemId.get(item.id) ?? [];
      const rawLots = (lotsByPurchaseItemId.get(item.id) ?? []).map(lot => {
        const {
          currentProductId,
          currentSiteId,
          currentLotNumber,
          currentExpiresAt,
          currentUnitCost,
          ...publicLot
        } = lot;
        const returnedBaseQuantity = returnedBaseQuantityByPurchaseLot.get(lot.id) ?? 0;
        const remainingBaseQuantity = Math.max(
          0,
          roundQuantity(lot.baseQuantity - returnedBaseQuantity, 12)
        );
        const currentIdentityMatchesReceipt =
          currentProductId === item.productId &&
          currentSiteId === purchase.siteId &&
          currentLotNumber === lot.lotNumber &&
          currentExpiresAt === lot.expiresAt &&
          roundMoney(currentUnitCost) === roundMoney(lot.unitCost);
        return {
          ...publicLot,
          returnedBaseQuantity,
          remainingBaseQuantity,
          availableBaseQuantity: roundQuantity(
            currentIdentityMatchesReceipt
              ? Math.max(0, Math.min(remainingBaseQuantity, lot.currentOnHand))
              : 0,
            12
          ),
        };
      });
      const trackingMatchesProvenance =
        (item.tracksLots || rawLots.length === 0) && (item.tracksSerials || serials.length === 0);
      const siteOnHandBaseQuantity = Math.max(0, siteOnHandByProductId.get(item.productId) ?? 0);
      const provenanceReturnableBaseQuantity = !trackingMatchesProvenance
        ? 0
        : item.tracksSerials
          ? serials.filter(
              serial =>
                serial.currentSiteId === purchase.siteId &&
                (serial.status === 'in_stock' || serial.status === 'returned')
            ).length
          : item.tracksLots
            ? rawLots.reduce((sum, lot) => roundQuantity(sum + lot.availableBaseQuantity, 12), 0)
            : Math.max(0, siteOnHandByProductId.get(item.productId) ?? 0);
      const physicallyReturnableBaseQuantity = Math.min(
        siteOnHandBaseQuantity,
        provenanceReturnableBaseQuantity
      );
      const lineRemainingBaseQuantity = Math.max(
        0,
        roundQuantity(remainingQuantity * item.unitEquivalence, 12)
      );
      const returnableBaseQuantity =
        tracksStock &&
        catalogType !== 'variant_parent' &&
        trackingMatchesProvenance &&
        item.unitEquivalence > 0 &&
        (purchase.status === 'completed' || purchase.status === 'partial_returned')
          ? Math.max(0, Math.min(lineRemainingBaseQuantity, physicallyReturnableBaseQuantity))
          : 0;
      const returnableQuantity =
        item.unitEquivalence > 0
          ? Math.max(0, roundQuantity(returnableBaseQuantity / item.unitEquivalence, 12))
          : 0;

      // Lot chips and allocation controls claim "available to return", so
      // they must reconcile to the same fail-closed line projection. Cap the
      // stable lot order by the aggregate site/entitlement budget; otherwise a
      // voided purchase or a corrupted balance could show positive lot options
      // beside a zero returnable line.
      let remainingLotBudget = item.tracksLots ? returnableBaseQuantity : 0;
      const lots = rawLots.map(lot => {
        const availableBaseQuantity = roundQuantity(
          Math.max(0, Math.min(lot.availableBaseQuantity, remainingLotBudget)),
          12
        );
        remainingLotBudget = Math.max(
          0,
          roundQuantity(remainingLotBudget - availableBaseQuantity, 12)
        );
        return { ...lot, availableBaseQuantity };
      });
      return {
        ...publicItem,
        serials,
        lots,
        returnedQuantity,
        remainingQuantity,
        returnableQuantity,
      };
    }),
  };
}
