import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { roundQuantity } from '@puntovivo/shared/unit-math';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  inventoryLots,
  pharmacyFneAuthorizations,
  pharmacyFneLedger,
  pharmacyProductProfiles,
  products,
  sites,
  tenantLocaleSettings,
  users,
  type PharmacyFneMovementType,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import type {
  CreatePharmacyFneAuthorizationInput,
  GetPharmacyFneMonthlyReportInput,
  ListPharmacyFneAuthorizationsInput,
  RevokePharmacyFneAuthorizationInput,
} from '../../trpc/schemas/pharmacy.js';
import { findEffectivePharmacyAuthorization } from './authorizations.js';
import { clampPharmacyPage, type CriticalPharmacyContext } from './types.js';

export interface ActiveFneAuthorization {
  id: string;
  resolutionNumber: string;
  issuingAuthority: string;
  siteId: string | null;
  responsibleUserId: string;
  validFrom: string;
  validUntil: string | null;
}

/**
 * Resolve an active FNE resolution for this tenant/site and business day.
 * Requires the designated responsible pharmacist to remain active and hold
 * an effective professional authorization in the same country.
 */
export function findEffectiveFneAuthorization(
  db: DatabaseInstance,
  input: {
    tenantId: string;
    siteId?: string | null;
    countryCode: string;
    businessDate: string;
  }
): ActiveFneAuthorization | null {
  const candidates = db
    .select({
      id: pharmacyFneAuthorizations.id,
      resolutionNumber: pharmacyFneAuthorizations.resolutionNumber,
      issuingAuthority: pharmacyFneAuthorizations.issuingAuthority,
      siteId: pharmacyFneAuthorizations.siteId,
      responsibleUserId: pharmacyFneAuthorizations.responsibleUserId,
      validFrom: pharmacyFneAuthorizations.validFrom,
      validUntil: pharmacyFneAuthorizations.validUntil,
    })
    .from(pharmacyFneAuthorizations)
    .innerJoin(
      users,
      and(
        eq(users.id, pharmacyFneAuthorizations.responsibleUserId),
        eq(users.tenantId, input.tenantId),
        eq(users.isActive, true)
      )
    )
    .where(
      and(
        eq(pharmacyFneAuthorizations.tenantId, input.tenantId),
        eq(pharmacyFneAuthorizations.countryCode, input.countryCode),
        eq(pharmacyFneAuthorizations.status, 'active'),
        sql`${pharmacyFneAuthorizations.validFrom} <= ${input.businessDate}`,
        or(
          isNull(pharmacyFneAuthorizations.validUntil),
          sql`${pharmacyFneAuthorizations.validUntil} >= ${input.businessDate}`
        ),
        input.siteId
          ? or(
              isNull(pharmacyFneAuthorizations.siteId),
              eq(pharmacyFneAuthorizations.siteId, input.siteId)
            )
          : isNull(pharmacyFneAuthorizations.siteId)
      )
    )
    .orderBy(
      desc(sql<number>`case when ${pharmacyFneAuthorizations.siteId} is null then 0 else 1 end`),
      desc(pharmacyFneAuthorizations.validFrom),
      desc(pharmacyFneAuthorizations.createdAt),
      desc(pharmacyFneAuthorizations.id)
    )
    .all();

  for (const row of candidates) {
    const effectiveScopeSiteId = input.siteId ?? row.siteId ?? null;
    const profAuth = findEffectivePharmacyAuthorization(db, {
      tenantId: input.tenantId,
      userId: row.responsibleUserId,
      siteId: effectiveScopeSiteId,
      countryCode: input.countryCode,
      businessDate: input.businessDate,
    });
    if (profAuth) {
      return row;
    }
  }
  return null;
}

