import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  companies,
  pharmacyEnvironmentalLogs,
  sites,
  users,
  type PharmacyEnvironmentalZone,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import type {
  GetPharmacyEnvironmentalReportInput,
  ListPharmacyEnvironmentalLogsInput,
  RecordPharmacyEnvironmentalLogInput,
} from '../../trpc/schemas/pharmacy.js';
import { clampPharmacyPage, type CriticalPharmacyContext } from './types.js';

/** Default Res. 1403/2007 (Colombia) environmental thresholds by storage zone. */
export const RES_1403_ENVIRONMENTAL_DEFAULTS: Record<
  PharmacyEnvironmentalZone,
  { minTempC: number; maxTempC: number; maxHumidityPercent: number | null }
> = {
  ambient: { minTempC: 15, maxTempC: 30, maxHumidityPercent: 70 },
  refrigerator: { minTempC: 2, maxTempC: 8, maxHumidityPercent: null },
};

export function evaluateEnvironmentalRange(input: {
  temperatureC: number;
  humidityPercent: number | null;
  minTempC: number;
  maxTempC: number;
  maxHumidityPercent: number | null;
}): { isOutOfRange: boolean; reasons: Array<'temp_low' | 'temp_high' | 'humidity_high'> } {
  const reasons: Array<'temp_low' | 'temp_high' | 'humidity_high'> = [];
  if (input.temperatureC < input.minTempC) reasons.push('temp_low');
  if (input.temperatureC > input.maxTempC) reasons.push('temp_high');
  if (
    input.humidityPercent !== null &&
    input.maxHumidityPercent !== null &&
    input.humidityPercent > input.maxHumidityPercent
  ) {
    reasons.push('humidity_high');
  }
  return { isOutOfRange: reasons.length > 0, reasons };
}

export async function recordPharmacyEnvironmentalLog(
  ctx: CriticalPharmacyContext,
  input: RecordPharmacyEnvironmentalLogInput
) {
  const siteId = input.siteId ?? ctx.siteId;
  if (!siteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_SITE_REQUIRED',
      message: 'Select an active site before recording environmental readings',
    });
  }

  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  // Readings are always for today and judged against the Res. 1403 limits, never client-supplied ones.
  const businessDate = clock.businessDate;
  const { minTempC, maxTempC, maxHumidityPercent } = RES_1403_ENVIRONMENTAL_DEFAULTS[input.zone];
  const humidityPercent = input.humidityPercent ?? null;

  if (input.zone === 'ambient' && humidityPercent === null) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_ENVIRONMENTAL_INVALID',
      message: 'Relative humidity is required for ambient storage readings (Res. 1403/2007)',
    });
  }

  const evaluation = evaluateEnvironmentalRange({
    temperatureC: input.temperatureC,
    humidityPercent,
    minTempC,
    maxTempC,
    maxHumidityPercent,
  });
  if (evaluation.isOutOfRange && !input.correctiveAction) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_ENVIRONMENTAL_CORRECTIVE_ACTION_REQUIRED',
      message: 'An out-of-range reading requires a corrective action',
      details: { reasons: evaluation.reasons },
    });
  }
  const id = nanoid();

  return ctx.db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
      const site = tx
        .select({ id: sites.id })
        .from(sites)
        .where(
          and(eq(sites.id, siteId), eq(sites.tenantId, ctx.tenantId), eq(sites.isActive, true))
        )
        .get();
      if (!site) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'AUTHORITY_SITE_NOT_FOUND',
          message: 'Active site not found for this tenant',
        });
      }

      tx.insert(pharmacyEnvironmentalLogs)
        .values({
          id,
          tenantId: ctx.tenantId,
          siteId,
          businessDate,
          period: input.period,
          zone: input.zone,
          temperatureC: input.temperatureC,
          humidityPercent,
          minTempC,
          maxTempC,
          maxHumidityPercent,
          isOutOfRange: evaluation.isOutOfRange,
          correctiveAction: input.correctiveAction?.trim() || null,
          instrumentCode: input.instrumentCode?.trim() || null,
          notes: input.notes?.trim() || null,
          recordedBy: ctx.user.id,
          recordedAt: clock.nowIso,
          createdAt: clock.nowIso,
        })
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.environmental_log.record',
        resourceType: 'pharmacy_environmental_log',
        resourceId: id,
        after: {
          siteId,
          businessDate,
          period: input.period,
          zone: input.zone,
          temperatureC: input.temperatureC,
          humidityPercent,
          isOutOfRange: evaluation.isOutOfRange,
          deviationReasons: evaluation.reasons,
        },
        operationId: ctx.envelope.operationId,
      });

      const result = {
        id,
        siteId,
        businessDate,
        period: input.period,
        zone: input.zone,
        temperatureC: input.temperatureC,
        humidityPercent,
        minTempC,
        maxTempC,
        maxHumidityPercent,
        isOutOfRange: evaluation.isOutOfRange,
        deviationReasons: evaluation.reasons,
        recordedAt: clock.nowIso,
      };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function listPharmacyEnvironmentalLogs(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  input: ListPharmacyEnvironmentalLogsInput
) {
  const where = and(
    eq(pharmacyEnvironmentalLogs.tenantId, tenantId),
    eq(pharmacyEnvironmentalLogs.siteId, siteId),
    input.fromDate ? gte(pharmacyEnvironmentalLogs.businessDate, input.fromDate) : undefined,
    input.toDate ? lte(pharmacyEnvironmentalLogs.businessDate, input.toDate) : undefined,
    input.zone ? eq(pharmacyEnvironmentalLogs.zone, input.zone) : undefined,
    input.onlyDeviations ? eq(pharmacyEnvironmentalLogs.isOutOfRange, true) : undefined
  );

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(pharmacyEnvironmentalLogs)
    .where(where)
    .get();
  const total = Number(totalRow?.count ?? 0);
  const perPage = input.perPage;
  const page = clampPharmacyPage(total, perPage, input.page);
  const offset = (page - 1) * perPage;

  const items = db
    .select({
      id: pharmacyEnvironmentalLogs.id,
      siteId: pharmacyEnvironmentalLogs.siteId,
      businessDate: pharmacyEnvironmentalLogs.businessDate,
      period: pharmacyEnvironmentalLogs.period,
      zone: pharmacyEnvironmentalLogs.zone,
      temperatureC: pharmacyEnvironmentalLogs.temperatureC,
      humidityPercent: pharmacyEnvironmentalLogs.humidityPercent,
      minTempC: pharmacyEnvironmentalLogs.minTempC,
      maxTempC: pharmacyEnvironmentalLogs.maxTempC,
      maxHumidityPercent: pharmacyEnvironmentalLogs.maxHumidityPercent,
      isOutOfRange: pharmacyEnvironmentalLogs.isOutOfRange,
      correctiveAction: pharmacyEnvironmentalLogs.correctiveAction,
      instrumentCode: pharmacyEnvironmentalLogs.instrumentCode,
      notes: pharmacyEnvironmentalLogs.notes,
      recordedByName: users.name,
      recordedAt: pharmacyEnvironmentalLogs.recordedAt,
    })
    .from(pharmacyEnvironmentalLogs)
    .innerJoin(
      users,
      and(eq(users.id, pharmacyEnvironmentalLogs.recordedBy), eq(users.tenantId, tenantId))
    )
    .where(where)
    .orderBy(
      desc(pharmacyEnvironmentalLogs.businessDate),
      desc(pharmacyEnvironmentalLogs.recordedAt)
    )
    .limit(perPage)
    .offset(offset)
    .all();

  return { items, total, page, perPage };
}

