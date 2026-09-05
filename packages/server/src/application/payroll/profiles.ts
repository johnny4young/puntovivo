/** Administrator-only effective payroll profile ledger with append-only private history. */
import { and, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { z } from 'zod';
import type { DatabaseInstance } from '../../db/index.js';
import {
  payrollEmployeeProfileEvents,
  payrollEmployeeProfiles,
  sites,
  users,
  type PayrollEmployeeProfile,
  type PayrollEmployeeProfileSnapshot,
} from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { resolveTenantBusinessClock } from '../../services/pharmacy/business-clock.js';
import type { WorkforceCommandContext } from '../workforce/writer.js';
import { withPayrollWriter } from '../workforce/writer.js';
import {
  createPayrollProfileInput,
  endPayrollProfileInput,
  replacePayrollProfileInput,
  voidPayrollProfileInput,
  type PayrollEmployeeProfileTerms,
  type PayrollProfileTarget,
} from '../../trpc/schemas/payroll.js';
import { denyPayroll } from './errors.js';

/** Bounded command replay result; no identity, account or entity data enters the journal. */
type PayrollProfileResult = { id: string; siteId: string; version: number };

function requireCountry(countryCode: string): void {
  if (countryCode !== 'CO') denyPayroll('country');
}

function assertProfileTerms(
  tx: DatabaseInstance,
  tenantId: string,
  profile: PayrollEmployeeProfileTerms,
  excludingId?: string
): void {
  const employee = tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.tenantId, tenantId), eq(users.id, profile.userId), eq(users.isActive, true))
    )
    .get();
  const site = tx
    .select({ id: sites.id })
    .from(sites)
    .where(
      and(eq(sites.tenantId, tenantId), eq(sites.id, profile.siteId), eq(sites.isActive, true))
    )
    .get();
  if (!employee || !site) denyPayroll('not_found');
  const overlap = tx
    .select({ id: payrollEmployeeProfiles.id })
    .from(payrollEmployeeProfiles)
    .where(
      and(
        eq(payrollEmployeeProfiles.tenantId, tenantId),
        eq(payrollEmployeeProfiles.userId, profile.userId),
        isNull(payrollEmployeeProfiles.voidedAt),
        or(
          isNull(payrollEmployeeProfiles.effectiveUntil),
          gt(payrollEmployeeProfiles.effectiveUntil, profile.effectiveFrom)
        ),
        ...(profile.effectiveUntil === null
          ? []
          : [lt(payrollEmployeeProfiles.effectiveFrom, profile.effectiveUntil)]),
        ...(excludingId ? [ne(payrollEmployeeProfiles.id, excludingId)] : [])
      )
    )
    .get();
  if (overlap) denyPayroll('profile_overlap');
}

function requireProfile(
  tx: DatabaseInstance,
  tenantId: string,
  input: PayrollProfileTarget
): PayrollEmployeeProfile {
  const site = tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.id, input.siteId)))
    .get();
  if (!site) denyPayroll('not_found');
  const row = tx
    .select()
    .from(payrollEmployeeProfiles)
    .where(
      and(
        eq(payrollEmployeeProfiles.tenantId, tenantId),
        eq(payrollEmployeeProfiles.siteId, input.siteId),
        eq(payrollEmployeeProfiles.id, input.id)
      )
    )
    .get();
  if (!row) denyPayroll('not_found');
  if (row.version !== input.expectedVersion) denyPayroll('version');
  if (row.voidedAt !== null) denyPayroll('state');
  return row;
}

function snapshot(row: PayrollEmployeeProfile): PayrollEmployeeProfileSnapshot {
  return {
    userId: row.userId,
    siteId: row.siteId,
    countryCode: row.countryCode,
    identificationType: row.identificationType,
    identificationNumber: row.identificationNumber,
    contributorType: row.contributorType,
    contributorSubtype: row.contributorSubtype,
    contractKind: row.contractKind,
    integralSalary: row.integralSalary,
    arlRiskClass: row.arlRiskClass,
    healthEntity: row.healthEntity,
    pensionEntity: row.pensionEntity,
    compensationFund: row.compensationFund,
    transportAssistanceEligible: row.transportAssistanceEligible,
    paymentMethod: row.paymentMethod,
    paymentAccountLast4: row.paymentAccountLast4,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    version: row.version,
    voidedAt: row.voidedAt,
  };
}

function recordProfile(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  row: PayrollEmployeeProfile,
  before: PayrollEmployeeProfile | null,
  kind: typeof payrollEmployeeProfileEvents.$inferInsert.kind,
  reason: string
): void {
  tx.insert(payrollEmployeeProfileEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      profileId: row.id,
      version: row.version,
      kind,
      actorId: ctx.user.id,
      operationId: ctx.envelope.operationId,
      reason,
      before: before ? snapshot(before) : null,
      after: snapshot(row),
      createdAt: row.updatedAt,
    })
    .run();
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    operationId: ctx.envelope.operationId,
    action: 'payroll_profile.changed',
    resourceType: 'payroll_profile',
    resourceId: row.id,
    before: before ? { version: before.version } : null,
    after: { version: row.version, siteId: row.siteId, kind },
  });
}

