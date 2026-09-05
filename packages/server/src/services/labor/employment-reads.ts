/** Explicit projections keep compensation out of manager-facing assignment responses. */
import type { UserRole } from '@puntovivo/shared/roles';
import { and, desc, eq, gt, isNull, lt, lte, ne, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employmentContracts,
  employmentContractEvents,
  sites,
  users,
  tenants,
} from '../../db/schema.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import type {
  ListEmploymentAssignmentsInput,
  ListEmploymentContractsInput,
} from '../../trpc/schemas/workforce.js';

const assignmentSelection = {
  id: employmentContracts.id,
  userId: employmentContracts.userId,
  userName: users.name,
  userActive: users.isActive,
  siteId: employmentContracts.siteId,
  siteName: sites.name,
  siteActive: sites.isActive,
  position: employmentContracts.position,
  effectiveFrom: employmentContracts.effectiveFrom,
  effectiveUntil: employmentContracts.effectiveUntil,
  timeZone: employmentContracts.timeZone,
  version: employmentContracts.version,
} as const;

/** Read the same authoritative currency the writer validates, not a UI locale fallback. */
export async function getEmploymentContext(db: DatabaseInstance, tenantId: string) {
  const tenant = db
    .select({ currencyCode: tenants.defaultCurrencyCode })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.isActive, true)))
    .get();
  return tenant
    ? { ...tenant, timeZone: (await resolveTenantLocale(db, tenantId)).timezone }
    : null;
}

function pageConditions(tenantId: string, input: ListEmploymentContractsInput) {
  return and(
    eq(employmentContracts.tenantId, tenantId),
    ...(input.includeVoided ? [] : [isNull(employmentContracts.voidedAt)]),
    ...(input.siteId ? [eq(employmentContracts.siteId, input.siteId)] : []),
    ...(input.userId ? [eq(employmentContracts.userId, input.userId)] : []),
    ...(input.onDate
      ? [
          lte(employmentContracts.effectiveFrom, input.onDate),
          or(
            isNull(employmentContracts.effectiveUntil),
            gt(employmentContracts.effectiveUntil, input.onDate)
          ),
        ]
      : []),
    ...(input.cursor
      ? [
          or(
            lt(employmentContracts.effectiveFrom, input.cursor.effectiveFrom),
            and(
              eq(employmentContracts.effectiveFrom, input.cursor.effectiveFrom),
              lt(employmentContracts.id, input.cursor.id)
            )
          ),
        ]
      : [])
  );
}

function page<T extends { id: string; effectiveFrom: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last ? { effectiveFrom: last.effectiveFrom, id: last.id } : null,
  };
}

export function listEmploymentAssignments(
  db: DatabaseInstance,
  tenantId: string,
  actorRole: UserRole,
  input: ListEmploymentAssignmentsInput
) {
  const rows = db
    .select(assignmentSelection)
    .from(employmentContracts)
    .innerJoin(users, and(eq(users.id, employmentContracts.userId), eq(users.tenantId, tenantId)))
    .innerJoin(sites, and(eq(sites.id, employmentContracts.siteId), eq(sites.tenantId, tenantId)))
    .where(
      and(
        pageConditions(tenantId, { ...input, includeVoided: false }),
        // A reporting-only access role can still have employment terms. Job
        // membership never grants login privileges; managers cannot inspect admins.
        ...(actorRole === 'admin' ? [] : [ne(users.role, 'admin')])
      )
    )
    .orderBy(desc(employmentContracts.effectiveFrom), desc(employmentContracts.id))
    .limit(input.limit + 1)
    .all();
  return page(rows, input.limit);
}

export function listEmploymentContracts(
  db: DatabaseInstance,
  tenantId: string,
  input: ListEmploymentContractsInput
) {
  const rows = db
    .select({
      ...assignmentSelection,
      currencyCode: employmentContracts.currencyCode,
      payBasis: employmentContracts.payBasis,
      payAmount: employmentContracts.payAmount,
      costingHourlyRate: employmentContracts.costingHourlyRate,
      predecessorId: employmentContracts.predecessorId,
      voidedAt: employmentContracts.voidedAt,
    })
    .from(employmentContracts)
    .innerJoin(users, and(eq(users.id, employmentContracts.userId), eq(users.tenantId, tenantId)))
    .innerJoin(sites, and(eq(sites.id, employmentContracts.siteId), eq(sites.tenantId, tenantId)))
    .where(pageConditions(tenantId, input))
    .orderBy(desc(employmentContracts.effectiveFrom), desc(employmentContracts.id))
    .limit(input.limit + 1)
    .all();
  return page(rows, input.limit);
}

export function getEmploymentContract(
  db: DatabaseInstance,
  tenantId: string,
  input: { id: string; siteId: string }
) {
  return db
    .select()
    .from(employmentContracts)
    .where(
      and(
        eq(employmentContracts.tenantId, tenantId),
        eq(employmentContracts.siteId, input.siteId),
        eq(employmentContracts.id, input.id)
      )
    )
    .get();
}

export function listEmploymentContractEvents(
  db: DatabaseInstance,
  tenantId: string,
  input: { id: string; siteId: string; beforeVersion?: number | undefined; limit: number }
) {
  const rows = db
    .select()
    .from(employmentContractEvents)
    .where(
      and(
        eq(employmentContractEvents.tenantId, tenantId),
        eq(employmentContractEvents.siteId, input.siteId),
        eq(employmentContractEvents.contractId, input.id),
        ...(input.beforeVersion ? [lt(employmentContractEvents.version, input.beforeVersion)] : [])
      )
    )
    .orderBy(desc(employmentContractEvents.version))
    .limit(input.limit + 1)
    .all();
  const items = rows.slice(0, input.limit);
  return { items, nextBeforeVersion: rows.length > input.limit ? items.at(-1)!.version : null };
}
