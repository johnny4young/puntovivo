/** Administrator-only private pre-payroll projections with bounded keyset pagination. */
import {
  and,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import type { z } from 'zod';
import type { DatabaseInstance } from '../../db/index.js';
import {
  payrollConceptLines,
  payrollEmployeeProfileEvents,
  payrollEmployeeProfiles,
  payrollEmployeeResults,
  payrollPeriods,
  payrollResultSources,
  payrollRunEvents,
  payrollRunRevisions,
  payrollRuns,
  sites,
  users,
} from '../../db/schema.js';
import {
  getPayrollPeriodInput,
  getPayrollProfileInput,
  getPayrollRunInput,
  getPayrollRunRevisionInput,
  listPayrollPeriodsInput,
  listPayrollProfileEventsInput,
  listPayrollProfilesInput,
  listPayrollRunsInput,
} from '../../trpc/schemas/payroll.js';
import { denyPayroll } from '../../application/payroll/errors.js';

/** Keyset page shape shared by private payroll list views. */
export interface PayrollReadPage<T, C> {
  items: T[];
  nextCursor: C | null;
}

export function listPayrollProfiles(
  db: DatabaseInstance,
  tenantId: string,
  raw: z.input<typeof listPayrollProfilesInput>
) {
  const input = listPayrollProfilesInput.parse(raw);
  const filters: SQL[] = [eq(payrollEmployeeProfiles.tenantId, tenantId)];
  if (input.siteId) filters.push(eq(payrollEmployeeProfiles.siteId, input.siteId));
  if (input.userId) filters.push(eq(payrollEmployeeProfiles.userId, input.userId));
  if (!input.includeVoided) filters.push(isNull(payrollEmployeeProfiles.voidedAt));
  if (input.onDate) {
    filters.push(lte(payrollEmployeeProfiles.effectiveFrom, input.onDate));
    filters.push(
      or(
        isNull(payrollEmployeeProfiles.effectiveUntil),
        gt(payrollEmployeeProfiles.effectiveUntil, input.onDate)
      )!
    );
  }
  if (input.cursor) {
    filters.push(
      or(
        lt(payrollEmployeeProfiles.effectiveFrom, input.cursor.effectiveFrom),
        and(
          eq(payrollEmployeeProfiles.effectiveFrom, input.cursor.effectiveFrom),
          lt(payrollEmployeeProfiles.id, input.cursor.id)
        )
      )!
    );
  }
  const rows = db
    .select({
      ...getTableColumns(payrollEmployeeProfiles),
      userName: users.name,
      userActive: users.isActive,
      siteName: sites.name,
      siteActive: sites.isActive,
    })
    .from(payrollEmployeeProfiles)
    .innerJoin(
      users,
      and(
        eq(users.tenantId, payrollEmployeeProfiles.tenantId),
        eq(users.id, payrollEmployeeProfiles.userId)
      )
    )
    .innerJoin(
      sites,
      and(
        eq(sites.tenantId, payrollEmployeeProfiles.tenantId),
        eq(sites.id, payrollEmployeeProfiles.siteId)
      )
    )
    .where(and(...filters))
    .orderBy(desc(payrollEmployeeProfiles.effectiveFrom), desc(payrollEmployeeProfiles.id))
    .limit(input.limit + 1)
    .all();
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { effectiveFrom: last.effectiveFrom, id: last.id } : null,
  };
}

export function getPayrollProfile(
  db: DatabaseInstance,
  tenantId: string,
  raw: z.input<typeof getPayrollProfileInput>
) {
  const input = getPayrollProfileInput.parse(raw);
  const row = db
    .select({
      ...getTableColumns(payrollEmployeeProfiles),
      userName: users.name,
      userActive: users.isActive,
      siteName: sites.name,
      siteActive: sites.isActive,
    })
    .from(payrollEmployeeProfiles)
    .innerJoin(
      users,
      and(
        eq(users.tenantId, payrollEmployeeProfiles.tenantId),
        eq(users.id, payrollEmployeeProfiles.userId)
      )
    )
    .innerJoin(
      sites,
      and(
        eq(sites.tenantId, payrollEmployeeProfiles.tenantId),
        eq(sites.id, payrollEmployeeProfiles.siteId)
      )
    )
    .where(
      and(
        eq(payrollEmployeeProfiles.tenantId, tenantId),
        eq(payrollEmployeeProfiles.siteId, input.siteId),
        eq(payrollEmployeeProfiles.id, input.id)
      )
    )
    .get();
  if (!row) denyPayroll('not_found');
  return row;
}