export async function createPharmacyFneAuthorization(
  ctx: CriticalPharmacyContext,
  input: CreatePharmacyFneAuthorizationInput
) {
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const id = nanoid();

  return ctx.db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
      if (input.countryCode !== clock.countryCode) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_AUTHORIZATION_SUBJECT_INVALID',
          message: 'FNE authorization country must match the tenant operating country',
        });
      }
      if (input.siteId) {
        const site = tx
          .select({ id: sites.id })
          .from(sites)
          .where(
            and(
              eq(sites.id, input.siteId),
              eq(sites.tenantId, ctx.tenantId),
              eq(sites.isActive, true)
            )
          )
          .get();
        if (!site) {
          throwServerError({
            trpcCode: 'NOT_FOUND',
            errorCode: 'AUTHORITY_SITE_NOT_FOUND',
            message: 'Site not found for this tenant',
          });
        }
      }

      const responsible = tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, input.responsibleUserId),
            eq(users.tenantId, ctx.tenantId),
            eq(users.isActive, true)
          )
        )
        .get();
      if (!responsible) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_AUTHORIZATION_SUBJECT_INVALID',
          message: 'Responsible pharmacist must be an active user of this tenant',
        });
      }

      const effectiveFromCheck =
        input.validFrom > clock.businessDate ? input.validFrom : clock.businessDate;
      const hasProfAuth = findEffectivePharmacyAuthorization(tx, {
        tenantId: ctx.tenantId,
        userId: input.responsibleUserId,
        siteId: input.siteId ?? null,
        countryCode: clock.countryCode,
        businessDate: effectiveFromCheck,
      });
      if (!hasProfAuth) {
        throwServerError({
          trpcCode: 'PRECONDITION_FAILED',
          errorCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE',
          message:
            'Responsible pharmacist must hold an effective, authentic professional authorization for this site before enabling FNE',
        });
      }

      const duplicate = tx
        .select({ id: pharmacyFneAuthorizations.id })
        .from(pharmacyFneAuthorizations)
        .where(
          and(
            eq(pharmacyFneAuthorizations.tenantId, ctx.tenantId),
            eq(pharmacyFneAuthorizations.resolutionNumber, input.resolutionNumber),
            eq(pharmacyFneAuthorizations.status, 'active')
          )
        )
        .get();
      if (duplicate) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_FNE_AUTHORIZATION_DUPLICATE',
          message: 'An active FNE authorization with this resolution number already exists',
        });
      }

      tx.insert(pharmacyFneAuthorizations)
        .values({
          id,
          tenantId: ctx.tenantId,
          siteId: input.siteId ?? null,
          countryCode: input.countryCode,
          resolutionNumber: input.resolutionNumber,
          issuingAuthority: input.issuingAuthority,
          responsibleUserId: input.responsibleUserId,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          status: 'active',
          createdBy: ctx.user.id,
          createdAt: clock.nowIso,
          updatedAt: clock.nowIso,
        })
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.fne_authorization.create',
        resourceType: 'pharmacy_fne_authorization',
        resourceId: id,
        after: {
          resolutionNumber: input.resolutionNumber,
          countryCode: input.countryCode,
          siteId: input.siteId ?? null,
          responsibleUserId: input.responsibleUserId,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
        },
        operationId: ctx.envelope.operationId,
      });

      const result = {
        id,
        resolutionNumber: input.resolutionNumber,
        status: 'active' as const,
      };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export async function revokePharmacyFneAuthorization(
  ctx: CriticalPharmacyContext,
  input: RevokePharmacyFneAuthorizationInput
) {
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);

  return ctx.db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
      const existing = tx
        .select()
        .from(pharmacyFneAuthorizations)
        .where(
          and(
            eq(pharmacyFneAuthorizations.id, input.id),
            eq(pharmacyFneAuthorizations.tenantId, ctx.tenantId)
          )
        )
        .get();
      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_FNE_AUTHORIZATION_NOT_FOUND',
          message: 'FNE authorization not found',
        });
      }
      if (existing.status !== 'active') {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_AUTHORIZATION_STATE_INVALID',
          message: 'FNE authorization is already revoked',
        });
      }

      tx.update(pharmacyFneAuthorizations)
        .set({
          status: 'revoked',
          revokedBy: ctx.user.id,
          revokedAt: clock.nowIso,
          updatedAt: clock.nowIso,
        })
        .where(
          and(
            eq(pharmacyFneAuthorizations.id, existing.id),
            eq(pharmacyFneAuthorizations.tenantId, ctx.tenantId),
            eq(pharmacyFneAuthorizations.status, 'active')
          )
        )
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.fne_authorization.revoke',
        resourceType: 'pharmacy_fne_authorization',
        resourceId: existing.id,
        before: { status: 'active', resolutionNumber: existing.resolutionNumber },
        after: { status: 'revoked', reason: input.reason },
        operationId: ctx.envelope.operationId,
      });

      const result = { id: existing.id, status: 'revoked' as const };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function listPharmacyFneAuthorizations(
  db: DatabaseInstance,
  tenantId: string,
  input: ListPharmacyFneAuthorizationsInput
) {
  const where = and(
    eq(pharmacyFneAuthorizations.tenantId, tenantId),
    input.activeOnly ? eq(pharmacyFneAuthorizations.status, 'active') : undefined,
    input.siteId
      ? or(
          isNull(pharmacyFneAuthorizations.siteId),
          eq(pharmacyFneAuthorizations.siteId, input.siteId)
        )
      : undefined
  );

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(pharmacyFneAuthorizations)
    .where(where)
    .get();
  const total = Number(totalRow?.count ?? 0);
  const perPage = input.perPage;
  const page = clampPharmacyPage(total, perPage, input.page);
  const offset = (page - 1) * perPage;

  const items = db
    .select({
      id: pharmacyFneAuthorizations.id,
      siteId: pharmacyFneAuthorizations.siteId,
      siteName: sites.name,
      countryCode: pharmacyFneAuthorizations.countryCode,
      resolutionNumber: pharmacyFneAuthorizations.resolutionNumber,
      issuingAuthority: pharmacyFneAuthorizations.issuingAuthority,
      responsibleUserId: pharmacyFneAuthorizations.responsibleUserId,
      responsibleUserName: users.name,
      validFrom: pharmacyFneAuthorizations.validFrom,
      validUntil: pharmacyFneAuthorizations.validUntil,
      status: pharmacyFneAuthorizations.status,
      revokedAt: pharmacyFneAuthorizations.revokedAt,
      createdAt: pharmacyFneAuthorizations.createdAt,
    })
    .from(pharmacyFneAuthorizations)
    .innerJoin(
      users,
      and(eq(users.id, pharmacyFneAuthorizations.responsibleUserId), eq(users.tenantId, tenantId))
    )
    .leftJoin(
      sites,
      and(eq(sites.id, pharmacyFneAuthorizations.siteId), eq(sites.tenantId, tenantId))
    )
    .where(where)
    .orderBy(desc(pharmacyFneAuthorizations.createdAt))
    .limit(perPage)
    .offset(offset)
    .all();

  return { items, total, page, perPage };
}

