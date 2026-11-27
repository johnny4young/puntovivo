import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { roundQuantity } from '@puntovivo/shared/unit-math';

import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryBalances,
  pharmacyFneAuthorizations,
  pharmacyFneLedger,
  pharmacyProductProfiles,
  pharmacyProfessionalAuthorizations,
  products,
  sites,
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
  const rows = db
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
    .innerJoin(
      pharmacyProfessionalAuthorizations,
      and(
        eq(pharmacyProfessionalAuthorizations.tenantId, input.tenantId),
        eq(pharmacyProfessionalAuthorizations.userId, pharmacyFneAuthorizations.responsibleUserId),
        eq(pharmacyProfessionalAuthorizations.countryCode, input.countryCode),
        eq(pharmacyProfessionalAuthorizations.status, 'active'),
        sql`${pharmacyProfessionalAuthorizations.validFrom} <= ${input.businessDate}`,
        or(
          isNull(pharmacyProfessionalAuthorizations.validUntil),
          sql`${pharmacyProfessionalAuthorizations.validUntil} >= ${input.businessDate}`
        )
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
    .orderBy(desc(pharmacyFneAuthorizations.createdAt))
    .limit(1)
    .all();

  return rows[0] ?? null;
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

      const hasProfAuth = tx
        .select({ id: pharmacyProfessionalAuthorizations.id })
        .from(pharmacyProfessionalAuthorizations)
        .where(
          and(
            eq(pharmacyProfessionalAuthorizations.tenantId, ctx.tenantId),
            eq(pharmacyProfessionalAuthorizations.userId, input.responsibleUserId),
            eq(pharmacyProfessionalAuthorizations.countryCode, input.countryCode),
            eq(pharmacyProfessionalAuthorizations.status, 'active')
          )
        )
        .get();
      if (!hasProfAuth) {
        throwServerError({
          trpcCode: 'PRECONDITION_FAILED',
          errorCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE',
          message:
            'Responsible pharmacist must hold an active professional authorization before enabling FNE',
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
    input.siteId ? eq(pharmacyFneAuthorizations.siteId, input.siteId) : undefined
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

export function appendFneLedgerEntry(
  tx: DatabaseInstance,
  entry: {
    tenantId: string;
    siteId: string;
    productId: string;
    lotId?: string | null;
    lotNumber?: string | null;
    businessDate: string;
    movementType: PharmacyFneMovementType;
    quantityDelta: number;
    fneAuthorizationId?: string | null;
    saleId?: string | null;
    evidenceId?: string | null;
    retainedFormulaDigest?: string | null;
    actorId: string;
    notes?: string | null;
    occurredAt: string;
  }
): string {
  const balance = tx
    .select({ onHand: inventoryBalances.onHand })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.tenantId, entry.tenantId),
        eq(inventoryBalances.siteId, entry.siteId),
        eq(inventoryBalances.productId, entry.productId)
      )
    )
    .get();
  const balanceAfter = Math.max(0, roundQuantity(balance?.onHand ?? 0, 12));
  const id = nanoid();
  tx.insert(pharmacyFneLedger)
    .values({
      id,
      tenantId: entry.tenantId,
      siteId: entry.siteId,
      productId: entry.productId,
      lotId: entry.lotId ?? null,
      lotNumber: entry.lotNumber ?? null,
      businessDate: entry.businessDate,
      movementType: entry.movementType,
      quantityDelta: roundQuantity(entry.quantityDelta, 12),
      balanceAfter,
      fneAuthorizationId: entry.fneAuthorizationId ?? null,
      saleId: entry.saleId ?? null,
      evidenceId: entry.evidenceId ?? null,
      retainedFormulaDigest: entry.retainedFormulaDigest ?? null,
      actorId: entry.actorId,
      notes: entry.notes ?? null,
      occurredAt: entry.occurredAt,
      createdAt: entry.occurredAt,
    })
    .run();
  return id;
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

  const entries = db
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
      saleId: pharmacyFneLedger.saleId,
      evidenceId: pharmacyFneLedger.evidenceId,
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
    .orderBy(asc(pharmacyFneLedger.businessDate), asc(pharmacyFneLedger.occurredAt))
    .all();

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
    let dispensations = 0;
    let returns = 0;
    let destructions = 0;
    let fractionationsNet = 0;
    for (const row of medEntries) {
      if (row.movementType === 'receipt')
        receipts = roundQuantity(receipts + row.quantityDelta, 12);
      else if (row.movementType === 'dispensation')
        dispensations = roundQuantity(dispensations + Math.abs(row.quantityDelta), 12);
      else if (row.movementType === 'return')
        returns = roundQuantity(returns + row.quantityDelta, 12);
      else if (row.movementType === 'destruction')
        destructions = roundQuantity(destructions + Math.abs(row.quantityDelta), 12);
      else fractionationsNet = roundQuantity(fractionationsNet + row.quantityDelta, 12);
    }
    const openingBalance = Math.max(0, roundQuantity(priorByProduct.get(med.productId) ?? 0, 12));
    const netMonth = roundQuantity(
      receipts - dispensations + returns - destructions + fractionationsNet,
      12
    );
    const closingBalance =
      medEntries.length > 0
        ? medEntries[medEntries.length - 1]!.balanceAfter
        : Math.max(0, roundQuantity(med.currentStock ?? openingBalance + netMonth, 12));
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
      dispensations,
      returns,
      destructions,
      fractionationsNet,
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