export function listPayrollProfileEvents(
  db: DatabaseInstance,
  tenantId: string,
  raw: z.input<typeof listPayrollProfileEventsInput>
) {
  const input = listPayrollProfileEventsInput.parse(raw);
  getPayrollProfile(db, tenantId, input);
  const filters: SQL[] = [
    eq(payrollEmployeeProfileEvents.tenantId, tenantId),
    eq(payrollEmployeeProfileEvents.profileId, input.id),
  ];
  if (input.beforeVersion !== undefined)
    filters.push(lt(payrollEmployeeProfileEvents.version, input.beforeVersion));
  const rows = db
    .select()
    .from(payrollEmployeeProfileEvents)
    .where(and(...filters))
    .orderBy(desc(payrollEmployeeProfileEvents.version))
    .limit(input.limit + 1)
    .all();
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  return {
    items,
    nextCursor: hasMore ? (items.at(-1)?.version ?? null) : null,
  };
}

export function listPayrollPeriods(
  db: DatabaseInstance,
  tenantId: string,
  raw: z.input<typeof listPayrollPeriodsInput>
): PayrollReadPage<typeof payrollPeriods.$inferSelect, { fromDate: string; id: string }> {
  const input = listPayrollPeriodsInput.parse(raw);
  const filters: SQL[] = [eq(payrollPeriods.tenantId, tenantId)];
  if (input.status) filters.push(eq(payrollPeriods.status, input.status));
  if (input.cursor) {
    filters.push(
      or(
        lt(payrollPeriods.fromDate, input.cursor.fromDate),
        and(
          eq(payrollPeriods.fromDate, input.cursor.fromDate),
          lt(payrollPeriods.id, input.cursor.id)
        )
      )!
    );
  }
  const rows = db
    .select()
    .from(payrollPeriods)
    .where(and(...filters))
    .orderBy(desc(payrollPeriods.fromDate), desc(payrollPeriods.id))
    .limit(input.limit + 1)
    .all();
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { fromDate: last.fromDate, id: last.id } : null,
  };
}

export function getPayrollPeriod(
  db: DatabaseInstance,
  tenantId: string,
  raw: z.input<typeof getPayrollPeriodInput>
) {
  const input = getPayrollPeriodInput.parse(raw);
  const row = db
    .select()
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.tenantId, tenantId), eq(payrollPeriods.id, input.id)))
    .get();
  if (!row) denyPayroll('not_found');
  return row;
}

export function listPayrollRuns(
  db: DatabaseInstance,
  tenantId: string,
  raw: z.input<typeof listPayrollRunsInput>
) {
  const input = listPayrollRunsInput.parse(raw);
  const filters: SQL[] = [eq(payrollRuns.tenantId, tenantId)];
  if (input.periodId) filters.push(eq(payrollRuns.periodId, input.periodId));
  if (input.status) filters.push(eq(payrollRuns.status, input.status));
  if (input.cursor) {
    filters.push(
      or(
        lt(payrollRuns.createdAt, input.cursor.createdAt),
        and(eq(payrollRuns.createdAt, input.cursor.createdAt), lt(payrollRuns.id, input.cursor.id))
      )!
    );
  }
  const rows = db
    .select({
      ...getTableColumns(payrollRuns),
      periodFromDate: payrollPeriods.fromDate,
      periodUntilDate: payrollPeriods.untilDate,
      periodPayDate: payrollPeriods.payDate,
      currencyCode: payrollPeriods.currencyCode,
    })
    .from(payrollRuns)
    .innerJoin(
      payrollPeriods,
      and(
        eq(payrollPeriods.tenantId, payrollRuns.tenantId),
        eq(payrollPeriods.id, payrollRuns.periodId)
      )
    )
    .where(and(...filters))
    .orderBy(desc(payrollRuns.createdAt), desc(payrollRuns.id))
    .limit(input.limit + 1)
    .all();
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export function getPayrollRun(
  db: DatabaseInstance,
  tenantId: string,
  raw: z.input<typeof getPayrollRunInput>
) {
  const input = getPayrollRunInput.parse(raw);
  const run = db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, input.runId)))
    .get();
  if (!run) denyPayroll('not_found');
  const period = getPayrollPeriod(db, tenantId, { id: run.periodId });
  const revisions = db
    .select()
    .from(payrollRunRevisions)
    .where(and(eq(payrollRunRevisions.tenantId, tenantId), eq(payrollRunRevisions.runId, run.id)))
    .orderBy(desc(payrollRunRevisions.revision))
    .limit(101)
    .all();
  const eventRows = db
    .select()
    .from(payrollRunEvents)
    .where(and(eq(payrollRunEvents.tenantId, tenantId), eq(payrollRunEvents.runId, run.id)))
    .orderBy(desc(payrollRunEvents.version))
    .limit(101)
    .all();
  return {
    run,
    period,
    revisions: revisions.slice(0, 100),
    revisionsTruncated: revisions.length > 100,
    events: eventRows.slice(0, 100),
    eventsTruncated: eventRows.length > 100,
  };
}

