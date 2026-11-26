/**
 * Equal split (`Total / N`) and shared-dish fractional split for restaurant checks.
 *
 * Accessible to waiters/cashiers as well as managers/admins. Splits open draft
 * lines fractionally with exact cent conservation (`allocateCentsByWeights`),
 * proportional tax/bundle/modifier-BOM snapshot splitting, and KDS dispatch
 * fencing (`route: 'exclude'` on newly minted fractional pieces) so already
 * cooked dishes are never re-fired to the kitchen.
 *
 * @module application/restaurant/split-equal
 */
import { and, asc, count, eq, inArray, isNotNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { RESTAURANT_REGROUP_MAX_ACCOUNTS } from '@puntovivo/shared/restaurant-split';
import type { DatabaseInstance } from '../../db/index.js';
import {
  kdsLineDispatches,
  restaurantCheckLines,
  restaurantChecks,
  restaurantCourses,
  restaurantLineModifiers,
  restaurantRounds,
  restaurantTables,
  saleItemBundleComponents,
  saleItemLots,
  saleItemModifierBomComponents,
  saleItemSerials,
  saleItemTaxComponents,
  saleItems,
  sales,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { allocateCentsByWeights, roundMoney, tryMoneyToSafeCents } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { assertSalesNotExternallyBound } from '../external-orders/sale-binding.js';
import { adoptLegacyKitchenSale } from '../kds/legacy.js';
import { reconcileKitchenSaleInTransaction } from '../kds/sale-lifecycle.js';
import {
  assertDraftHeaderMatchesLines,
  assertDraftSessionAtTableSite,
  assertDraftTenderDivisible,
  insertSuspendedChildDraft,
  invalidDraftSplit,
  readCashSessionSites,
  rebuildProvisionalDraftPayment,
  requireActiveSaleSequential,
  type DraftSplitTransaction,
} from '../sales/draft-split.js';
import {
  assertDineInStillActive,
  assertNoUnnormalizedRestaurantDrafts,
  cloneRestaurantCourse,
  cloneRestaurantRound,
  findOpenService,
} from './service-lifecycle.js';
import type { RegroupCheckView } from './regroup-checks.js';

export interface SplitChecksSummaryResult {
  checks: Array<{
    checkId: string;
    saleId: string;
    saleNumber: string;
    label: string | null;
    total: number;
    version: number;
  }>;
}

interface SplitContext {
  tenantId: string;
  callerSiteId: string | null | undefined;
  actorId: string;
  now: string;
  envelope?: { operationId: string; idempotencyKey?: string } | null | undefined;
  deviceId?: string | null | undefined;
}

function toCents(value: number): number {
  return (
    tryMoneyToSafeCents(value) ??
    invalidDraftSplit('A draft amount is outside the exact supported cent range')
  );
}

const fromCents = (cents: number): number => roundMoney(cents / 100);

function allocateIntegerEvenly(total: number, parts: number): number[] {
  const base = Math.trunc(total / parts);
  let remainder = total - base * parts;
  return Array.from({ length: parts }, () => {
    if (remainder > 0) {
      remainder -= 1;
      return base + 1;
    }
    if (remainder < 0) {
      remainder += 1;
      return base - 1;
    }
    return base;
  });
}

function allocateQuantityEvenly(totalQty: number, parts: number): number[] {
  const scaled = Math.round(totalQty * 1_000_000);
  const shares = allocateIntegerEvenly(scaled, parts);
  if (shares.some(v => v <= 0)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'RESTAURANT_SERVICE_LINES_INVALID',
      message: 'Quantity is too small to split into the requested number of shares',
    });
  }
  return shares.map(v => roundQuantity(v / 1_000_000, 6));
}

function assertLinesNotLotOrSerialTracked(
  tx: DatabaseInstance,
  saleItemIds: readonly string[]
): void {
  if (saleItemIds.length === 0) return;
  const lotRow = tx
    .select({ id: saleItemLots.id })
    .from(saleItemLots)
    .where(inArray(saleItemLots.saleItemId, [...saleItemIds]))
    .limit(1)
    .get();
  const serialRow = tx
    .select({ id: saleItemSerials.id })
    .from(saleItemSerials)
    .where(inArray(saleItemSerials.saleItemId, [...saleItemIds]))
    .limit(1)
    .get();
  if (lotRow || serialRow) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_SPLIT_INVALID_STATUS',
      message: 'Lot- or serial-tracked items cannot be split fractionally across checks',
    });
  }
}

interface TargetCheckHandle {
  checkId: string;
  saleId: string;
  saleNumber: string;
  label: string | null;
  version: number;
  created: boolean;
}

/**
 * Fractionally split one `sale_items` row (plus its tax, bundle, modifier-BOM,
 * and restaurant metadata snapshots) across `targets` (targets[0] keeps the
 * mutated source `sale_items.id`; targets[1..] receive newly minted fractional
 * rows fenced from KDS re-dispatch).
 */
