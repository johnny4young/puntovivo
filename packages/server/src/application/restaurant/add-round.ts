/**
 * Append a new round of items directly onto an existing open restaurant check.
 *
 * Keeps a table visit on one continuous check/draft instead of fragmenting each
 * subsequent round into a separate sale. Reserves stock (product, bundle, and
 * modifier BOM), updates the draft header + provisional payment, inserts the
 * next sequential `restaurant_rounds` row, and submits ONLY the new lines to
 * KDS and station thermal comandas — all in one immediate SQLite transaction.
 *
 * @module application/restaurant/add-round
 */
import { and, count, eq, inArray, isNotNull, max } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  inventoryMovements,
  restaurantCheckLines,
  restaurantChecks,
  restaurantCourses,
  restaurantDiners,
  restaurantLineModifiers,
  restaurantRounds,
  restaurantServices,
  restaurantTables,
  saleItemTaxComponents,
  saleItems,
  sales,
  sites,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  applyInventoryBalanceDelta,
  getProductStockTotals,
} from '../../services/inventory-balances.js';
import { toInventoryCents } from '../../services/inventory-valuation.js';
import {
  consumeLotsForSaleLine,
  enqueueInventoryLotUpdatesForSaleInTransaction,
} from '../../services/inventory-lots/index.js';
import { deductBundleComponentsInTransaction } from '../../services/product-bundles.js';
import { deductModifierBomInTransaction } from '../../services/restaurant/modifier-bom.js';
import { assignProductSerialsToSaleLine } from '../../services/product-serials.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { requireActiveCashSession } from '../../services/cash-session.js';
import { assertCashSessionStillOpen } from '../../services/cash-session/movements.js';
import { assertSalesNotExternallyBound } from '../external-orders/sale-binding.js';
import { submitKitchenSaleInTransaction } from '../kds/submit.js';
import { resolveSaleItems } from '../sales/item-resolution.js';
import {
  assertDraftHeaderMatchesLines,
  assertDraftSessionAtTableSite,
  readCashSessionSites,
  rebuildProvisionalDraftPayment,
} from '../sales/draft-split.js';
import type { CompleteSaleContext, CompleteSaleItemInput } from '../sales/types.js';
import { assertRestaurantModifierAuthority } from './modifier-catalog.js';
import { assertRestaurantModifierGroups } from './modifier-groups.js';
import {
  RESTAURANT_SERVICE_LIMITS,
  assertDineInStillActive,
  assertNoUnnormalizedRestaurantDrafts,
  findOpenService,
  restaurantModifierAmount,
  writePendingRound,
  type RestaurantDinerInput,
  type RestaurantOrderLineInput,
} from './service-lifecycle.js';

const RESTAURANT_COURSE_KEYS = ['starter', 'main', 'dessert', 'drink', 'other'] as const;

export interface AddRestaurantRoundItemInput extends CompleteSaleItemInput {
  dinerClientId?: string | null | undefined;
  courseKey: 'starter' | 'main' | 'dessert' | 'drink' | 'other';
  modifierGroups?: { id: string; version: number }[] | undefined;
  modifiers: RestaurantOrderLineInput['modifiers'];
}

export interface AddRestaurantRoundInput {
  tableId: string;
  checkId: string;
  expectedCheckVersion: number;
  roundLabel?: string | null | undefined;
  diners: RestaurantDinerInput[];
  items: AddRestaurantRoundItemInput[];
}

