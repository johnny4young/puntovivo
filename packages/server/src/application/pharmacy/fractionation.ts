import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { roundQuantity } from '@puntovivo/shared/unit-math';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  inventoryLots,
  inventoryMovements,
  pharmacyLotFractionations,
  pharmacyProductProfiles,
  pharmacyRecallLots,
  pharmacyRecalls,
  products,
  sites,
  users,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  applyInventoryBalanceDelta,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import {
  consumeExactInventoryLots,
  isLotExpiredAt,
  receiveInventoryLot,
} from '../../services/inventory-lots/index.js';
import { writeInventoryLotEvent } from '../../services/pharmacy/lot-events.js';
import { toInventoryCents } from '../../services/inventory-valuation.js';
import {
  assertTenantBusinessClockCurrent,
  isCalendarDateExpired,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type {
  FractionatePharmacyLotInput,
  ListPharmacyFractionationsInput,
} from '../../trpc/schemas/pharmacy.js';
import { appendFneLedgerEntry, findEffectiveFneAuthorization } from './fne.js';
import { pharmacyEquivalenceKey, resolveDosesPerPack } from './generic-alternatives.js';
import { clampPharmacyPage, pharmacySyncContext, type CriticalPharmacyContext } from './types.js';

const CLASSIFICATION_RANK = { otc: 0, prescription: 1, controlled: 2 } as const;

/**
 * Regulated pharmacy lot fractionation (box -> blister -> tablet) between two
 * tenant medicine SKUs. Preserves exact physical lot number, expiry date,
 * sanitary registration and exact cent carrying value while maintaining full
 * recall lineage via `pharmacy_lot_fractionations`.
 */
export async function fractionatePharmacyLot(
  ctx: CriticalPharmacyContext,
  input: FractionatePharmacyLotInput
) {
  const unitsPerSource = roundQuantity(input.targetQuantity / input.sourceQuantity, 6);
  if (!Number.isFinite(unitsPerSource) || !(unitsPerSource > 0)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_FRACTIONATION_INVALID',
      message: 'Fractionation ratio (targetQuantity / sourceQuantity) is out of range',
    });
  }

  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const fractionationId = nanoid();
  const sourceMovementId = nanoid();
  const targetMovementId = nanoid();

  return ctx.db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);

      const sourceLot = tx
        .select({
          id: inventoryLots.id,
          siteId: inventoryLots.siteId,
          productId: inventoryLots.productId,
          lotNumber: inventoryLots.lotNumber,
          expiresAt: inventoryLots.expiresAt,
          onHand: inventoryLots.onHand,
          status: inventoryLots.status,
          unitCost: inventoryLots.unitCost,
        })
        .from(inventoryLots)
        .where(
          and(eq(inventoryLots.id, input.sourceLotId), eq(inventoryLots.tenantId, ctx.tenantId))
        )
        .get();
      if (!sourceLot) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'LOT_NOT_FOUND',
          message: 'Source pharmacy lot not found',
        });
      }

      if (ctx.siteId === null || (ctx.siteId !== undefined && ctx.siteId !== sourceLot.siteId)) {
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'PHARMACY_FRACTIONATION_INVALID',
          message: 'Source lot does not belong to the active operating site',
        });
      }

      const activeSite = tx
        .select({ id: sites.id })
        .from(sites)
        .where(
          and(
            eq(sites.id, sourceLot.siteId),
            eq(sites.tenantId, ctx.tenantId),
            eq(sites.isActive, true)
          )
        )
        .get();
      if (!activeSite) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AUTHORITY_SITE_NOT_FOUND',
          message: 'Operating site is inactive or not found',
        });
      }

      if (sourceLot.productId === input.targetProductId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_FRACTIONATION_INVALID',
          message: 'Target medicine SKU must differ from the source SKU',
        });
      }

      if (sourceLot.status !== 'active') {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_LOT_STATE_INVALID',
          message: 'Only active lots can be fractionated',
          details: { lotId: sourceLot.id, status: sourceLot.status },
        });
      }

      if (isLotExpiredAt(sourceLot.expiresAt, clock.nowIso, clock.businessDate)) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_LOT_STATE_INVALID',
          message: 'Expired lots cannot be fractionated',
          details: { lotId: sourceLot.id, expiresAt: sourceLot.expiresAt },
        });
      }

      const activeRecall = tx
        .select({ recallId: pharmacyRecallLots.recallId })
        .from(pharmacyRecallLots)
        .innerJoin(
          pharmacyRecalls,
          and(
            eq(pharmacyRecalls.id, pharmacyRecallLots.recallId),
            eq(pharmacyRecalls.tenantId, ctx.tenantId),
            eq(pharmacyRecalls.status, 'active')
          )
        )
        .where(
          and(
            eq(pharmacyRecallLots.tenantId, ctx.tenantId),
            eq(pharmacyRecallLots.lotId, sourceLot.id)
          )
        )
        .get();
      if (activeRecall) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_RECALL_ACTIVE',
          message: 'A lot under an active recall cannot be fractionated',
          details: { lotId: sourceLot.id, recallId: activeRecall.recallId },
        });
      }

      const profileRows = tx
        .select({
          productId: products.id,
          name: products.name,
          isActive: products.isActive,
          tracksStock: products.tracksStock,
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
          activeIngredient: pharmacyProductProfiles.activeIngredient,
          concentration: pharmacyProductProfiles.concentration,
          dosageForm: pharmacyProductProfiles.dosageForm,
          sanitaryRegistration: pharmacyProductProfiles.sanitaryRegistration,
          sanitaryRegistrationNormalized: pharmacyProductProfiles.sanitaryRegistrationNormalized,
          registrationExpiresAt: pharmacyProductProfiles.registrationExpiresAt,
          classification: pharmacyProductProfiles.classification,
          presentation: pharmacyProductProfiles.presentation,
          dosesPerPack: pharmacyProductProfiles.dosesPerPack,
        })
        .from(products)
        .innerJoin(
          pharmacyProductProfiles,
          and(
            eq(pharmacyProductProfiles.productId, products.id),
            eq(pharmacyProductProfiles.tenantId, ctx.tenantId)
          )
        )
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            inArray(products.id, [sourceLot.productId, input.targetProductId])
          )
        )
        .all();

      const sourceProfile = profileRows.find(r => r.productId === sourceLot.productId);
      const targetProfile = profileRows.find(r => r.productId === input.targetProductId);
      if (!sourceProfile || !targetProfile) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_PRODUCT_PROFILE_REQUIRED',
          message: 'Both source and target products must carry a pharmacy medicine profile',
        });
      }
      if (!sourceProfile.isActive || !targetProfile.isActive) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_FRACTIONATION_INVALID',
          message: 'Both source and target medicines must be active',
        });
      }
      if (
        !sourceProfile.tracksStock ||
        !sourceProfile.tracksLots ||
        sourceProfile.tracksSerials ||
        !targetProfile.tracksStock ||
        !targetProfile.tracksLots ||
        targetProfile.tracksSerials
      ) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_PRODUCT_LOT_TRACKING_REQUIRED',
          message: 'Fractionation requires lot-tracked medicine SKUs without serial tracking',
        });
      }

      // Regulatory equivalence: active ingredient, concentration, dosage form, registration & class
      const sameIngredient =
        pharmacyEquivalenceKey(sourceProfile.activeIngredient) !== null &&
        pharmacyEquivalenceKey(sourceProfile.activeIngredient) ===
          pharmacyEquivalenceKey(targetProfile.activeIngredient);
      const sameConcentration =
        pharmacyEquivalenceKey(sourceProfile.concentration) !== null &&
        pharmacyEquivalenceKey(sourceProfile.concentration) ===
          pharmacyEquivalenceKey(targetProfile.concentration);
      const sameDosageForm =
        pharmacyEquivalenceKey(sourceProfile.dosageForm) !== null &&
        pharmacyEquivalenceKey(sourceProfile.dosageForm) ===
          pharmacyEquivalenceKey(targetProfile.dosageForm);
      if (!sameIngredient || !sameConcentration || !sameDosageForm) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_FRACTIONATION_INVALID',
          message:
            'Source and target SKUs must match in active ingredient, concentration, and dosage form',
        });
      }
      const sourceDoses = resolveDosesPerPack(
        sourceProfile.dosesPerPack,
        sourceProfile.presentation
      );
      const targetDoses = resolveDosesPerPack(
        targetProfile.dosesPerPack,
        targetProfile.presentation
      );
      if (sourceDoses === null || targetDoses === null) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_FRACTIONATION_DOSES_MISMATCH',
          message: 'Source and target SKUs must declare their doses per pack to fractionate',
        });
      }
      // Fractionation repackages doses; it can never create or lose them.
      const sourceTotalDoses = roundQuantity(input.sourceQuantity * sourceDoses, 6);
      const targetTotalDoses = roundQuantity(input.targetQuantity * targetDoses, 6);
      if (Math.abs(sourceTotalDoses - targetTotalDoses) > QUANTITY_EPSILON) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_FRACTIONATION_DOSES_MISMATCH',
          message: 'Target quantity must hold exactly the doses of the source quantity',
          details: { sourceTotalDoses, targetTotalDoses },
        });
      }
      if (
        !sourceProfile.sanitaryRegistrationNormalized ||
        !targetProfile.sanitaryRegistrationNormalized ||
        sourceProfile.sanitaryRegistrationNormalized !==
          targetProfile.sanitaryRegistrationNormalized
      ) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_FRACTIONATION_INVALID',
          message: 'Source and target SKUs must carry the same non-empty sanitary registration',
        });
      }
      if (
        (sourceProfile.registrationExpiresAt &&
          isCalendarDateExpired(sourceProfile.registrationExpiresAt, clock.businessDate)) ||
        (targetProfile.registrationExpiresAt &&
          isCalendarDateExpired(targetProfile.registrationExpiresAt, clock.businessDate))
      ) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_PRODUCT_REGISTRATION_EXPIRED',
          message: 'Cannot fractionate a medicine with an expired sanitary registration',
        });
      }
      if (
        CLASSIFICATION_RANK[targetProfile.classification] !==
        CLASSIFICATION_RANK[sourceProfile.classification]
      ) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_FRACTIONATION_INVALID',
          message: 'Source and target SKUs must share the same regulatory classification',
        });
      }

      // Preventive product / sanitary-registration recall check across both SKUs
      const activeScopeRecall = tx
        .select({ id: pharmacyRecalls.id })
        .from(pharmacyRecalls)
        .where(
          and(
            eq(pharmacyRecalls.tenantId, ctx.tenantId),
            eq(pharmacyRecalls.status, 'active'),
            or(
              and(
                eq(pharmacyRecalls.scopeType, 'product'),
                inArray(pharmacyRecalls.productId, [sourceLot.productId, targetProfile.productId])
              ),
              and(
                eq(pharmacyRecalls.scopeType, 'sanitary_registration'),
                eq(
                  pharmacyRecalls.sanitaryRegistration,
                  sourceProfile.sanitaryRegistrationNormalized
                )
              )
            )
          )
        )
        .get();
      if (activeScopeRecall) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_RECALL_ACTIVE',
          message: 'Cannot fractionate into or from a medicine covered by an active recall',
          details: { recallId: activeScopeRecall.id },
        });
      }

      // Guard against merging into an existing quarantined / recalled / expired target lot
      const existingTargetLot = tx
        .select({ id: inventoryLots.id, status: inventoryLots.status })
        .from(inventoryLots)
        .where(
          and(
            eq(inventoryLots.tenantId, ctx.tenantId),
            eq(inventoryLots.siteId, sourceLot.siteId),
            eq(inventoryLots.productId, targetProfile.productId),
            eq(inventoryLots.lotNumber, sourceLot.lotNumber)
          )
        )
        .get();
      if (
        existingTargetLot &&
        (existingTargetLot.status === 'recalled' ||
          existingTargetLot.status === 'quarantined' ||
          existingTargetLot.status === 'expired')
      ) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode:
            existingTargetLot.status === 'recalled'
              ? 'PHARMACY_RECALL_ACTIVE'
              : 'PHARMACY_LOT_STATE_INVALID',
          message:
            'Target lot is in a non-sellable custody state and cannot receive fractionated stock',
          details: { targetLotId: existingTargetLot.id, status: existingTargetLot.status },
        });
      }

      const fneAuth =
        sourceProfile.classification === 'controlled'
          ? findEffectiveFneAuthorization(tx, {
              tenantId: ctx.tenantId,
              siteId: sourceLot.siteId,
              countryCode: clock.countryCode,
              businessDate: clock.businessDate,
            })
          : null;
      if (sourceProfile.classification === 'controlled' && !fneAuth) {
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'PHARMACY_CONTROLLED_NOT_ENABLED',
          message: 'Controlled medicines require an active FNE authorization before fractionation',
        });
      }

      const sourceBalance = tx
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, ctx.tenantId),
            eq(inventoryBalances.siteId, sourceLot.siteId),
            eq(inventoryBalances.productId, sourceLot.productId)
          )
        )
        .get();
      const previousSourceStock = getProductStockTotal(tx, ctx.tenantId, sourceLot.productId);
      const previousTargetStock = getProductStockTotal(tx, ctx.tenantId, targetProfile.productId);
      if (
        !sourceBalance ||
        !Number.isFinite(sourceBalance.onHand) ||
        sourceBalance.onHand + QUANTITY_EPSILON < input.sourceQuantity ||
        previousSourceStock + QUANTITY_EPSILON < input.sourceQuantity
      ) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'LOT_STOCK_INCONSISTENT',
          message: 'Site balance cannot satisfy this fractionation quantity',
        });
      }

      const sync = pharmacySyncContext(ctx, tx);

      // 1. Consume exact source lot quantity (cent-exact totalCost)
      const [consumed] = consumeExactInventoryLots(tx, {
        tenantId: ctx.tenantId,
        siteId: sourceLot.siteId,
        productId: sourceLot.productId,
        allocations: [{ lotId: sourceLot.id, quantity: input.sourceQuantity }],
        now: clock.nowIso,
        businessDate: clock.businessDate,
      });
      if (!consumed) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'LOT_STOCK_INCONSISTENT',
          message: 'Source lot consumption failed during fractionation',
        });
      }

      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: sourceLot.siteId,
        productId: sourceLot.productId,
        delta: -input.sourceQuantity,
        initialOnHandIfMissing: sourceBalance.onHand,
        now: clock.nowIso,
      });

      const transferredValueCents = toInventoryCents(consumed.totalCost);
      const newSourceStock = getProductStockTotal(tx, ctx.tenantId, sourceLot.productId);

      const sourceMovementRow = {
        id: sourceMovementId,
        tenantId: ctx.tenantId,
        productId: sourceLot.productId,
        siteId: sourceLot.siteId,
        type: 'transformation' as const,
        inventoryValueDeltaCents: -transferredValueCents,
        cogsValueDeltaCents: -transferredValueCents,
        quantity: -input.sourceQuantity,
        previousStock: previousSourceStock,
        newStock: newSourceStock,
        reference: `pharmacy-fractionation:${fractionationId}`,
        notes: input.reason,
        createdBy: ctx.user.id,
        syncStatus: 'pending' as const,
        syncVersion: 1,
        createdAt: clock.nowIso,
      };
      tx.insert(inventoryMovements).values(sourceMovementRow).run();

      // 2. Receive exact target lot preserving lotNumber, expiresAt, and cent-exact totalCost
      const targetUnitCost = roundMoney(consumed.totalCost / input.targetQuantity);
      const receivedTarget = receiveInventoryLot(tx, {
        tenantId: ctx.tenantId,
        siteId: sourceLot.siteId,
        productId: targetProfile.productId,
        lotNumber: sourceLot.lotNumber,
        expiresAt: sourceLot.expiresAt,
        quantity: input.targetQuantity,
        unitCost: targetUnitCost,
        totalCost: consumed.totalCost,
        requireExactExpiry: true,
        notes: `Fraccionado desde lote ${sourceLot.lotNumber}`,
        now: clock.nowIso,
        businessDate: clock.businessDate,
      });

      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: sourceLot.siteId,
        productId: targetProfile.productId,
        delta: input.targetQuantity,
        now: clock.nowIso,
      });
      const newTargetStock = getProductStockTotal(tx, ctx.tenantId, targetProfile.productId);

      const targetMovementRow = {
        id: targetMovementId,
        tenantId: ctx.tenantId,
        productId: targetProfile.productId,
        siteId: sourceLot.siteId,
        type: 'transformation' as const,
        inventoryValueDeltaCents: transferredValueCents,
        cogsValueDeltaCents: transferredValueCents,
        quantity: input.targetQuantity,
        previousStock: previousTargetStock,
        newStock: newTargetStock,
        reference: `pharmacy-fractionation:${fractionationId}`,
        notes: input.reason,
        createdBy: ctx.user.id,
        syncStatus: 'pending' as const,
        syncVersion: 1,
        createdAt: clock.nowIso,
      };
      tx.insert(inventoryMovements).values(targetMovementRow).run();

      writeInventoryLotEvent(tx, sync, {
        tenantId: ctx.tenantId,
        siteId: sourceLot.siteId,
        productId: targetProfile.productId,
        lotId: receivedTarget.lotId,
        eventType: 'activation',
        previousStatus: receivedTarget.previousStatus,
        nextStatus: receivedTarget.status,
        quantitySnapshot: receivedTarget.onHand,
        reason: input.reason,
        referenceType: 'pharmacy_lot_fractionation',
        referenceId: fractionationId,
        actorId: ctx.user.id,
        occurredAt: clock.nowIso,
      });

      const sanitaryRegistration =
        sourceProfile.sanitaryRegistration ?? targetProfile.sanitaryRegistration ?? null;

      tx.insert(pharmacyLotFractionations)
        .values({
          id: fractionationId,
          tenantId: ctx.tenantId,
          siteId: sourceLot.siteId,
          sourceProductId: sourceLot.productId,
          sourceLotId: sourceLot.id,
          targetProductId: targetProfile.productId,
          targetLotId: receivedTarget.lotId,
          sourceQuantity: input.sourceQuantity,
          targetQuantity: input.targetQuantity,
          unitsPerSource,
          sourceLotNumber: sourceLot.lotNumber,
          targetLotNumber: sourceLot.lotNumber,
          expiresAt: sourceLot.expiresAt,
          sanitaryRegistration,
          transferredValueCents,
          sourceMovementId,
          targetMovementId,
          reason: input.reason,
          actorId: ctx.user.id,
          occurredAt: clock.nowIso,
          createdAt: clock.nowIso,
        })
        .run();

      // Mirror into FNE controlled-substances ledger when controlled
      if (sourceProfile.classification === 'controlled') {
        appendFneLedgerEntry(tx, {
          tenantId: ctx.tenantId,
          siteId: sourceLot.siteId,
          productId: sourceLot.productId,
          lotId: sourceLot.id,
          lotNumber: sourceLot.lotNumber,
          businessDate: clock.businessDate,
          movementType: 'fractionation_out',
          quantityDelta: -input.sourceQuantity,
          fneAuthorizationId: fneAuth!.id,
          actorId: ctx.user.id,
          notes: input.reason,
          occurredAt: clock.nowIso,
        });
        appendFneLedgerEntry(tx, {
          tenantId: ctx.tenantId,
          siteId: sourceLot.siteId,
          productId: targetProfile.productId,
          lotId: receivedTarget.lotId,
          lotNumber: sourceLot.lotNumber,
          businessDate: clock.businessDate,
          movementType: 'fractionation_in',
          quantityDelta: input.targetQuantity,
          fneAuthorizationId: fneAuth!.id,
          actorId: ctx.user.id,
          notes: input.reason,
          occurredAt: clock.nowIso,
        });
      }

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.lot.fractionate',
        resourceType: 'pharmacy_lot_fractionation',
        resourceId: fractionationId,
        before: {
          sourceLotId: sourceLot.id,
          sourceOnHand: consumed.previousOnHand,
        },
        after: {
          sourceLotId: sourceLot.id,
          sourceOnHand: consumed.newOnHand,
          targetLotId: receivedTarget.lotId,
          targetOnHand: receivedTarget.onHand,
          lotNumber: sourceLot.lotNumber,
          expiresAt: sourceLot.expiresAt,
          transferredValueCents,
        },
        metadata: {
          sourceProductId: sourceLot.productId,
          targetProductId: targetProfile.productId,
          sourceQuantity: input.sourceQuantity,
          targetQuantity: input.targetQuantity,
          sanitaryRegistration,
          reason: input.reason,
        },
        operationId: ctx.envelope.operationId,
      });

      const updatedSourceLot = tx
        .select()
        .from(inventoryLots)
        .where(and(eq(inventoryLots.id, sourceLot.id), eq(inventoryLots.tenantId, ctx.tenantId)))
        .get()!;
      const updatedTargetLot = tx
        .select()
        .from(inventoryLots)
        .where(
          and(eq(inventoryLots.id, receivedTarget.lotId), eq(inventoryLots.tenantId, ctx.tenantId))
        )
        .get()!;

      enqueueSyncInTransaction(sync, {
        entityType: 'inventory_lots',
        entityId: sourceLot.id,
        operation: 'update',
        data: updatedSourceLot,
      });
      enqueueSyncInTransaction(sync, {
        entityType: 'inventory_lots',
        entityId: receivedTarget.lotId,
        operation: receivedTarget.created ? 'create' : 'update',
        data: updatedTargetLot,
      });
      enqueueSyncInTransaction(sync, {
        entityType: 'inventory_movements',
        entityId: sourceMovementId,
        operation: 'create',
        data: sourceMovementRow,
      });
      enqueueSyncInTransaction(sync, {
        entityType: 'inventory_movements',
        entityId: targetMovementId,
        operation: 'create',
        data: targetMovementRow,
      });

      const result = {
        id: fractionationId,
        sourceLotId: sourceLot.id,
        sourceOnHand: consumed.newOnHand,
        targetLotId: receivedTarget.lotId,
        targetOnHand: receivedTarget.onHand,
        lotNumber: sourceLot.lotNumber,
        expiresAt: sourceLot.expiresAt,
        sanitaryRegistration,
        transferredValueCents,
      };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function listPharmacyFractionations(
  db: DatabaseInstance,
  tenantId: string,
  input: ListPharmacyFractionationsInput
) {
  const where = and(
    eq(pharmacyLotFractionations.tenantId, tenantId),
    input.siteId ? eq(pharmacyLotFractionations.siteId, input.siteId) : undefined
  );

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(pharmacyLotFractionations)
    .where(where)
    .get();
  const total = Number(totalRow?.count ?? 0);
  const perPage = input.perPage;
  const page = clampPharmacyPage(total, perPage, input.page);
  const offset = (page - 1) * perPage;

  const rows = db
    .select({
      id: pharmacyLotFractionations.id,
      siteId: pharmacyLotFractionations.siteId,
      sourceProductId: pharmacyLotFractionations.sourceProductId,
      sourceLotId: pharmacyLotFractionations.sourceLotId,
      targetProductId: pharmacyLotFractionations.targetProductId,
      targetLotId: pharmacyLotFractionations.targetLotId,
      sourceQuantity: pharmacyLotFractionations.sourceQuantity,
      targetQuantity: pharmacyLotFractionations.targetQuantity,
      unitsPerSource: pharmacyLotFractionations.unitsPerSource,
      lotNumber: pharmacyLotFractionations.sourceLotNumber,
      expiresAt: pharmacyLotFractionations.expiresAt,
      sanitaryRegistration: pharmacyLotFractionations.sanitaryRegistration,
      transferredValueCents: pharmacyLotFractionations.transferredValueCents,
      reason: pharmacyLotFractionations.reason,
      actorName: users.name,
      occurredAt: pharmacyLotFractionations.occurredAt,
    })
    .from(pharmacyLotFractionations)
    .innerJoin(
      users,
      and(eq(users.id, pharmacyLotFractionations.actorId), eq(users.tenantId, tenantId))
    )
    .where(where)
    .orderBy(desc(pharmacyLotFractionations.occurredAt))
    .limit(perPage)
    .offset(offset)
    .all();

  const productIds = [...new Set(rows.flatMap(r => [r.sourceProductId, r.targetProductId]))];
  const productRows =
    productIds.length > 0
      ? db
          .select({ id: products.id, name: products.name, sku: products.sku })
          .from(products)
          .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
          .all()
      : [];
  const productMap = new Map(productRows.map(p => [p.id, p]));

  const items = rows.map(row => ({
    ...row,
    sourceProductName: productMap.get(row.sourceProductId)?.name ?? row.sourceProductId,
    sourceProductSku: productMap.get(row.sourceProductId)?.sku ?? '',
    targetProductName: productMap.get(row.targetProductId)?.name ?? row.targetProductId,
    targetProductSku: productMap.get(row.targetProductId)?.sku ?? '',
  }));

  return { items, total, page, perPage };
}