export interface FneLedgerMovement {
  lotId?: string | null;
  lotNumber?: string | null;
  movementType: PharmacyFneMovementType;
  quantityDelta: number;
  fneAuthorizationId?: string | null;
  saleId?: string | null;
  evidenceId?: string | null;
  retainedFormulaDigest?: string | null;
  notes?: string | null;
}

export interface FneLedgerScope {
  tenantId: string;
  siteId: string;
  productId: string;
  businessDate: string;
  actorId: string;
  occurredAt: string;
}

/**
 * Append the movements of one product at one site, after their lot changes
 * are applied in the same transaction. The balance before the batch is the
 * live lot stock minus the batch; when it disagrees with the last row, an
 * explicit opening_balance or reconciliation row records the difference.
 */
export function appendFneLedgerEntries(
  tx: DatabaseInstance,
  scope: FneLedgerScope,
  movements: readonly FneLedgerMovement[]
): string[] {
  if (movements.length === 0) return [];
  const deltas = movements.map(row => roundQuantity(row.quantityDelta, 12));
  const lotStock = tx
    .select({ onHand: sql<number>`coalesce(sum(${inventoryLots.onHand}), 0)` })
    .from(inventoryLots)
    .where(
      and(
        eq(inventoryLots.tenantId, scope.tenantId),
        eq(inventoryLots.siteId, scope.siteId),
        eq(inventoryLots.productId, scope.productId)
      )
    )
    .get();
  const batchDelta = deltas.reduce((sum, delta) => roundQuantity(sum + delta, 12), 0);
  const balanceBefore = roundQuantity(Number(lotStock?.onHand ?? 0) - batchDelta, 12);
  const prevRow = tx
    .select({ balanceAfter: pharmacyFneLedger.balanceAfter })
    .from(pharmacyFneLedger)
    .where(
      and(
        eq(pharmacyFneLedger.tenantId, scope.tenantId),
        eq(pharmacyFneLedger.siteId, scope.siteId),
        eq(pharmacyFneLedger.productId, scope.productId)
      )
    )
    .orderBy(desc(sql`${pharmacyFneLedger}.rowid`))
    .limit(1)
    .get();

  const insertRow = (row: FneLedgerMovement, delta: number, balanceAfter: number) => {
    const id = nanoid();
    tx.insert(pharmacyFneLedger)
      .values({
        id,
        tenantId: scope.tenantId,
        siteId: scope.siteId,
        productId: scope.productId,
        lotId: row.lotId ?? null,
        lotNumber: row.lotNumber ?? null,
        businessDate: scope.businessDate,
        movementType: row.movementType,
        quantityDelta: delta,
        balanceAfter,
        fneAuthorizationId: row.fneAuthorizationId ?? null,
        saleId: row.saleId ?? null,
        evidenceId: row.evidenceId ?? null,
        retainedFormulaDigest: row.retainedFormulaDigest ?? null,
        actorId: scope.actorId,
        notes: row.notes ?? null,
        occurredAt: scope.occurredAt,
        createdAt: scope.occurredAt,
      })
      .run();
    return id;
  };

  const ledgerBefore = prevRow?.balanceAfter ?? 0;
  const gap = roundQuantity(balanceBefore - ledgerBefore, 12);
  if (gap !== 0) {
    insertRow(
      {
        movementType: prevRow === undefined && gap > 0 ? 'opening_balance' : 'reconciliation',
        quantityDelta: gap,
        fneAuthorizationId: movements[0]!.fneAuthorizationId ?? null,
      },
      gap,
      balanceBefore
    );
  }

  let balance = balanceBefore;
  return movements.map((row, index) => {
    balance = roundQuantity(balance + deltas[index]!, 12);
    return insertRow(row, deltas[index]!, balance);
  });
}