export function getPharmacyEnvironmentalReport(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  input: GetPharmacyEnvironmentalReportInput
) {
  const site = db
    .select({ id: sites.id, name: sites.name, companyId: sites.companyId })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .get();
  const company = site
    ? db
        .select({ name: companies.name, taxId: companies.taxId })
        .from(companies)
        .where(and(eq(companies.id, site.companyId), eq(companies.tenantId, tenantId)))
        .get()
    : null;

  const readings = db
    .select({
      id: pharmacyEnvironmentalLogs.id,
      businessDate: pharmacyEnvironmentalLogs.businessDate,
      period: pharmacyEnvironmentalLogs.period,
      zone: pharmacyEnvironmentalLogs.zone,
      temperatureC: pharmacyEnvironmentalLogs.temperatureC,
      humidityPercent: pharmacyEnvironmentalLogs.humidityPercent,
      minTempC: pharmacyEnvironmentalLogs.minTempC,
      maxTempC: pharmacyEnvironmentalLogs.maxTempC,
      maxHumidityPercent: pharmacyEnvironmentalLogs.maxHumidityPercent,
      isOutOfRange: pharmacyEnvironmentalLogs.isOutOfRange,
      correctiveAction: pharmacyEnvironmentalLogs.correctiveAction,
      instrumentCode: pharmacyEnvironmentalLogs.instrumentCode,
      notes: pharmacyEnvironmentalLogs.notes,
      recordedByName: users.name,
      recordedAt: pharmacyEnvironmentalLogs.recordedAt,
    })
    .from(pharmacyEnvironmentalLogs)
    .innerJoin(
      users,
      and(eq(users.id, pharmacyEnvironmentalLogs.recordedBy), eq(users.tenantId, tenantId))
    )
    .where(
      and(
        eq(pharmacyEnvironmentalLogs.tenantId, tenantId),
        eq(pharmacyEnvironmentalLogs.siteId, siteId),
        gte(pharmacyEnvironmentalLogs.businessDate, input.fromDate),
        lte(pharmacyEnvironmentalLogs.businessDate, input.toDate),
        input.zone ? eq(pharmacyEnvironmentalLogs.zone, input.zone) : undefined
      )
    )
    .orderBy(asc(pharmacyEnvironmentalLogs.businessDate), asc(pharmacyEnvironmentalLogs.recordedAt))
    .all();

  const summarizeZone = (zone: PharmacyEnvironmentalZone) => {
    const zoneRows = readings.filter(r => r.zone === zone);
    const temps = zoneRows.map(r => r.temperatureC);
    const humidities = zoneRows.map(r => r.humidityPercent).filter((h): h is number => h !== null);
    return {
      count: zoneRows.length,
      deviations: zoneRows.filter(r => r.isOutOfRange).length,
      minTempC: temps.length > 0 ? Math.min(...temps) : null,
      maxTempC: temps.length > 0 ? Math.max(...temps) : null,
      maxHumidityPercent: humidities.length > 0 ? Math.max(...humidities) : null,
      morningCount: zoneRows.filter(r => r.period === 'morning').length,
      afternoonCount: zoneRows.filter(r => r.period === 'afternoon').length,
    };
  };

  return {
    standard: 'Resolución 1403 de 2007 (Colombia)',
    fromDate: input.fromDate,
    toDate: input.toDate,
    siteName: site?.name ?? siteId,
    companyName: company?.name ?? null,
    companyTaxId: company?.taxId ?? null,
    totalReadings: readings.length,
    deviationCount: readings.filter(r => r.isOutOfRange).length,
    ambient: summarizeZone('ambient'),
    refrigerator: summarizeZone('refrigerator'),
    readings,
  };
}