function splitOneSaleItemAcrossTargets(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    now: string;
    sourceItem: typeof saleItems.$inferSelect;
    sourceCheckLine: typeof restaurantCheckLines.$inferSelect;
    targets: readonly TargetCheckHandle[];
  }
): void {
  const parts = args.targets.length;
  const weights = Array.from({ length: parts }, () => 1);

  const quantities = allocateQuantityEvenly(args.sourceItem.quantity, parts);
  const totalCents = allocateCentsByWeights(toCents(args.sourceItem.total), weights);
  const taxCents = allocateCentsByWeights(toCents(args.sourceItem.taxAmount), weights);
  if (!totalCents || !taxCents) {
    invalidDraftSplit('Line totals could not be allocated evenly');
  }
  const invCostShares =
    args.sourceItem.inventoryCostCents !== null
      ? allocateIntegerEvenly(args.sourceItem.inventoryCostCents, parts)
      : null;
  const cogsCostShares =
    args.sourceItem.cogsCostCents !== null
      ? allocateIntegerEvenly(args.sourceItem.cogsCostCents, parts)
      : null;

  const taxComponents = tx
    .select()
    .from(saleItemTaxComponents)
    .where(
      and(
        eq(saleItemTaxComponents.tenantId, args.tenantId),
        eq(saleItemTaxComponents.saleItemId, args.sourceItem.id)
      )
    )
    .orderBy(asc(saleItemTaxComponents.position))
    .all();

  const bundleSnapshots = tx
    .select()
    .from(saleItemBundleComponents)
    .where(
      and(
        eq(saleItemBundleComponents.tenantId, args.tenantId),
        eq(saleItemBundleComponents.saleItemId, args.sourceItem.id)
      )
    )
    .all();

  const modifierBomSnapshots = tx
    .select()
    .from(saleItemModifierBomComponents)
    .where(
      and(
        eq(saleItemModifierBomComponents.tenantId, args.tenantId),
        eq(saleItemModifierBomComponents.saleItemId, args.sourceItem.id)
      )
    )
    .all();

  const lineModifiers = tx
    .select()
    .from(restaurantLineModifiers)
    .where(
      and(
        eq(restaurantLineModifiers.tenantId, args.tenantId),
        eq(restaurantLineModifiers.checkLineId, args.sourceCheckLine.id)
      )
    )
    .orderBy(asc(restaurantLineModifiers.position))
    .all();

  const sourceRound = args.sourceCheckLine.roundId
    ? tx
        .select()
        .from(restaurantRounds)
        .where(
          and(
            eq(restaurantRounds.id, args.sourceCheckLine.roundId),
            eq(restaurantRounds.tenantId, args.tenantId)
          )
        )
        .get()
    : undefined;
  const sourceCourse = args.sourceCheckLine.courseId
    ? tx
        .select()
        .from(restaurantCourses)
        .where(
          and(
            eq(restaurantCourses.id, args.sourceCheckLine.courseId),
            eq(restaurantCourses.tenantId, args.tenantId)
          )
        )
        .get()
    : undefined;

  const ensureRoundOnTarget = (targetCheckId: string): string | null => {
    if (!sourceRound) return null;
    if (targetCheckId === args.sourceCheckLine.checkId) return sourceRound.id;
    const existing = tx
      .select()
      .from(restaurantRounds)
      .where(
        and(
          eq(restaurantRounds.tenantId, args.tenantId),
          eq(restaurantRounds.checkId, targetCheckId)
        )
      )
      .all();
    const reused = existing.find(
      r => r.submittedAt === sourceRound.submittedAt && r.submittedBy === sourceRound.submittedBy
    );
    if (reused) return reused.id;
    const taken = new Set(existing.map(r => r.sequence));
    const seq = taken.has(sourceRound.sequence) ? Math.max(...taken) + 1 : sourceRound.sequence;
    return cloneRestaurantRound(tx, sourceRound, targetCheckId, args.now, seq).id;
  };

  const ensureCourseOnTarget = (targetCheckId: string): string | null => {
    if (!sourceCourse) return null;
    if (targetCheckId === args.sourceCheckLine.checkId) return sourceCourse.id;
    const existing = tx
      .select()
      .from(restaurantCourses)
      .where(
        and(
          eq(restaurantCourses.tenantId, args.tenantId),
          eq(restaurantCourses.checkId, targetCheckId)
        )
      )
      .all();
    const reused = existing.find(c => c.courseKey === sourceCourse.courseKey);
    if (reused) return reused.id;
    const taken = new Set(existing.map(c => c.position));
    let pos = sourceCourse.position;
    while (taken.has(pos)) pos = (pos + 1) % 21;
    return cloneRestaurantCourse(tx, sourceCourse, targetCheckId, args.now, pos).id;
  };

  // Update index 0 in place (preserves KDS sourceSaleItemId identity).
  const firstTarget = args.targets[0]!;
  tx.update(saleItems)
    .set({
      saleId: firstTarget.saleId,
      quantity: quantities[0]!,
      total: fromCents(totalCents[0]!),
      taxAmount: fromCents(taxCents[0]!),
      ...(invCostShares ? { inventoryCostCents: invCostShares[0]! } : {}),
      ...(cogsCostShares ? { cogsCostCents: cogsCostShares[0]! } : {}),
    })
    .where(eq(saleItems.id, args.sourceItem.id))
    .run();

  if (firstTarget.checkId !== args.sourceCheckLine.checkId) {
    tx.update(restaurantCheckLines)
      .set({
        checkId: firstTarget.checkId,
        roundId: ensureRoundOnTarget(firstTarget.checkId),
        courseId: ensureCourseOnTarget(firstTarget.checkId),
      })
      .where(eq(restaurantCheckLines.id, args.sourceCheckLine.id))
      .run();
  }

  // Re-allocate tax, bundle, and modifier-BOM snapshots across all targets.
  const taxComponentAllocations = taxComponents.map(comp => ({
    comp,
    taxable: allocateCentsByWeights(toCents(comp.taxableAmount), weights)!,
    tax: allocateCentsByWeights(toCents(comp.taxAmount), weights)!,
  }));
  const bundleAllocations = bundleSnapshots.map(snap => ({
    snap,
    qty: allocateQuantityEvenly(snap.totalQuantityDeducted, parts),
    inv:
      snap.inventoryCostCents !== null
        ? allocateIntegerEvenly(snap.inventoryCostCents, parts)
        : null,
    cogs: snap.cogsCostCents !== null ? allocateIntegerEvenly(snap.cogsCostCents, parts) : null,
  }));
  const modBomAllocations = modifierBomSnapshots.map(snap => ({
    snap,
    qty: allocateQuantityEvenly(snap.totalQuantityDeducted, parts),
    inv:
      snap.inventoryCostCents !== null
        ? allocateIntegerEvenly(snap.inventoryCostCents, parts)
        : null,
    cogs: snap.cogsCostCents !== null ? allocateIntegerEvenly(snap.cogsCostCents, parts) : null,
  }));

  for (const alloc of taxComponentAllocations) {
    tx.update(saleItemTaxComponents)
      .set({
        taxableAmount: fromCents(alloc.taxable[0]!),
        taxAmount: fromCents(alloc.tax[0]!),
      })
      .where(eq(saleItemTaxComponents.id, alloc.comp.id))
      .run();
  }
  for (const alloc of bundleAllocations) {
    tx.update(saleItemBundleComponents)
      .set({
        totalQuantityDeducted: alloc.qty[0]!,
        ...(alloc.inv ? { inventoryCostCents: alloc.inv[0]! } : {}),
        ...(alloc.cogs ? { cogsCostCents: alloc.cogs[0]! } : {}),
      })
      .where(eq(saleItemBundleComponents.id, alloc.snap.id))
      .run();
  }
  for (const alloc of modBomAllocations) {
    tx.update(saleItemModifierBomComponents)
      .set({
        totalQuantityDeducted: alloc.qty[0]!,
        ...(alloc.inv ? { inventoryCostCents: alloc.inv[0]! } : {}),
        ...(alloc.cogs ? { cogsCostCents: alloc.cogs[0]! } : {}),
      })
      .where(eq(saleItemModifierBomComponents.id, alloc.snap.id))
      .run();
  }

  // Insert cloned fractional lines for targets[1..parts-1].
  for (let i = 1; i < parts; i += 1) {
    const target = args.targets[i]!;
    const newSaleItemId = nanoid();
    tx.insert(saleItems)
      .values({
        ...args.sourceItem,
        id: newSaleItemId,
        saleId: target.saleId,
        quantity: quantities[i]!,
        total: fromCents(totalCents[i]!),
        taxAmount: fromCents(taxCents[i]!),
        inventoryCostCents: invCostShares ? invCostShares[i]! : args.sourceItem.inventoryCostCents,
        cogsCostCents: cogsCostShares ? cogsCostShares[i]! : args.sourceItem.cogsCostCents,
      })
      .run();

    // Prevent KDS from re-dispatching an already-submitted shared dish piece.
    tx.insert(kdsLineDispatches)
      .values({
        id: nanoid(),
        tenantId: args.tenantId,
        siteId: args.siteId,
        sourceSaleItemId: newSaleItemId,
        route: 'exclude',
        createdAt: args.now,
      })
      .run();

    for (const alloc of taxComponentAllocations) {
      tx.insert(saleItemTaxComponents)
        .values({
          ...alloc.comp,
          id: nanoid(),
          saleItemId: newSaleItemId,
          taxableAmount: fromCents(alloc.taxable[i]!),
          taxAmount: fromCents(alloc.tax[i]!),
          createdAt: args.now,
        })
        .run();
    }
    for (const alloc of bundleAllocations) {
      tx.insert(saleItemBundleComponents)
        .values({
          ...alloc.snap,
          id: nanoid(),
          saleItemId: newSaleItemId,
          totalQuantityDeducted: alloc.qty[i]!,
          inventoryCostCents: alloc.inv ? alloc.inv[i]! : alloc.snap.inventoryCostCents,
          cogsCostCents: alloc.cogs ? alloc.cogs[i]! : alloc.snap.cogsCostCents,
          createdAt: args.now,
        })
        .run();
    }
    for (const alloc of modBomAllocations) {
      tx.insert(saleItemModifierBomComponents)
        .values({
          ...alloc.snap,
          id: nanoid(),
          saleItemId: newSaleItemId,
          totalQuantityDeducted: alloc.qty[i]!,
          inventoryCostCents: alloc.inv ? alloc.inv[i]! : alloc.snap.inventoryCostCents,
          cogsCostCents: alloc.cogs ? alloc.cogs[i]! : alloc.snap.cogsCostCents,
          createdAt: args.now,
        })
        .run();
    }

    const newCheckLineId = nanoid();
    tx.insert(restaurantCheckLines)
      .values({
        id: newCheckLineId,
        tenantId: args.tenantId,
        checkId: target.checkId,
        saleItemId: newSaleItemId,
        roundId: ensureRoundOnTarget(target.checkId),
        courseId: ensureCourseOnTarget(target.checkId),
        dinerId: args.sourceCheckLine.dinerId,
        createdAt: args.now,
      })
      .run();

    for (const mod of lineModifiers) {
      tx.insert(restaurantLineModifiers)
        .values({
          ...mod,
          id: nanoid(),
          checkLineId: newCheckLineId,
          createdAt: args.now,
        })
        .run();
    }
  }
}