export interface AddRestaurantRoundResult {
  checkId: string;
  checkVersion: number;
  saleId: string;
  saleNumber: string;
  roundId: string;
  roundSequence: number;
  addedLineCount: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

export async function addRestaurantRound(
  ctx: CompleteSaleContext,
  input: AddRestaurantRoundInput,
  options?: { callerSiteId?: string | null | undefined }
): Promise<AddRestaurantRoundResult> {
  const { db, tenantId } = ctx;
  const callerSiteId =
    options && 'callerSiteId' in options ? options.callerSiteId : ctx.siteId || undefined;
  if (callerSiteId === null) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Restaurant table was not found at the active site',
    });
  }

  // Pre-transaction read: verify table, check, and resolve priced lines.
  const preTable = db
    .select({
      id: restaurantTables.id,
      siteId: restaurantTables.siteId,
      name: restaurantTables.name,
      isActive: restaurantTables.isActive,
    })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.id, input.tableId),
        eq(restaurantTables.tenantId, tenantId),
        ...(callerSiteId ? [eq(restaurantTables.siteId, callerSiteId)] : [])
      )
    )
    .get();
  if (!preTable || preTable.isActive === false) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Restaurant table was not found at the active site',
    });
  }

  const siteRow = db
    .select({ name: sites.name })
    .from(sites)
    .where(
      and(eq(sites.id, preTable.siteId), eq(sites.tenantId, tenantId), eq(sites.isActive, true))
    )
    .get();
  if (!siteRow) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Restaurant table site is not active',
    });
  }
  const siteName = siteRow.name;

  const activeCashSession = await requireActiveCashSession(
    db,
    tenantId,
    preTable.siteId,
    ctx.user.id
  );

  const preCheck = db
    .select({
      id: restaurantChecks.id,
      saleId: restaurantChecks.saleId,
      priceTier: sales.priceTier,
    })
    .from(restaurantChecks)
    .innerJoin(
      restaurantServices,
      and(
        eq(restaurantServices.id, restaurantChecks.serviceId),
        eq(restaurantServices.tenantId, tenantId),
        eq(restaurantServices.tableId, preTable.id),
        eq(restaurantServices.status, 'open')
      )
    )
    .innerJoin(sales, and(eq(sales.id, restaurantChecks.saleId), eq(sales.tenantId, tenantId)))
    .where(
      and(
        eq(restaurantChecks.id, input.checkId),
        eq(restaurantChecks.tenantId, tenantId),
        eq(restaurantChecks.status, 'open')
      )
    )
    .get();
  if (!preCheck) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SPLIT_STALE',
      message: 'The restaurant check is no longer open',
    });
  }

  const saleItemsInput: CompleteSaleItemInput[] = input.items.map(item => {
    const modAmount = restaurantModifierAmount(item.modifiers);
    return {
      productId: item.productId,
      unitId: item.unitId,
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice + modAmount),
      discount: item.discount,
      taxRate: item.taxRate,
      taxComponents: item.taxComponents,
      notes: item.notes,
      serialIds: item.serialIds,
      sourceQuotationItemId: item.sourceQuotationItemId,
      restaurantModifierAmount: modAmount,
    };
  });

  const priceTier = (
    preCheck.priceTier === 2 || preCheck.priceTier === 3 ? preCheck.priceTier : 1
  ) as 1 | 2 | 3;
  const resolvedItems = await resolveSaleItems(
    db,
    tenantId,
    preTable.siteId,
    saleItemsInput,
    priceTier
  );
  const businessClock = await resolveTenantBusinessClock(db, tenantId);
  const now = new Date().toISOString();

  return db.transaction(
    rawTx => {
      const tx = rawTx as unknown as DatabaseInstance;
      assertDineInStillActive(tx, tenantId);
      assertTenantBusinessClockCurrent(tx, tenantId, businessClock);

      const table = tx
        .select({
          id: restaurantTables.id,
          siteId: restaurantTables.siteId,
          name: restaurantTables.name,
          isActive: restaurantTables.isActive,
        })
        .from(restaurantTables)
        .where(
          and(
            eq(restaurantTables.id, input.tableId),
            eq(restaurantTables.tenantId, tenantId),
            eq(restaurantTables.siteId, preTable.siteId)
          )
        )
        .get();
      if (!table || table.isActive === false) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
          message: 'Restaurant table was not found at the active site',
        });
      }

      const service = findOpenService(tx, tenantId, table.id);
      if (!service) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SERVICE_NOT_OPEN',
          message: 'The table has no open service',
        });
      }
      if (service.siteId !== table.siteId) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
          message: 'Restaurant service site does not match its physical table',
        });
      }
      assertNoUnnormalizedRestaurantDrafts(tx, tenantId, table.id);

      const check = tx
        .select()
        .from(restaurantChecks)
        .where(
          and(
            eq(restaurantChecks.id, input.checkId),
            eq(restaurantChecks.tenantId, tenantId),
            eq(restaurantChecks.serviceId, service.id),
            eq(restaurantChecks.status, 'open')
          )
        )
        .get();
      if (!check || check.version !== input.expectedCheckVersion) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SPLIT_STALE',
          message: 'The restaurant check changed since it was last read',
        });
      }

      const sale = tx
        .select()
        .from(sales)
        .where(and(eq(sales.id, check.saleId), eq(sales.tenantId, tenantId)))
        .get();
      if (!sale || sale.status !== 'draft' || !sale.suspendedAt) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SPLIT_CHECK_IN_USE',
          message: 'This check is currently resumed on a register',
          details: { saleId: check.saleId },
        });
      }
      if (sale.tableId !== table.id) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
          message: 'Restaurant check sale is not parked at this table',
        });
      }
      assertSalesNotExternallyBound(tx, tenantId, [sale.id]);
      assertCashSessionStillOpen(tx, tenantId, activeCashSession.id);
      if (sale.cashSessionId) {
        const sessionSites = readCashSessionSites(tx, tenantId, [sale.cashSessionId]);
        assertDraftSessionAtTableSite(sessionSites.get(sale.cashSessionId), table.siteId);
      }

      // Check existing line arithmetic before mutating the draft header.
      const existingItems = tx
        .select({ total: saleItems.total })
        .from(saleItems)
        .where(eq(saleItems.saleId, sale.id))
        .all();
      assertDraftHeaderMatchesLines(sale, {
        count: existingItems.length,
        gross: existingItems.reduce((sum, item) => roundMoney(sum + item.total), 0),
      });

      const txContext = {
        tenantId,
        siteId: table.siteId,
        actorId: ctx.user.id,
        now,
        deviceId: ctx.deviceId,
        envelope: ctx.envelope,
      };
      const lineInputs: RestaurantOrderLineInput[] = input.items.map((item, itemIndex) => ({
        itemIndex,
        dinerClientId: item.dinerClientId,
        courseKey: item.courseKey,
        modifierGroups: item.modifierGroups,
        modifiers: item.modifiers,
      }));
      assertRestaurantModifierAuthority(tx, txContext, lineInputs);
      const modifierGroups = assertRestaurantModifierGroups(
        tx,
        txContext,
        input.items.map(item => ({
          productId: item.productId,
          modifierGroups: item.modifierGroups,
          modifiers: item.modifiers,
        }))
      );

      // Capacity guards matching openCheck + getTableState limits.
      const openLineCount =
        tx
          .select({ value: count() })
          .from(restaurantCheckLines)
          .innerJoin(
            restaurantChecks,
            and(
              eq(restaurantChecks.id, restaurantCheckLines.checkId),
              eq(restaurantChecks.tenantId, tenantId)
            )
          )
          .where(
            and(
              eq(restaurantCheckLines.tenantId, tenantId),
              eq(restaurantChecks.serviceId, service.id),
              eq(restaurantChecks.status, 'open')
            )
          )
          .get()?.value ?? 0;
      const openRoundCount =
        tx
          .select({ value: count() })
          .from(restaurantRounds)
          .innerJoin(
            restaurantChecks,
            and(
              eq(restaurantChecks.id, restaurantRounds.checkId),
              eq(restaurantChecks.tenantId, tenantId)
            )
          )
          .where(
            and(
              eq(restaurantRounds.tenantId, tenantId),
              eq(restaurantChecks.serviceId, service.id),
              eq(restaurantChecks.status, 'open')
            )
          )
          .get()?.value ?? 0;
      const openModifierCount =
        tx
          .select({ value: count() })
          .from(restaurantLineModifiers)
          .innerJoin(
            restaurantCheckLines,
            and(
              eq(restaurantCheckLines.id, restaurantLineModifiers.checkLineId),
              eq(restaurantCheckLines.tenantId, tenantId)
            )
          )
          .innerJoin(
            restaurantChecks,
            and(
              eq(restaurantChecks.id, restaurantCheckLines.checkId),
              eq(restaurantChecks.tenantId, tenantId)
            )
          )
          .where(
            and(
              eq(restaurantLineModifiers.tenantId, tenantId),
              eq(restaurantChecks.serviceId, service.id),
              eq(restaurantChecks.status, 'open')
            )
          )
          .get()?.value ?? 0;
      const addedModifierCount = input.items.reduce((sum, item) => sum + item.modifiers.length, 0);
      if (
        openLineCount + resolvedItems.rows.length > RESTAURANT_SERVICE_LIMITS.openLines ||
        openRoundCount + 1 > RESTAURANT_SERVICE_LIMITS.openRounds ||
        openModifierCount + addedModifierCount > RESTAURANT_SERVICE_LIMITS.openModifiers
      ) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
          message: 'Restaurant service reached its open line, round, or modifier projection limit',
        });
      }

      // Re-check site stock inside the writer lock so concurrent orders cannot oversell.
      const requiredStockByProduct = new Map<string, { requested: number; name: string }>();
      for (const row of resolvedItems.rows) {
        if (!row.tracksStock) continue;
        const prev = requiredStockByProduct.get(row.productId);
        requiredStockByProduct.set(row.productId, {
          requested: roundQuantity((prev?.requested ?? 0) + row.normalizedQuantity, 12),
          name: row.productName,
        });
      }
      const stockProductIds = [...requiredStockByProduct.keys()];
      if (stockProductIds.length > 0) {
        const balances = tx
          .select({ productId: inventoryBalances.productId, onHand: inventoryBalances.onHand })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, tenantId),
              eq(inventoryBalances.siteId, table.siteId),
              inArray(inventoryBalances.productId, stockProductIds)
            )
          )
          .all();
        const balanceMap = new Map(balances.map(b => [b.productId, b.onHand] as const));
        for (const [productId, req] of requiredStockByProduct) {
          const available = balanceMap.get(productId) ?? 0;
          if (available + QUANTITY_EPSILON < req.requested) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_INSUFFICIENT_STOCK',
              message: `Insufficient stock for "${req.name}" at the active site. Available: ${available}, requested: ${req.requested}`,
              details: { productName: req.name, available, requested: req.requested },
            });
          }
        }
      }

      const productStockState = getProductStockTotals(
        tx,
        tenantId,
        resolvedItems.rows.map(r => r.productId)
      );
      const consumedLotIds = new Set<string>();
      const saleCurrencyCode = sale.currencyCode ?? 'COP';

      for (const row of resolvedItems.rows) {
        tx.insert(saleItems)
          .values({
            id: row.id,
            saleId: sale.id,
            productId: row.productId,
            productNameSnapshot: row.productName,
            productSkuSnapshot: row.productSku,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            catalogUnitPrice1: row.catalogUnitPrices.price,
            catalogUnitPrice2: row.catalogUnitPrices.price2,
            catalogUnitPrice3: row.catalogUnitPrices.price3,
            unitId: row.unitId,
            unitEquivalence: row.unitEquivalence,
            discount: row.discount,
            manualDiscountRate: row.discount,
            taxRate: row.taxRate,
            taxKind: row.taxKind,
            unitStandardCode: row.unitStandardCode,
            taxAmount: row.taxAmount,
            costAtSale: row.costAtSale,
            total: row.total,
            currencyCode: saleCurrencyCode,
            exchangeRateAtSale: 1,
            settleCurrencyCode: null,
            notes: row.notes,
            restaurantModifierAmount: row.restaurantModifierAmount,
            tracksStockSnapshot: row.tracksStock,
          })
          .run();

        for (const component of row.taxComponents) {
          tx.insert(saleItemTaxComponents)
            .values({
              id: nanoid(),
              tenantId,
              saleItemId: row.id,
              componentKey: component.componentKey,
              vatRateId: component.vatRateId,
              taxKind: component.taxKind,
              taxRate: component.taxRate,
              taxableAmount: component.taxableAmount,
              taxAmount: component.taxAmount,
              position: component.position,
              createdAt: now,
            })
            .run();
        }

        let serialCost: number | null = null;
        if (row.tracksSerials) {
          serialCost = assignProductSerialsToSaleLine(tx, {
            tenantId,
            siteId: table.siteId,
            productId: row.productId,
            saleItemId: row.id,
            serialIds: row.serialIds,
            normalizedQuantity: row.normalizedQuantity,
            targetStatus: 'reserved',
            now,
            syncContext: { ...ctx, db: tx },
          });
        }

        if (!row.tracksStock) continue;

        const previousStock = productStockState.get(row.productId) ?? 0;
        const newStock = roundQuantity(previousStock - row.normalizedQuantity, 12);
        productStockState.set(row.productId, newStock);

        const movementId = nanoid();
        tx.insert(inventoryMovements)
          .values({
            id: movementId,
            tenantId,
            productId: row.productId,
            siteId: table.siteId,
            type: 'sale',
            quantity: row.normalizedQuantity,
            previousStock,
            newStock,
            reference: sale.id,
            notes: `Round · Sale ${sale.saleNumber} · ${siteName}`,
            createdBy: ctx.user.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();

        if (serialCost !== null) {
          tx.update(saleItems)
            .set({
              inventoryCostCents: toInventoryCents(serialCost),
              cogsCostCents: toInventoryCents(serialCost),
            })
            .where(eq(saleItems.id, row.id))
            .run();
          tx.update(inventoryMovements)
            .set({
              inventoryValueDeltaCents: toInventoryCents(-serialCost),
              cogsValueDeltaCents: toInventoryCents(-serialCost),
            })
            .where(
              and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.id, movementId))
            )
            .run();
        }

        applyInventoryBalanceDelta(tx, {
          tenantId,
          siteId: table.siteId,
          productId: row.productId,
          delta: -row.normalizedQuantity,
          onValueDelta: value => {
            if (!value) return;
            tx.update(saleItems)
              .set({
                inventoryCostCents: toInventoryCents(-value.inventoryValue),
                cogsCostCents: toInventoryCents(-value.cogsValue),
              })
              .where(eq(saleItems.id, row.id))
              .run();
            tx.update(inventoryMovements)
              .set({
                inventoryValueDeltaCents: toInventoryCents(value.inventoryValue),
                cogsValueDeltaCents: toInventoryCents(value.cogsValue),
              })
              .where(
                and(
                  eq(inventoryMovements.id, movementId),
                  eq(inventoryMovements.tenantId, tenantId)
                )
              )
              .run();
          },
          initialOnHandIfMissing: previousStock,
          serialAware: row.tracksSerials,
          now,
        });

        if (row.tracksLots) {
          const { selection, shortfall } = consumeLotsForSaleLine(tx, {
            tenantId,
            siteId: table.siteId,
            productId: row.productId,
            saleItemId: row.id,
            quantity: row.normalizedQuantity,
            now,
            businessDate: businessClock.businessDate,
          });
          tx.update(saleItems)
            .set({
              inventoryCostCents: toInventoryCents(selection.totalCost),
              cogsCostCents: toInventoryCents(selection.totalCost),
            })
            .where(eq(saleItems.id, row.id))
            .run();
          tx.update(inventoryMovements)
            .set({
              inventoryValueDeltaCents: toInventoryCents(-selection.totalCost),
              cogsValueDeltaCents: toInventoryCents(-selection.totalCost),
            })
            .where(
              and(eq(inventoryMovements.id, movementId), eq(inventoryMovements.tenantId, tenantId))
            )
            .run();
          for (const allocation of selection.allocations) consumedLotIds.add(allocation.lotId);
          if (shortfall > 0) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'LOT_STOCK_INCONSISTENT',
              message: 'Sellable lot stock does not cover the requested quantity',
            });
          }
        }
      }

      // Deduct dish combos/recipes (`product_bundle_components`) and modifier BOMs atomically.
      deductBundleComponentsInTransaction({
        tx,
        tenantId,
        siteId: table.siteId,
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        siteName,
        userId: ctx.user.id,
        now,
        rows: resolvedItems.rows,
        productStockState,
      });

      deductModifierBomInTransaction({
        tx,
        tenantId,
        siteId: table.siteId,
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        siteName,
        userId: ctx.user.id,
        now,
        lines: resolvedItems.rows.map((row, idx) => ({
          saleItemId: row.id,
          productName: row.productName,
          normalizedQuantity: row.normalizedQuantity,
          modifiers: input.items[idx]!.modifiers.map((mod, pos) => ({
            catalogId: mod.catalogId ?? null,
            groupKind: modifierGroups[idx]?.[pos]?.kind ?? null,
            name: mod.name,
            quantity: mod.quantity,
          })),
        })),
        productStockState,
      });

      // Resolve or create diners referenced by the new round.
      const existingDiners = tx
        .select()
        .from(restaurantDiners)
        .where(
          and(eq(restaurantDiners.tenantId, tenantId), eq(restaurantDiners.serviceId, service.id))
        )
        .all();
      const existingDinerBySeat = new Map(
        existingDiners.flatMap(d => (d.seatNumber != null ? ([[d.seatNumber, d]] as const) : []))
      );
      let activeDinerCount = existingDiners.filter(d => d.isActive).length;
      const dinerIdByClientId = new Map<string, string>();
      for (const diner of input.diners) {
        if (
          service.guestCount !== null &&
          diner.seatNumber != null &&
          diner.seatNumber > service.guestCount
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_DINER_INVALID',
            message: 'Diner seat exceeds the established guest count',
          });
        }
        const nextLabel = diner.label?.trim() || null;
        const existingDiner =
          diner.seatNumber == null ? undefined : existingDinerBySeat.get(diner.seatNumber);
        if (existingDiner) {
          if (existingDiner.label && nextLabel && existingDiner.label !== nextLabel) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_SERVICE_DINER_INVALID',
              message: 'Seated diner label conflicts with the existing diner on that seat',
            });
          }
          if (!existingDiner.isActive) {
            activeDinerCount += 1;
            if (activeDinerCount > RESTAURANT_SERVICE_LIMITS.activeDiners) {
              throwServerError({
                trpcCode: 'CONFLICT',
                errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
                message: 'Restaurant service reached its active diner limit',
              });
            }
            if (service.guestCount !== null && activeDinerCount > service.guestCount) {
              throwServerError({
                trpcCode: 'CONFLICT',
                errorCode: 'RESTAURANT_SERVICE_DINER_INVALID',
                message: 'Active diners exceed the established guest count',
              });
            }
            tx.update(restaurantDiners)
              .set({
                isActive: true,
                ...(nextLabel && !existingDiner.label ? { label: nextLabel } : {}),
                updatedAt: now,
              })
              .where(
                and(
                  eq(restaurantDiners.id, existingDiner.id),
                  eq(restaurantDiners.tenantId, tenantId)
                )
              )
              .run();
          }
          dinerIdByClientId.set(diner.clientId, existingDiner.id);
          continue;
        }
        activeDinerCount += 1;
        if (activeDinerCount > RESTAURANT_SERVICE_LIMITS.activeDiners) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
            message: 'Restaurant service reached its active diner limit',
          });
        }
        if (service.guestCount !== null && activeDinerCount > service.guestCount) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_DINER_INVALID',
            message: 'Active diners exceed the established guest count',
          });
        }
        const dinerId = nanoid();
        dinerIdByClientId.set(diner.clientId, dinerId);
        tx.insert(restaurantDiners)
          .values({
            id: dinerId,
            tenantId,
            serviceId: service.id,
            label: nextLabel,
            seatNumber: diner.seatNumber ?? null,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      // Reuse existing courses on this check or insert missing course keys.
      const existingCourses = tx
        .select()
        .from(restaurantCourses)
        .where(
          and(eq(restaurantCourses.tenantId, tenantId), eq(restaurantCourses.checkId, check.id))
        )
        .all();
      const courseIdByKey = new Map(existingCourses.map(c => [c.courseKey, c.id] as const));
      const usedPositions = new Set(existingCourses.map(c => c.position));
      for (const courseKey of RESTAURANT_COURSE_KEYS) {
        if (courseIdByKey.has(courseKey)) continue;
        if (!input.items.some(item => item.courseKey === courseKey)) continue;
        let position = RESTAURANT_COURSE_KEYS.indexOf(courseKey);
        while (usedPositions.has(position)) position = (position + 1) % 21;
        usedPositions.add(position);
        const courseId = nanoid();
        courseIdByKey.set(courseKey, courseId);
        tx.insert(restaurantCourses)
          .values({
            id: courseId,
            tenantId,
            checkId: check.id,
            courseKey,
            name: courseKey,
            position,
            createdAt: now,
          })
          .run();
      }

      // Append next sequential round onto the existing check.
      const maxSeqRow = tx
        .select({ maxSeq: max(restaurantRounds.sequence) })
        .from(restaurantRounds)
        .where(and(eq(restaurantRounds.tenantId, tenantId), eq(restaurantRounds.checkId, check.id)))
        .get();
      const roundSequence = (maxSeqRow?.maxSeq ?? 0) + 1;
      const roundId = nanoid();
      tx.insert(restaurantRounds)
        .values({
          id: roundId,
          tenantId,
          checkId: check.id,
          sequence: roundSequence,
          label: input.roundLabel?.trim() || `Ronda ${roundSequence}`,
          status: 'submitted',
          submittedBy: ctx.user.id,
          submittedAt: now,
          createdAt: now,
        })
        .run();

      for (const [idx, row] of resolvedItems.rows.entries()) {
        const item = input.items[idx]!;
        const dinerId = item.dinerClientId
          ? (dinerIdByClientId.get(item.dinerClientId) ?? null)
          : null;
        if (item.dinerClientId && !dinerId) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'RESTAURANT_SERVICE_DINER_INVALID',
            message: 'Order line references an unknown diner',
          });
        }
        const checkLineId = nanoid();
        tx.insert(restaurantCheckLines)
          .values({
            id: checkLineId,
            tenantId,
            checkId: check.id,
            saleItemId: row.id,
            roundId,
            courseId: courseIdByKey.get(item.courseKey) ?? null,
            dinerId,
            createdAt: now,
          })
          .run();
        for (const [position, modifier] of item.modifiers.entries()) {
          tx.insert(restaurantLineModifiers)
            .values({
              id: nanoid(),
              tenantId,
              checkLineId,
              catalogId: modifier.catalogId ?? null,
              catalogVersion: modifier.catalogVersion ?? null,
              groupId: modifierGroups[idx]?.[position]?.id ?? null,
              groupKind: modifierGroups[idx]?.[position]?.kind ?? null,
              name: modifier.name.trim(),
              quantity: modifier.quantity,
              unitPriceDelta: roundMoney(modifier.unitPriceDelta),
              position,
              createdAt: now,
            })
            .run();
        }
      }

      // Recalculate draft sale header totals and provisional tender.
      const nextSubtotal = roundMoney(sale.subtotal + resolvedItems.subtotal);
      const nextTaxAmount = roundMoney(sale.taxAmount + resolvedItems.taxAmount);
      const nextTotal = roundMoney(
        nextSubtotal +
          nextTaxAmount -
          sale.discountAmount +
          sale.tipAmount +
          sale.serviceChargeAmount
      );
      const nextSyncVersion = (sale.syncVersion ?? 0) + 1;
      const saleUpdated = tx
        .update(sales)
        .set({
          subtotal: nextSubtotal,
          taxAmount: nextTaxAmount,
          total: nextTotal,
          ...(sale.cashSessionId ? {} : { cashSessionId: activeCashSession.id }),
          paymentStatus: 'pending',
          syncStatus: 'pending',
          syncVersion: nextSyncVersion,
          updatedAt: now,
        })
        .where(
          and(
            eq(sales.id, sale.id),
            eq(sales.tenantId, tenantId),
            eq(sales.status, 'draft'),
            isNotNull(sales.suspendedAt)
          )
        )
        .run();
      if (saleUpdated.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SPLIT_CHECK_IN_USE',
          message: 'This check was resumed while the round was being added',
        });
      }
      rebuildProvisionalDraftPayment(tx, {
        tenantId,
        saleId: sale.id,
        method: sale.paymentMethod,
        amount: nextTotal,
        now,
      });

      const nextCheckVersion = check.version + 1;
      const checkUpdated = tx
        .update(restaurantChecks)
        .set({ version: nextCheckVersion, updatedAt: now })
        .where(
          and(
            eq(restaurantChecks.id, check.id),
            eq(restaurantChecks.tenantId, tenantId),
            eq(restaurantChecks.status, 'open'),
            eq(restaurantChecks.version, check.version)
          )
        )
        .run();
      if (checkUpdated.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SPLIT_STALE',
          message: 'Restaurant check changed while adding the round',
        });
      }

      if (service.pendingRounds?.[ctx.user.id]) {
        writePendingRound(tx, service, ctx.user.id, 0, new Date(now));
      }

      // Dispatch ONLY the newly inserted lines to KDS and station thermal comandas.
      submitKitchenSaleInTransaction(
        tx,
        { tenantId, siteId: table.siteId, actorId: ctx.user.id },
        sale.id
      );

      writeAuditLog({
        tx,
        tenantId,
        actorId: ctx.user.id,
        action: 'restaurant_check.round_added',
        resourceType: 'restaurant_check',
        resourceId: check.id,
        before: { version: check.version, total: sale.total },
        after: {
          version: nextCheckVersion,
          roundId,
          roundSequence,
          addedLineCount: resolvedItems.rows.length,
          total: nextTotal,
        },
        metadata: {
          saleId: sale.id,
          saleNumber: sale.saleNumber,
          tableId: table.id,
          tableName: table.name,
          siteId: table.siteId,
        },
      });

      const syncContext = {
        db: tx,
        tenantId,
        envelope: ctx.envelope ?? null,
        deviceId: ctx.deviceId ?? null,
      };
      enqueueSyncInTransaction(syncContext, {
        entityType: 'sales',
        entityId: sale.id,
        operation: 'update',
        data: {
          id: sale.id,
          saleNumber: sale.saleNumber,
          total: nextTotal,
          siteId: table.siteId,
          syncVersion: nextSyncVersion,
        },
      });
      if (consumedLotIds.size > 0) {
        enqueueInventoryLotUpdatesForSaleInTransaction(syncContext, [...consumedLotIds], sale.id);
      }

      const result: AddRestaurantRoundResult = {
        checkId: check.id,
        checkVersion: nextCheckVersion,
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        roundId,
        roundSequence,
        addedLineCount: resolvedItems.rows.length,
        subtotal: nextSubtotal,
        taxAmount: nextTaxAmount,
        total: nextTotal,
      };
      ctx.completeInTransaction?.(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