export function getPayrollRunRevision(
  db: DatabaseInstance,
  tenantId: string,
  raw: z.input<typeof getPayrollRunRevisionInput>
) {
  const input = getPayrollRunRevisionInput.parse(raw);
  const run = db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, input.runId)))
    .get();
  if (!run) denyPayroll('not_found');
  const revision = db
    .select()
    .from(payrollRunRevisions)
    .where(
      and(
        eq(payrollRunRevisions.tenantId, tenantId),
        eq(payrollRunRevisions.runId, run.id),
        eq(payrollRunRevisions.revision, input.revision)
      )
    )
    .get();
  if (!revision) denyPayroll('not_found');
  const filters: SQL[] = [
    eq(payrollEmployeeResults.tenantId, tenantId),
    eq(payrollEmployeeResults.revisionId, revision.id),
  ];
  if (input.cursor) {
    filters.push(
      or(
        gt(payrollEmployeeResults.userId, input.cursor.userId),
        and(
          eq(payrollEmployeeResults.userId, input.cursor.userId),
          gt(payrollEmployeeResults.id, input.cursor.id)
        )
      )!
    );
  }
  const rows = db
    .select({
      ...getTableColumns(payrollEmployeeResults),
      userName: users.name,
      userActive: users.isActive,
    })
    .from(payrollEmployeeResults)
    .innerJoin(
      users,
      and(
        eq(users.tenantId, payrollEmployeeResults.tenantId),
        eq(users.id, payrollEmployeeResults.userId)
      )
    )
    .where(and(...filters))
    .orderBy(payrollEmployeeResults.userId, payrollEmployeeResults.id)
    .limit(input.limit + 1)
    .all();
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  const ids = items.map(row => row.id);
  const concepts =
    ids.length === 0
      ? []
      : db
          .select()
          .from(payrollConceptLines)
          .where(
            and(
              eq(payrollConceptLines.tenantId, tenantId),
              inArray(payrollConceptLines.employeeResultId, ids)
            )
          )
          .all();
  const sources =
    ids.length === 0
      ? []
      : db
          .select()
          .from(payrollResultSources)
          .where(
            and(
              eq(payrollResultSources.tenantId, tenantId),
              inArray(payrollResultSources.employeeResultId, ids)
            )
          )
          .all();
  const conceptsByResult = new Map<string, typeof concepts>();
  for (const row of concepts) {
    const grouped = conceptsByResult.get(row.employeeResultId) ?? [];
    grouped.push(row);
    conceptsByResult.set(row.employeeResultId, grouped);
  }
  const sourcesByResult = new Map<string, typeof sources>();
  for (const row of sources) {
    const grouped = sourcesByResult.get(row.employeeResultId) ?? [];
    grouped.push(row);
    sourcesByResult.set(row.employeeResultId, grouped);
  }
  const last = items.at(-1);
  return {
    revision,
    employees: items.map(employee => ({
      ...employee,
      concepts: conceptsByResult.get(employee.id) ?? [],
      sources: sourcesByResult.get(employee.id) ?? [],
    })),
    nextCursor: hasMore && last ? { userId: last.userId, id: last.id } : null,
  };
}