function recalculateDraftHeaderFromLines(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    saleId: string;
    discountAmount: number;
    tipAmount: number;
    tipMethod: (typeof sales.$inferSelect)['tipMethod'];
    serviceChargeAmount: number;
    serviceChargeRate: number | null;
    paymentMethod: (typeof sales.$inferSelect)['paymentMethod'];
    syncVersion: number;
    now: string;
  }
): number {
  const rows = tx
    .select({ total: saleItems.total, taxAmount: saleItems.taxAmount })
    .from(saleItems)
    .where(eq(saleItems.saleId, args.saleId))
    .all();
  const grossCents = rows.reduce((sum, r) => sum + toCents(r.total), 0);
  const taxCents = rows.reduce((sum, r) => sum + toCents(r.taxAmount), 0);
  const subtotal = fromCents(grossCents - taxCents);
  const taxAmount = fromCents(taxCents);
  const total = roundMoney(
    fromCents(grossCents) - args.discountAmount + args.tipAmount + args.serviceChargeAmount
  );
  if (total < 0) {
    invalidDraftSplit('Split draft total cannot be negative', { saleId: args.saleId, total });
  }
  const updated = tx
    .update(sales)
    .set({
      subtotal,
      taxAmount,
      discountAmount: args.discountAmount,
      tipAmount: args.tipAmount,
      tipMethod: args.tipAmount > 0 ? args.tipMethod : null,
      serviceChargeAmount: args.serviceChargeAmount,
      serviceChargeRate: args.serviceChargeAmount > 0 ? args.serviceChargeRate : null,
      total,
      paymentStatus: 'pending',
      syncStatus: 'pending',
      syncVersion: args.syncVersion,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(sales.id, args.saleId),
        eq(sales.tenantId, args.tenantId),
        eq(sales.status, 'draft'),
        isNotNull(sales.suspendedAt)
      )
    )
    .run();
  if (updated.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SPLIT_CHECK_IN_USE',
      message: 'A check of this table is resumed on a register',
    });
  }
  rebuildProvisionalDraftPayment(tx, {
    tenantId: args.tenantId,
    saleId: args.saleId,
    method: args.paymentMethod,
    amount: total,
    now: args.now,
  });
  return total;
}