function insertProfile(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  profile: PayrollEmployeeProfileTerms,
  reason: string,
  predecessorId: string | null = null
): PayrollEmployeeProfile {
  const now = new Date().toISOString();
  const row = tx
    .insert(payrollEmployeeProfiles)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      ...profile,
      predecessorId,
      createdByUserId: ctx.user.id,
      updatedByUserId: ctx.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()!;
  recordProfile(tx, ctx, row, null, 'created', reason);
  return row;
}

function changeProfile(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  before: PayrollEmployeeProfile,
  changes: { effectiveUntil?: string; voidedAt?: string },
  kind: 'ended' | 'replaced' | 'voided',
  reason: string
): PayrollEmployeeProfile {
  const row = tx
    .update(payrollEmployeeProfiles)
    .set({
      ...changes,
      version: before.version + 1,
      updatedByUserId: ctx.user.id,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(payrollEmployeeProfiles.tenantId, ctx.tenantId),
        eq(payrollEmployeeProfiles.id, before.id),
        eq(payrollEmployeeProfiles.version, before.version),
        isNull(payrollEmployeeProfiles.voidedAt)
      )
    )
    .returning()
    .get();
  if (!row) denyPayroll('version');
  recordProfile(tx, ctx, row, before, kind, reason);
  return row;
}

function finishProfile(
  ctx: WorkforceCommandContext,
  tx: DatabaseInstance,
  row: PayrollEmployeeProfile
): PayrollProfileResult {
  const result = { id: row.id, siteId: row.siteId, version: row.version };
  ctx.completeInTransaction(tx, result);
  return result;
}

export async function createPayrollProfile(
  ctx: WorkforceCommandContext,
  raw: z.input<typeof createPayrollProfileInput>
): Promise<PayrollProfileResult> {
  const input = createPayrollProfileInput.parse(raw);
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  requireCountry(clock.countryCode);
  return withPayrollWriter(
    ctx,
    tx => {
      assertProfileTerms(tx, ctx.tenantId, input.profile);
      return finishProfile(ctx, tx, insertProfile(tx, ctx, input.profile, input.reason));
    },
    clock
  );
}

export async function endPayrollProfile(
  ctx: WorkforceCommandContext,
  raw: z.input<typeof endPayrollProfileInput>
): Promise<PayrollProfileResult> {
  const input = endPayrollProfileInput.parse(raw);
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  requireCountry(clock.countryCode);
  return withPayrollWriter(
    ctx,
    tx => {
      const before = requireProfile(tx, ctx.tenantId, input);
      if (
        input.effectiveUntil <= before.effectiveFrom ||
        (before.effectiveUntil !== null && input.effectiveUntil >= before.effectiveUntil)
      )
        denyPayroll('state');
      return finishProfile(
        ctx,
        tx,
        changeProfile(
          tx,
          ctx,
          before,
          { effectiveUntil: input.effectiveUntil },
          'ended',
          input.reason
        )
      );
    },
    clock
  );
}

export async function replacePayrollProfile(
  ctx: WorkforceCommandContext,
  raw: z.input<typeof replacePayrollProfileInput>
): Promise<PayrollProfileResult> {
  const input = replacePayrollProfileInput.parse(raw);
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  requireCountry(clock.countryCode);
  return withPayrollWriter(
    ctx,
    tx => {
      const before = requireProfile(tx, ctx.tenantId, input);
      if (
        input.profile.userId !== before.userId ||
        input.profile.effectiveFrom <= before.effectiveFrom ||
        (before.effectiveUntil !== null && input.profile.effectiveFrom >= before.effectiveUntil) ||
        input.profile.effectiveUntil !== before.effectiveUntil
      )
        denyPayroll('state');
      assertProfileTerms(tx, ctx.tenantId, input.profile, before.id);
      changeProfile(
        tx,
        ctx,
        before,
        { effectiveUntil: input.profile.effectiveFrom },
        'replaced',
        input.reason
      );
      return finishProfile(ctx, tx, insertProfile(tx, ctx, input.profile, input.reason, before.id));
    },
    clock
  );
}

export async function voidPayrollProfile(
  ctx: WorkforceCommandContext,
  raw: z.input<typeof voidPayrollProfileInput>
): Promise<PayrollProfileResult> {
  const input = voidPayrollProfileInput.parse(raw);
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  requireCountry(clock.countryCode);
  return withPayrollWriter(
    ctx,
    tx => {
      const before = requireProfile(tx, ctx.tenantId, input);
      return finishProfile(
        ctx,
        tx,
        changeProfile(tx, ctx, before, { voidedAt: clock.nowIso }, 'voided', input.reason)
      );
    },
    clock
  );
}