/** Single-movement form; only for callers that change one lot per append. */
export function appendFneLedgerEntry(
  tx: DatabaseInstance,
  entry: FneLedgerScope & FneLedgerMovement
): string {
  return appendFneLedgerEntries(tx, entry, [entry])[0]!;
}

/**
 * Append FNE ledger rows iff `productId` carries a `'controlled'` pharmacy profile.
 * Pass every movement of the product that the transaction already applied to its lots.
 */
export function recordControlledStockMovementsInFneLedger(
  tx: DatabaseInstance,
  scope: FneLedgerScope,
  movements: readonly FneLedgerMovement[]
): string[] {
  if (movements.length === 0) return [];
  const profile = tx
    .select({ classification: pharmacyProductProfiles.classification })
    .from(pharmacyProductProfiles)
    .where(
      and(
        eq(pharmacyProductProfiles.tenantId, scope.tenantId),
        eq(pharmacyProductProfiles.productId, scope.productId)
      )
    )
    .get();
  if (profile?.classification !== 'controlled') return [];

  const locale = tx
    .select({ countryCode: tenantLocaleSettings.countryCode })
    .from(tenantLocaleSettings)
    .where(eq(tenantLocaleSettings.tenantId, scope.tenantId))
    .get();
  const countryCode = (locale?.countryCode ?? 'CO').toUpperCase();
  const fneAuth = findEffectiveFneAuthorization(tx, {
    tenantId: scope.tenantId,
    siteId: scope.siteId,
    countryCode,
    businessDate: scope.businessDate,
  });

  return appendFneLedgerEntries(
    tx,
    scope,
    movements.map(row => ({ ...row, fneAuthorizationId: fneAuth?.id ?? null }))
  );
}