/**
 * Split one open restaurant check into `parts` equal payable checks (`Total / N`).
 * Preserves exact cent sum across checks, keeps stock untouched, and fences KDS.
 */
export function splitRestaurantCheckEqualInTransaction(
  transaction: DraftSplitTransaction,
  context: SplitContext,
  args: { tableId: string; checkId: string; expectedCheckVersion: number; parts: number }
): SplitChecksSummaryResult {
  const tx = transaction as unknown as DatabaseInstance;
  const { tenantId, actorId, now } = context;
  assertDineInStillActive(tx, tenantId);

  const table = tx
    .select({
      id: restaurantTables.id,
      siteId: restaurantTables.siteId,
      name: restaurantTables.name,
    })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.id, args.tableId),
        eq(restaurantTables.tenantId, tenantId),
        eq(restaurantTables.isActive, true),
        ...(context.callerSiteId ? [eq(restaurantTables.siteId, context.callerSiteId)] : [])
      )
    )
    .get();
  if (!table) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Restaurant table was not found for this tenant',
    });
  }

  const service = findOpenService(tx, tenantId, table.id);
  if (!service) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_NOT_OPEN',
      message: 'The table has no open service to split',
    });
  }
  assertNoUnnormalizedRestaurantDrafts(tx, tenantId, table.id);

  const openCheckCount =
    tx
      .select({ value: count() })
      .from(restaurantChecks)
      .where(
        and(
          eq(restaurantChecks.tenantId, tenantId),
          eq(restaurantChecks.serviceId, service.id),
          eq(restaurantChecks.status, 'open')
        )
      )
      .get()?.value ?? 0;
  if (openCheckCount + (args.parts - 1) > RESTAURANT_REGROUP_MAX_ACCOUNTS) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
      message: 'Splitting this check equally would exceed the maximum open checks for the table',
    });
  }

  const sourceCheck = tx
    .select()
    .from(restaurantChecks)
    .where(
      and(
        eq(restaurantChecks.id, args.checkId),
        eq(restaurantChecks.tenantId, tenantId),
        eq(restaurantChecks.serviceId, service.id),
        eq(restaurantChecks.status, 'open')
      )
    )
    .get();
  if (!sourceCheck || sourceCheck.version !== args.expectedCheckVersion) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SPLIT_STALE',
      message: 'The check changed since it was last read',
    });
  }

  const sourceSale = tx
    .select()
    .from(sales)
    .where(and(eq(sales.id, sourceCheck.saleId), eq(sales.tenantId, tenantId)))
    .get();
  if (!sourceSale || sourceSale.status !== 'draft' || !sourceSale.suspendedAt) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SPLIT_CHECK_IN_USE',
      message: 'This check is currently resumed on a register',
    });
  }
  assertSalesNotExternallyBound(tx, tenantId, [sourceSale.id]);
  assertDraftTenderDivisible(sourceSale);
  const sessionSites = readCashSessionSites(
    tx,
    tenantId,
    sourceSale.cashSessionId ? [sourceSale.cashSessionId] : []
  );
  assertDraftSessionAtTableSite(
    sourceSale.cashSessionId ? sessionSites.get(sourceSale.cashSessionId) : null,
    table.siteId
  );

  const sourceItems = tx
    .select()
    .from(saleItems)
    .where(eq(saleItems.saleId, sourceSale.id))
    .orderBy(asc(saleItems.id))
    .all();
  const sourceCheckLines = tx
    .select()
    .from(restaurantCheckLines)
    .where(
      and(
        eq(restaurantCheckLines.tenantId, tenantId),
        eq(restaurantCheckLines.checkId, sourceCheck.id)
      )
    )
    .all();
  const checkLineBySaleItem = new Map(sourceCheckLines.map(l => [l.saleItemId, l]));
  if (sourceItems.length === 0 || sourceCheckLines.length !== sourceItems.length) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant check metadata does not cover every line of this check',
    });
  }
  assertDraftHeaderMatchesLines(sourceSale, {
    count: sourceItems.length,
    gross: fromCents(sourceItems.reduce((sum, item) => sum + toCents(item.total), 0)),
  });
  assertLinesNotLotOrSerialTracked(
    tx,
    sourceItems.map(i => i.id)
  );

  const kdsScope = { tenantId, siteId: table.siteId, actorId };
  adoptLegacyKitchenSale(tx, kdsScope, sourceSale.id);

  const sequentialId = requireActiveSaleSequential(tx, { tenantId, siteId: table.siteId });
  const targets: TargetCheckHandle[] = [
    {
      checkId: sourceCheck.id,
      saleId: sourceSale.id,
      saleNumber: sourceSale.saleNumber,
      label: sourceCheck.label ?? `${table.name} (1/${args.parts})`,
      version: sourceCheck.version + 1,
      created: false,
    },
  ];

  for (let i = 1; i < args.parts; i += 1) {
    const label = `${table.name} (${i + 1}/${args.parts})`;
    const childSale = insertSuspendedChildDraft(transaction, {
      tenantId,
      source: sourceSale,
      sequentialId,
      tableId: table.id,
      label,
      actorId,
      now,
    });
    const childCheckId = nanoid();
    const openedAt = new Date(Date.parse(now) + i).toISOString();
    tx.insert(restaurantChecks)
      .values({
        id: childCheckId,
        tenantId,
        serviceId: service.id,
        saleId: childSale.id,
        label,
        status: 'open',
        openedBy: actorId,
        openedAt,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    targets.push({
      checkId: childCheckId,
      saleId: childSale.id,
      saleNumber: childSale.saleNumber,
      label,
      version: 1,
      created: true,
    });
  }

  for (const item of sourceItems) {
    const checkLine = checkLineBySaleItem.get(item.id)!;
    splitOneSaleItemAcrossTargets(tx, {
      tenantId,
      siteId: table.siteId,
      now,
      sourceItem: item,
      sourceCheckLine: checkLine,
      targets,
    });
  }

  const weights = Array.from({ length: args.parts }, () => 1);
  const discountShares = allocateCentsByWeights(toCents(sourceSale.discountAmount), weights)!;
  const tipShares = allocateCentsByWeights(toCents(sourceSale.tipAmount), weights)!;
  const serviceShares = allocateCentsByWeights(toCents(sourceSale.serviceChargeAmount), weights)!;

  const resultChecks: SplitChecksSummaryResult['checks'] = [];
  const syncContext = {
    db: tx,
    tenantId,
    envelope: context.envelope ?? null,
    deviceId: context.deviceId ?? null,
  };

  for (const [index, target] of targets.entries()) {
    const syncVersion = target.created ? 1 : (sourceSale.syncVersion ?? 0) + 1;
    const total = recalculateDraftHeaderFromLines(tx, {
      tenantId,
      saleId: target.saleId,
      discountAmount: fromCents(discountShares[index]!),
      tipAmount: fromCents(tipShares[index]!),
      tipMethod: sourceSale.tipMethod,
      serviceChargeAmount: fromCents(serviceShares[index]!),
      serviceChargeRate: sourceSale.serviceChargeRate,
      paymentMethod: sourceSale.paymentMethod,
      syncVersion,
      now,
    });

    if (!target.created) {
      const bumped = tx
        .update(restaurantChecks)
        .set({ version: target.version, label: target.label, updatedAt: now })
        .where(
          and(
            eq(restaurantChecks.id, target.checkId),
            eq(restaurantChecks.tenantId, tenantId),
            eq(restaurantChecks.version, sourceCheck.version)
          )
        )
        .run();
      if (bumped.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SPLIT_STALE',
          message: 'Check changed during equal split',
        });
      }
    }

    reconcileKitchenSaleInTransaction(tx, kdsScope, target.saleId);
    enqueueSyncInTransaction(syncContext, {
      entityType: 'sales',
      entityId: target.saleId,
      operation: target.created ? 'create' : 'update',
      data: {
        id: target.saleId,
        saleNumber: target.saleNumber,
        total,
        siteId: table.siteId,
        syncVersion,
      },
    });
    resultChecks.push({
      checkId: target.checkId,
      saleId: target.saleId,
      saleNumber: target.saleNumber,
      label: target.label,
      total,
      version: target.version,
    });
  }

  writeAuditLog({
    tx,
    tenantId,
    actorId,
    action: 'restaurant_check.split_equal',
    resourceType: 'restaurant_check',
    resourceId: sourceCheck.id,
    before: { total: sourceSale.total, parts: 1 },
    after: {
      parts: args.parts,
      checks: resultChecks.map(c => ({ checkId: c.checkId, saleId: c.saleId, total: c.total })),
    },
    metadata: { tableId: table.id, tableName: table.name, siteId: table.siteId },
  });

  return { checks: resultChecks };
}

/**
 * Split a single shared dish (`saleItemId`) evenly across `targetCheckIds`
 * (existing open check ids or `null` to open new checks) with exact cent
 * conservation and zero duplicate KDS dispatches.
 */
export function splitRestaurantSharedLineInTransaction(
  transaction: DraftSplitTransaction,
  context: SplitContext,
  args: {
    tableId: string;
    checks: readonly RegroupCheckView[];
    saleItemId: string;
    targetCheckIds: ReadonlyArray<string | null>;
  }
): SplitChecksSummaryResult {
  const tx = transaction as unknown as DatabaseInstance;
  const { tenantId, actorId, now } = context;
  assertDineInStillActive(tx, tenantId);

  const table = tx
    .select({
      id: restaurantTables.id,
      siteId: restaurantTables.siteId,
      name: restaurantTables.name,
    })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.id, args.tableId),
        eq(restaurantTables.tenantId, tenantId),
        eq(restaurantTables.isActive, true),
        ...(context.callerSiteId ? [eq(restaurantTables.siteId, context.callerSiteId)] : [])
      )
    )
    .get();
  if (!table) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Restaurant table was not found for this tenant',
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
  assertNoUnnormalizedRestaurantDrafts(tx, tenantId, table.id);

  const openChecks = tx
    .select({
      check: restaurantChecks,
      sale: sales,
    })
    .from(restaurantChecks)
    .innerJoin(sales, and(eq(sales.id, restaurantChecks.saleId), eq(sales.tenantId, tenantId)))
    .where(
      and(
        eq(restaurantChecks.tenantId, tenantId),
        eq(restaurantChecks.serviceId, service.id),
        eq(restaurantChecks.status, 'open')
      )
    )
    .orderBy(asc(restaurantChecks.openedAt), asc(restaurantChecks.id))
    .all();

  const seen = new Map(args.checks.map(v => [v.checkId, v.version]));
  if (
    seen.size !== openChecks.length ||
    openChecks.some(({ check }) => seen.get(check.id) !== check.version)
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SPLIT_STALE',
      message: 'The open checks of this table changed since the split was prepared',
    });
  }

  const newAccountCount = args.targetCheckIds.filter(id => id === null).length;
  if (openChecks.length + newAccountCount > RESTAURANT_REGROUP_MAX_ACCOUNTS) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
      message: 'Splitting this dish would exceed the maximum open checks for the table',
    });
  }

  const checkById = new Map(openChecks.map(row => [row.check.id, row]));
  for (const targetId of args.targetCheckIds) {
    if (targetId !== null && !checkById.has(targetId)) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'RESTAURANT_SPLIT_STALE',
        message: 'One of the target checks is no longer open on this table',
      });
    }
  }

  const sourceCheckLine = tx
    .select()
    .from(restaurantCheckLines)
    .where(
      and(
        eq(restaurantCheckLines.tenantId, tenantId),
        eq(restaurantCheckLines.saleItemId, args.saleItemId)
      )
    )
    .get();
  if (!sourceCheckLine || !checkById.has(sourceCheckLine.checkId)) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_SERVICE_LINES_INVALID',
      message: 'Shared dish line was not found on an open check of this table',
    });
  }

  const sourceEntry = checkById.get(sourceCheckLine.checkId)!;
  const sourceItem = tx
    .select()
    .from(saleItems)
    .where(and(eq(saleItems.id, args.saleItemId), eq(saleItems.saleId, sourceEntry.sale.id)))
    .get();
  if (!sourceItem) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_SERVICE_LINES_INVALID',
      message: 'Shared dish sale item was not found',
    });
  }

  assertSalesNotExternallyBound(
    tx,
    tenantId,
    openChecks.map(c => c.sale.id)
  );
  for (const { sale } of openChecks) {
    if (sale.status !== 'draft' || !sale.suspendedAt) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'RESTAURANT_SPLIT_CHECK_IN_USE',
        message: 'A check of this table is resumed on a register',
      });
    }
    assertDraftTenderDivisible(sale);
  }
  assertLinesNotLotOrSerialTracked(tx, [sourceItem.id]);

  // Ensure source check doesn't end up empty if it only had this line and isn't in targets.
  const sourceItemCount =
    tx
      .select({ value: count() })
      .from(saleItems)
      .where(eq(saleItems.saleId, sourceEntry.sale.id))
      .get()?.value ?? 0;
  if (sourceItemCount === 1 && !args.targetCheckIds.includes(sourceEntry.check.id)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'RESTAURANT_SERVICE_LINES_INVALID',
      message: 'Source check must receive one of the shares when it has only one line',
    });
  }

  const kdsScope = { tenantId, siteId: table.siteId, actorId };
  adoptLegacyKitchenSale(tx, kdsScope, sourceEntry.sale.id);

  // Build ordered target handles, putting sourceEntry first if included so sourceItem stays on its check.
  const orderedTargetIds = [...args.targetCheckIds];
  const srcIdx = orderedTargetIds.indexOf(sourceEntry.check.id);
  if (srcIdx > 0) {
    orderedTargetIds.splice(srcIdx, 1);
    orderedTargetIds.unshift(sourceEntry.check.id);
  }

  let sequentialId: string | undefined;
  let createdIdx = 0;
  const targets: TargetCheckHandle[] = [];
  const touchedCheckIds = new Set<string>([sourceEntry.check.id]);

  for (const targetId of orderedTargetIds) {
    if (targetId !== null) {
      const entry = checkById.get(targetId)!;
      if (
        entry.sale.currencyCode !== sourceEntry.sale.currencyCode ||
        entry.sale.priceTier !== sourceEntry.sale.priceTier ||
        entry.sale.customerId !== sourceEntry.sale.customerId
      ) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SPLIT_TERMS_DIFFER',
          message: 'Shared dish cannot split across checks with different price tiers or customers',
        });
      }
      touchedCheckIds.add(entry.check.id);
      targets.push({
        checkId: entry.check.id,
        saleId: entry.sale.id,
        saleNumber: entry.sale.saleNumber,
        label: entry.check.label,
        version: entry.check.version + 1,
        created: false,
      });
    } else {
      sequentialId ??= requireActiveSaleSequential(tx, { tenantId, siteId: table.siteId });
      createdIdx += 1;
      const label = `${table.name} · Cuenta ${openChecks.length + createdIdx}`;
      const childSale = insertSuspendedChildDraft(transaction, {
        tenantId,
        source: sourceEntry.sale,
        sequentialId,
        tableId: table.id,
        label,
        actorId,
        now,
      });
      const childCheckId = nanoid();
      const openedAt = new Date(Date.parse(now) + createdIdx).toISOString();
      tx.insert(restaurantChecks)
        .values({
          id: childCheckId,
          tenantId,
          serviceId: service.id,
          saleId: childSale.id,
          label,
          status: 'open',
          openedBy: actorId,
          openedAt,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      touchedCheckIds.add(childCheckId);
      targets.push({
        checkId: childCheckId,
        saleId: childSale.id,
        saleNumber: childSale.saleNumber,
        label,
        version: 1,
        created: true,
      });
    }
  }

  splitOneSaleItemAcrossTargets(tx, {
    tenantId,
    siteId: table.siteId,
    now,
    sourceItem,
    sourceCheckLine,
    targets,
  });

  // Recalculate headers for every touched check and bump check versions.
  const syncContext = {
    db: tx,
    tenantId,
    envelope: context.envelope ?? null,
    deviceId: context.deviceId ?? null,
  };
  const createdById = new Map(targets.filter(t => t.created).map(t => [t.checkId, t]));
  const resultChecks: SplitChecksSummaryResult['checks'] = [];

  for (const checkId of touchedCheckIds) {
    const existing = checkById.get(checkId);
    const created = createdById.get(checkId);
    if (existing) {
      const syncVersion = (existing.sale.syncVersion ?? 0) + 1;
      const total = recalculateDraftHeaderFromLines(tx, {
        tenantId,
        saleId: existing.sale.id,
        discountAmount: existing.sale.discountAmount,
        tipAmount: existing.sale.tipAmount,
        tipMethod: existing.sale.tipMethod,
        serviceChargeAmount: existing.sale.serviceChargeAmount,
        serviceChargeRate: existing.sale.serviceChargeRate,
        paymentMethod: existing.sale.paymentMethod,
        syncVersion,
        now,
      });
      const nextVersion = existing.check.version + 1;
      tx.update(restaurantChecks)
        .set({ version: nextVersion, updatedAt: now })
        .where(
          and(
            eq(restaurantChecks.id, existing.check.id),
            eq(restaurantChecks.tenantId, tenantId),
            eq(restaurantChecks.version, existing.check.version)
          )
        )
        .run();
      reconcileKitchenSaleInTransaction(tx, kdsScope, existing.sale.id);
      enqueueSyncInTransaction(syncContext, {
        entityType: 'sales',
        entityId: existing.sale.id,
        operation: 'update',
        data: {
          id: existing.sale.id,
          saleNumber: existing.sale.saleNumber,
          total,
          siteId: table.siteId,
          syncVersion,
        },
      });
      resultChecks.push({
        checkId: existing.check.id,
        saleId: existing.sale.id,
        saleNumber: existing.sale.saleNumber,
        label: existing.check.label,
        total,
        version: nextVersion,
      });
    } else if (created) {
      const total = recalculateDraftHeaderFromLines(tx, {
        tenantId,
        saleId: created.saleId,
        discountAmount: 0,
        tipAmount: 0,
        tipMethod: sourceEntry.sale.tipMethod,
        serviceChargeAmount: 0,
        serviceChargeRate: sourceEntry.sale.serviceChargeRate,
        paymentMethod: sourceEntry.sale.paymentMethod,
        syncVersion: 1,
        now,
      });
      reconcileKitchenSaleInTransaction(tx, kdsScope, created.saleId);
      enqueueSyncInTransaction(syncContext, {
        entityType: 'sales',
        entityId: created.saleId,
        operation: 'create',
        data: {
          id: created.saleId,
          saleNumber: created.saleNumber,
          total,
          siteId: table.siteId,
          syncVersion: 1,
        },
      });
      resultChecks.push({
        checkId: created.checkId,
        saleId: created.saleId,
        saleNumber: created.saleNumber,
        label: created.label,
        total,
        version: 1,
      });
    }
  }

  writeAuditLog({
    tx,
    tenantId,
    actorId,
    action: 'restaurant_check.split_shared_line',
    resourceType: 'restaurant_table',
    resourceId: table.id,
    before: { saleItemId: sourceItem.id, quantity: sourceItem.quantity, total: sourceItem.total },
    after: {
      shares: targets.length,
      checks: resultChecks.map(c => ({ checkId: c.checkId, total: c.total })),
    },
    metadata: { tableId: table.id, tableName: table.name, siteId: table.siteId },
  });

  return { checks: resultChecks };
}