/** Single-movement form; only for callers that change one lot per append. */
export function recordControlledStockMovementInFneLedger(
  tx: DatabaseInstance,
  entry: FneLedgerScope & FneLedgerMovement
): string | null {
  return recordControlledStockMovementsInFneLedger(tx, entry, [entry])[0] ?? null;
}

export async function getPharmacyFneMonthlyReport(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  input: GetPharmacyFneMonthlyReportInput
) {
  const clock = await resolveTenantBusinessClock(db, tenantId);
  const fromDate = `${input.month}-01`;
  const [yearNum, monthNum] = input.month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(yearNum!, monthNum!, 0)).getUTCDate();
  const toDate = `${input.month}-${String(lastDay).padStart(2, '0')}`;

  const site = db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .get();

  const activeAuthorization = findEffectiveFneAuthorization(db, {
    tenantId,
    siteId,
    countryCode: clock.countryCode,
    businessDate: clock.businessDate,
  });

  const controlledProducts = db
    .select({
      productId: products.id,
      name: products.name,
      sku: products.sku,
      activeIngredient: pharmacyProductProfiles.activeIngredient,
      concentration: pharmacyProductProfiles.concentration,
      dosageForm: pharmacyProductProfiles.dosageForm,
      sanitaryRegistration: pharmacyProductProfiles.sanitaryRegistration,
      cumCode: pharmacyProductProfiles.cumCode,
      currentStock: inventoryBalances.onHand,
    })
    .from(products)
    .innerJoin(
      pharmacyProductProfiles,
      and(
        eq(pharmacyProductProfiles.productId, products.id),
        eq(pharmacyProductProfiles.tenantId, tenantId),
        eq(pharmacyProductProfiles.classification, 'controlled')
      )
    )
    .leftJoin(
      inventoryBalances,
      and(
        eq(inventoryBalances.tenantId, tenantId),
        eq(inventoryBalances.siteId, siteId),
        eq(inventoryBalances.productId, products.id)
      )
    )
    .where(eq(products.tenantId, tenantId))
    .orderBy(asc(products.name))
    .all();

  const rawEntries = db
    .select({
      id: pharmacyFneLedger.id,
      productId: pharmacyFneLedger.productId,
      productName: products.name,
      productSku: products.sku,
      lotNumber: pharmacyFneLedger.lotNumber,
      businessDate: pharmacyFneLedger.businessDate,
      movementType: pharmacyFneLedger.movementType,
      quantityDelta: pharmacyFneLedger.quantityDelta,
      balanceAfter: pharmacyFneLedger.balanceAfter,
      retainedFormulaDigest: pharmacyFneLedger.retainedFormulaDigest,
      actorName: users.name,
      notes: pharmacyFneLedger.notes,
      occurredAt: pharmacyFneLedger.occurredAt,
    })
    .from(pharmacyFneLedger)
    .innerJoin(
      products,
      and(eq(products.id, pharmacyFneLedger.productId), eq(products.tenantId, tenantId))
    )
    .innerJoin(users, and(eq(users.id, pharmacyFneLedger.actorId), eq(users.tenantId, tenantId)))
    .where(
      and(
        eq(pharmacyFneLedger.tenantId, tenantId),
        eq(pharmacyFneLedger.siteId, siteId),
        gte(pharmacyFneLedger.businessDate, fromDate),
        lte(pharmacyFneLedger.businessDate, toDate)
      )
    )
    .orderBy(
      asc(pharmacyFneLedger.businessDate),
      asc(pharmacyFneLedger.occurredAt),
      asc(sql`${pharmacyFneLedger}.rowid`)
    )
    .all();

  const entries = rawEntries.map(({ retainedFormulaDigest, ...publicEntry }) => ({
    ...publicEntry,
    hasRetainedFormula: Boolean(retainedFormulaDigest),
  }));

  const priorRows = db
    .select({
      productId: pharmacyFneLedger.productId,
      netPrior: sql<number>`coalesce(sum(${pharmacyFneLedger.quantityDelta}), 0)`,
    })
    .from(pharmacyFneLedger)
    .where(
      and(
        eq(pharmacyFneLedger.tenantId, tenantId),
        eq(pharmacyFneLedger.siteId, siteId),
        sql`${pharmacyFneLedger.businessDate} < ${fromDate}`
      )
    )
    .groupBy(pharmacyFneLedger.productId)
    .all();
  const priorByProduct = new Map(priorRows.map(r => [r.productId, Number(r.netPrior ?? 0)]));

  const summary = controlledProducts.map(med => {
    const medEntries = entries.filter(e => e.productId === med.productId);
    let receipts = 0;
    let supplierReturns = 0;
    let dispensations = 0;
    let returns = 0;
    let destructions = 0;
    let fractionationsNet = 0;
    let transfersNet = 0;
    let adjustmentsNet = 0;
    let openingInMonth = 0;
    const add = (total: number, delta: number) => roundQuantity(total + delta, 12);
    for (const row of medEntries) {
      const delta = row.quantityDelta;
      switch (row.movementType) {
        case 'receipt':
          receipts = add(receipts, delta);
          break;
        case 'supplier_return':
          supplierReturns = add(supplierReturns, -delta);
          break;
        case 'dispensation':
          dispensations = add(dispensations, -delta);
          break;
        case 'return':
          returns = add(returns, delta);
          break;
        case 'destruction':
          destructions = add(destructions, -delta);
          break;
        case 'fractionation_in':
        case 'fractionation_out':
          fractionationsNet = add(fractionationsNet, delta);
          break;
        case 'transfer_in':
        case 'transfer_out':
          transfersNet = add(transfersNet, delta);
          break;
        case 'opening_balance':
          openingInMonth = add(openingInMonth, delta);
          break;
        case 'count_adjustment':
        case 'reconciliation':
          adjustmentsNet = add(adjustmentsNet, delta);
          break;
      }
    }
    const openingBalance = roundQuantity(
      (priorByProduct.get(med.productId) ?? 0) + openingInMonth,
      12
    );
    const closingBalance = roundQuantity(
      openingBalance +
        receipts -
        supplierReturns -
        dispensations +
        returns -
        destructions +
        fractionationsNet +
        transfersNet +
        adjustmentsNet,
      12
    );
    return {
      productId: med.productId,
      name: med.name,
      sku: med.sku,
      activeIngredient: med.activeIngredient,
      concentration: med.concentration,
      dosageForm: med.dosageForm,
      sanitaryRegistration: med.sanitaryRegistration,
      cumCode: med.cumCode,
      openingBalance,
      receipts,
      supplierReturns,
      dispensations,
      returns,
      destructions,
      fractionationsNet,
      transfersNet,
      adjustmentsNet,
      closingBalance,
    };
  });

  return {
    month: input.month,
    fromDate,
    toDate,
    siteName: site?.name ?? siteId,
    activeAuthorization,
    summary,
    entries,
  };
}
