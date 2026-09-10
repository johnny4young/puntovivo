/** Append-only Colombia pre-payroll runs built from authoritative private evidence. */
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { z } from 'zod';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employmentContracts,
  payrollConceptLines,
  payrollEmployeeProfiles,
  payrollEmployeeResults,
  payrollPeriods,
  payrollResultSources,
  payrollRunEvents,
  payrollRunRevisions,
  payrollRuns,
  type EmploymentContractRow,
  type PayrollEmployeeProfileSnapshot,
  type PayrollEmployeeSourceSnapshot,
  type PayrollRun,
  type PayrollRunEventSnapshot,
  type PayrollSettlementReviewSnapshot,
} from '../../db/schema.js';
import { tryRoundMoneyToSafeCents } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { hashCanonicalInput } from '../../services/idempotency/keyHasher.js';
import {
  payrollPreparedSource,
  type PayrollPreparedAttendance,
  type PayrollPreparedSource,
} from '../../services/payroll/attendance.js';
import {
  freezePayrollContract,
  parsePayrollContractEvidence,
  type PayrollContractEvidence,
} from '../../services/payroll/contract-evidence.js';
import {
  calculateColombiaPrePayroll,
  type ColombiaPrePayrollBlockerCode,
  type ColombiaPrePayrollResult,
} from '../../services/payroll/calculator.js';
import {
  freezeColombiaPayrollPolicy,
  resolveColombiaPayrollPolicy,
  type ColombiaPayrollPolicy,
} from '../../services/payroll/policy.js';
import {
  getAdjustmentPayrollRunPreparation,
  prepareRegularPayrollRunAuthority,
  type RegularPayrollEmployeeAuthority,
} from '../../services/payroll/preparation.js';
import { resolveTenantBusinessClock } from '../../services/pharmacy/business-clock.js';
import { addCalendarDays } from '../../services/reports/day-window.js';
import {
  advancePayrollRunInput,
  createPayrollRunInput,
  recalculatePayrollRunInput,
  type PayrollEmployeeSettlementInput,
} from '../../trpc/schemas/payroll.js';
import type { WorkforceCommandContext } from '../workforce/writer.js';
import { withPayrollWriter } from '../workforce/writer.js';
import { denyPayroll } from './errors.js';

/** Minimal replay-safe run state; private employee and review evidence never enters the journal. */
export interface PayrollRunCommandResult {
  id: string;
  kind: 'regular' | 'adjustment';
  status: 'draft' | 'reviewed' | 'approved';
  currentRevision: number;
  reviewedRevision: number | null;
  approvedRevision: number | null;
  version: number;
}

/** Authoritative employee inputs and computed result held in memory before the first money write. */
interface PreparedEmployee {
  input: PayrollEmployeeSettlementInput;
  profileId: string;
  contractId: string;
  sourceSnapshot: PayrollEmployeeSourceSnapshot;
  sources: PayrollPreparedSource[];
  calculation: ColombiaPrePayrollResult;
}

type CreateRunInput = z.infer<typeof createPayrollRunInput>;
type RecalculateRunInput = z.infer<typeof recalculatePayrollRunInput>;
type AdvanceRunInput = z.infer<typeof advancePayrollRunInput>;

function result(row: PayrollRun): PayrollRunCommandResult {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    currentRevision: row.currentRevision,
    reviewedRevision: row.reviewedRevision,
    approvedRevision: row.approvedRevision,
    version: row.version,
  };
}

function finishRun(
  ctx: WorkforceCommandContext,
  tx: DatabaseInstance,
  row: PayrollRun
): PayrollRunCommandResult {
  const response = result(row);
  ctx.completeInTransaction(tx, response);
  return response;
}

function snapshot(row: PayrollRun): PayrollRunEventSnapshot {
  return {
    status: row.status,
    currentRevision: row.currentRevision,
    reviewedRevision: row.reviewedRevision,
    approvedRevision: row.approvedRevision,
    version: row.version,
  };
}

function recordRunEvent(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  row: PayrollRun,
  kind: 'created' | 'recalculated' | 'reviewed' | 'approved',
  reason: string
): void {
  tx.insert(payrollRunEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      runId: row.id,
      version: row.version,
      kind,
      revision: row.currentRevision,
      actorId: ctx.user.id,
      operationId: ctx.envelope.operationId,
      reason,
      snapshot: snapshot(row),
      createdAt: row.updatedAt,
    })
    .run();
}

function auditRun(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  row: PayrollRun,
  before: PayrollRun | null,
  kind: 'created' | 'recalculated' | 'reviewed' | 'approved'
): void {
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    operationId: ctx.envelope.operationId,
    action: 'payroll_run.changed',
    resourceType: 'payroll_run',
    resourceId: row.id,
    before: before
      ? { status: before.status, currentRevision: before.currentRevision, version: before.version }
      : null,
    after: { status: row.status, currentRevision: row.currentRevision, version: row.version, kind },
  });
}

function requirePeriod(
  tx: DatabaseInstance,
  tenantId: string,
  periodId: string,
  requireOpen = true
) {
  const period = tx
    .select()
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.tenantId, tenantId), eq(payrollPeriods.id, periodId)))
    .get();
  if (!period) denyPayroll('not_found');
  if (requireOpen && period.status !== 'open') denyPayroll('state');
  if (period.countryCode !== 'CO') denyPayroll('country');
  if (period.currencyCode !== 'COP') denyPayroll('currency');
  return period;
}

function requireSinglePolicy(fromDate: string, untilDate: string): ColombiaPayrollPolicy {
  const first = freezeColombiaPayrollPolicy(fromDate);
  const last = resolveColombiaPayrollPolicy(addCalendarDays(untilDate, -1));
  if (!first || !last || first.policyVersion !== last.policyVersion) denyPayroll('policy');
  return first;
}

function requireRun(
  tx: DatabaseInstance,
  tenantId: string,
  runId: string,
  expectedVersion: number
): PayrollRun {
  const row = tx
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, runId)))
    .get();
  if (!row) denyPayroll('not_found');
  if (row.version !== expectedVersion) denyPayroll('version');
  return row;
}

function profileSnapshot(
  row: typeof payrollEmployeeProfiles.$inferSelect
): PayrollEmployeeProfileSnapshot {
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

function loadAdjustmentAuthority(
  tx: DatabaseInstance,
  tenantId: string,
  run: PayrollRun,
  userId: string
) {
  if (run.originalRunId === null) denyPayroll('adjustment');
  const original = tx
    .select()
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.tenantId, tenantId),
        eq(payrollRuns.id, run.originalRunId),
        eq(payrollRuns.status, 'approved')
      )
    )
    .get();
  if (!original || original.approvedRevision === null) denyPayroll('adjustment');
  const revision = tx
    .select({ id: payrollRunRevisions.id })
    .from(payrollRunRevisions)
    .where(
      and(
        eq(payrollRunRevisions.tenantId, tenantId),
        eq(payrollRunRevisions.runId, original.id),
        eq(payrollRunRevisions.revision, original.approvedRevision),
        eq(payrollRunRevisions.status, 'complete')
      )
    )
    .get();
  if (!revision) denyPayroll('adjustment');
  const originalResult = tx
    .select()
    .from(payrollEmployeeResults)
    .where(
      and(
        eq(payrollEmployeeResults.tenantId, tenantId),
        eq(payrollEmployeeResults.revisionId, revision.id),
        eq(payrollEmployeeResults.userId, userId),
        eq(payrollEmployeeResults.status, 'complete')
      )
    )
    .get();
  if (!originalResult) denyPayroll('adjustment');
  const profile = tx
    .select()
    .from(payrollEmployeeProfiles)
    .where(
      and(
        eq(payrollEmployeeProfiles.tenantId, tenantId),
        eq(payrollEmployeeProfiles.id, originalResult.payrollProfileId),
        eq(payrollEmployeeProfiles.userId, userId)
      )
    )
    .get();
  const contract = tx
    .select()
    .from(employmentContracts)
    .where(
      and(
        eq(employmentContracts.tenantId, tenantId),
        eq(employmentContracts.id, originalResult.employmentContractId),
        eq(employmentContracts.userId, userId)
      )
    )
    .get();
  if (!profile || !contract) denyPayroll('adjustment');
  const originalSources = tx
    .select()
    .from(payrollResultSources)
    .where(
      and(
        eq(payrollResultSources.tenantId, tenantId),
        eq(payrollResultSources.employeeResultId, originalResult.id),
        inArray(payrollResultSources.kind, ['payroll_profile', 'employment_contract'])
      )
    )
    .all();
  const profileSource = originalSources.find(row => row.kind === 'payroll_profile');
  const contractSource = originalSources.find(row => row.kind === 'employment_contract');
  if (!profileSource || !contractSource) denyPayroll('adjustment');
  const frozenProfile = originalResult.sourceSnapshot.payrollProfile;
  const frozenContract = parsePayrollContractEvidence(contractSource.sourceSnapshot);
  if (
    frozenContract === null ||
    frozenProfile.userId !== userId ||
    frozenProfile.countryCode !== 'CO' ||
    frozenContract.terms.userId !== userId ||
    frozenContract.terms.siteId !== frozenProfile.siteId ||
    frozenContract.terms.currencyCode !== 'COP' ||
    profileSource.sourceId !== originalResult.payrollProfileId ||
    contractSource.sourceId !== originalResult.employmentContractId ||
    profileSource.sourceVersion !== frozenProfile.version ||
    contractSource.sourceVersion !== frozenContract.version ||
    hashCanonicalInput(profileSource.sourceSnapshot) !== profileSource.sourceDigest ||
    hashCanonicalInput(contractSource.sourceSnapshot) !== contractSource.sourceDigest ||
    originalResult.sourceSnapshot.employmentContractId !== contract.id ||
    originalResult.sourceSnapshot.employmentContractVersion !== frozenContract.version
  )
    denyPayroll('adjustment');
  return {
    profile,
    profileSnapshot: frozenProfile,
    contract,
    contractEvidence: frozenContract,
    originalResult,
    sources: [
      {
        kind: profileSource.kind,
        sourceId: profileSource.sourceId,
        sourceVersion: profileSource.sourceVersion,
        sourceDigest: profileSource.sourceDigest,
        sourceSnapshot: profileSource.sourceSnapshot,
      },
      {
        kind: contractSource.kind,
        sourceId: contractSource.sourceId,
        sourceVersion: contractSource.sourceVersion,
        sourceDigest: contractSource.sourceDigest,
        sourceSnapshot: contractSource.sourceSnapshot,
      },
    ] satisfies PayrollPreparedSource[],
    adjustmentSource: {
      runId: original.id,
      revision: original.approvedRevision,
      employeeResultId: originalResult.id,
    },
  };
}

function settlementSnapshot(
  ctx: WorkforceCommandContext,
  input: RecalculateRunInput,
  employee: PayrollEmployeeSettlementInput
): PayrollSettlementReviewSnapshot {
  return {
    operationId: ctx.envelope.operationId,
    policyAcknowledged: input.policyAcknowledged,
    payrollDays: employee.payrollDays,
    ordinaryWorkedSeconds: employee.ordinaryWorkedSeconds,
    employeeClassification: employee.employeeClassification,
    holidayCalendarReviewed: employee.holidayCalendarReviewed,
    employeeRestDayReviewed: employee.employeeRestDayReviewed,
    contributionExemption: employee.contributionExemption,
    contributionBaseAmount: employee.contributionBaseAmount,
    transportAssistance: employee.transportAssistance,
    withholding:
      employee.withholding.status === 'complete'
        ? {
            status: 'complete',
            amount: employee.withholding.amount,
            reason: employee.withholding.reason,
          }
        : { status: 'review_required' },
    benefitsReviewed: employee.benefitsReviewed,
    reviewReason: employee.reviewReason,
    manualConcepts: employee.manualConcepts.map(concept => ({
      category: concept.category,
      code: concept.code,
      label: concept.label,
      amount: concept.amount,
      reason: concept.reason,
    })),
  };
}

function blockedCalculation(
  policyVersion: string,
  blockers: Iterable<ColombiaPrePayrollBlockerCode>
): ColombiaPrePayrollResult {
  return {
    status: 'blocked',
    policyVersion,
    blockers: [...new Set(blockers)].sort(),
    concepts: [],
    grossAmount: 0,
    deductionAmount: 0,
    netAmount: 0,
    employerContributionAmount: 0,
  };
}

function prepareEmployee(
  tx: DatabaseInstance,
  ctx: WorkforceCommandContext,
  run: PayrollRun,
  period: typeof payrollPeriods.$inferSelect,
  policy: ColombiaPayrollPolicy,
  input: RecalculateRunInput,
  employee: PayrollEmployeeSettlementInput,
  sourceCutoff: string,
  regularAuthority: RegularPayrollEmployeeAuthority | null
): PreparedEmployee {
  const reviewRef = (field: string) =>
    `payroll_review:${ctx.envelope.operationId}:${employee.userId}:${field}`;
  const policySource = payrollPreparedSource('policy', policy.policyVersion, null, {
    ...policy,
  });
  let profile: typeof payrollEmployeeProfiles.$inferSelect;
  let profileEvidence: PayrollEmployeeProfileSnapshot;
  let contract: EmploymentContractRow;
  let contractEvidence: PayrollContractEvidence;
  let attendance: PayrollPreparedAttendance = {
    workedSeconds: 0,
    attendanceIds: [],
    correctionVersions: {},
    reconciliationIds: [],
    sources: [],
    blockers: [],
  };
  let authoritySources: PayrollPreparedSource[];
  let adjustmentSource: PayrollEmployeeSourceSnapshot['adjustmentSource'] = null;
  if (run.kind === 'regular') {
    if (regularAuthority === null) denyPayroll('employee_set');
    profile = regularAuthority.profile;
    profileEvidence = profileSnapshot(profile);
    contract = regularAuthority.contract;
    contractEvidence = freezePayrollContract(contract);
    attendance = regularAuthority.attendance;
    authoritySources = [
      payrollPreparedSource('payroll_profile', profile.id, profile.version, {
        ...profileEvidence,
      }),
      payrollPreparedSource('employment_contract', contract.id, contract.version, contractEvidence),
    ];
  } else {
    const authority = loadAdjustmentAuthority(tx, ctx.tenantId, run, employee.userId);
    profile = authority.profile;
    profileEvidence = authority.profileSnapshot;
    contract = authority.contract;
    contractEvidence = authority.contractEvidence;
    authoritySources = authority.sources;
    adjustmentSource = authority.adjustmentSource;
  }

  const reviewRefs = {
    baseCompensation: [reviewRef('base_compensation')],
    employeeClassification: [reviewRef('employee_classification')],
    holidayCalendar: [reviewRef('holiday_calendar')],
    employeeRestDay: [reviewRef('employee_rest_day')],
    contributionExemption: [reviewRef('contribution_exemption')],
    contributionBase: [reviewRef('contribution_base')],
    transportAssistance: [reviewRef('transport_assistance')],
    benefits: [reviewRef('benefits')],
  };
  let calculation = calculateColombiaPrePayroll({
    policyDate: period.fromDate,
    policyAcknowledged: input.policyAcknowledged,
    currencyCode: period.currencyCode,
    contract: {
      id: contract.id,
      version: contractEvidence.version,
      payBasis: contractEvidence.terms.pay.basis,
      payAmount: contractEvidence.terms.pay.amount,
      integralSalary: profileEvidence.integralSalary,
      arlRiskClass: profileEvidence.arlRiskClass,
    },
    settlement: {
      payrollDays: employee.payrollDays,
      ordinaryWorkedSeconds: employee.ordinaryWorkedSeconds,
      employeeClassification: employee.employeeClassification,
      holidayCalendarReviewed: employee.holidayCalendarReviewed,
      employeeRestDayReviewed: employee.employeeRestDayReviewed,
      contributionExemption: employee.contributionExemption,
      contributionBaseAmount: employee.contributionBaseAmount,
      transportAssistance: employee.transportAssistance,
      transportAssistanceEligible: profileEvidence.transportAssistanceEligible,
      withholding:
        employee.withholding.status === 'complete'
          ? {
              ...employee.withholding,
              sourceRefs: [reviewRef('withholding')],
            }
          : employee.withholding,
      benefitsReviewed: employee.benefitsReviewed,
      reviewSourceRefs: reviewRefs,
    },
    manualConcepts: employee.manualConcepts.map(concept => ({
      ...concept,
      sourceRefs: [reviewRef(`manual:${concept.category}:${concept.code}`)],
    })),
  });

  const additionalBlockers = new Set(attendance.blockers);
  if (
    run.kind === 'regular' &&
    contractEvidence.terms.pay.basis === 'hourly' &&
    employee.ordinaryWorkedSeconds !== null &&
    employee.ordinaryWorkedSeconds !== attendance.workedSeconds
  ) {
    additionalBlockers.add('attendance_seconds_mismatch');
  }
  if (run.kind === 'adjustment') {
    const automaticBaseIsZero =
      employee.contributionBaseAmount === 0 &&
      employee.transportAssistance === 'does_not_apply' &&
      (contractEvidence.terms.pay.basis === 'monthly'
        ? employee.payrollDays === 0
        : employee.ordinaryWorkedSeconds === 0);
    if (!automaticBaseIsZero) additionalBlockers.add('adjustment_requires_zero_automatic_base');
    if (
      employee.manualConcepts.length === 0 ||
      employee.manualConcepts.every(concept => concept.amount === 0)
    )
      additionalBlockers.add('adjustment_manual_concept_required');
    if (calculation.status === 'complete') {
      calculation = {
        ...calculation,
        concepts: calculation.concepts.filter(concept => concept.amount !== 0),
      };
    }
  }
  const finalCalculation =
    additionalBlockers.size === 0
      ? calculation
      : blockedCalculation(policy.policyVersion, [
          ...additionalBlockers,
          ...(calculation.status === 'blocked' ? calculation.blockers : []),
        ]);
  return {
    input: employee,
    profileId: profile.id,
    contractId: contract.id,
    sourceSnapshot: {
      payrollProfile: profileEvidence,
      employmentContractId: contract.id,
      employmentContractVersion: contractEvidence.version,
      attendanceIds: attendance.attendanceIds,
      attendanceCorrectionVersions: attendance.correctionVersions,
      reconciliationIds: attendance.reconciliationIds,
      policyIds: [policy.policyVersion],
      settlementReview: settlementSnapshot(ctx, input, employee),
      adjustmentSource,
      sourceCutoff,
    },
    sources: [...authoritySources, ...attendance.sources, policySource],
    calculation: finalCalculation,
  };
}

function makeRunWideBlocked(
  prepared: PreparedEmployee[],
  policyVersion: string
): PreparedEmployee[] {
  if (!prepared.some(employee => employee.calculation.status === 'blocked')) return prepared;
  return prepared.map(employee => ({
    ...employee,
    calculation:
      employee.calculation.status === 'blocked'
        ? employee.calculation
        : blockedCalculation(policyVersion, ['run_contains_blocked_employee']),
  }));
}

function aggregate(
  prepared: readonly PreparedEmployee[],
  field: 'grossAmount' | 'deductionAmount' | 'netAmount' | 'employerContributionAmount'
): number | null {
  let total = 0;
  for (const employee of prepared) {
    const next = tryRoundMoneyToSafeCents(total + employee.calculation[field]);
    if (next === null || next > 1_000_000_000_000) return null;
    total = next;
  }
  return total;
}

export async function createPayrollRun(
  ctx: WorkforceCommandContext,
  raw: z.input<typeof createPayrollRunInput>
): Promise<PayrollRunCommandResult> {
  const input: CreateRunInput = createPayrollRunInput.parse(raw);
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  if (clock.countryCode !== 'CO') denyPayroll('country');
  return withPayrollWriter(
    ctx,
    tx => {
      requirePeriod(tx, ctx.tenantId, input.periodId);
      if (input.kind === 'regular') {
        const existing = tx
          .select({ id: payrollRuns.id })
          .from(payrollRuns)
          .where(
            and(
              eq(payrollRuns.tenantId, ctx.tenantId),
              eq(payrollRuns.periodId, input.periodId),
              eq(payrollRuns.kind, 'regular')
            )
          )
          .get();
        if (existing) denyPayroll('regular_run_exists');
      }
      if (input.kind === 'adjustment') {
        const original = tx
          .select({ id: payrollRuns.id })
          .from(payrollRuns)
          .where(
            and(
              eq(payrollRuns.tenantId, ctx.tenantId),
              eq(payrollRuns.id, input.originalRunId!),
              eq(payrollRuns.status, 'approved')
            )
          )
          .get();
        if (!original) denyPayroll('adjustment');
      }
      const now = clock.nowIso;
      const row = tx
        .insert(payrollRuns)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          periodId: input.periodId,
          kind: input.kind,
          originalRunId: input.originalRunId,
          createdByUserId: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()!;
      recordRunEvent(tx, ctx, row, 'created', input.reason);
      auditRun(tx, ctx, row, null, 'created');
      return finishRun(ctx, tx, row);
    },
    clock
  );
}

export async function recalculatePayrollRun(
  ctx: WorkforceCommandContext,
  raw: z.input<typeof recalculatePayrollRunInput>
): Promise<PayrollRunCommandResult> {
  const input: RecalculateRunInput = recalculatePayrollRunInput.parse(raw);
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  if (clock.countryCode !== 'CO') denyPayroll('country');
  return withPayrollWriter(
    ctx,
    (tx, timeZone) => {
      const before = requireRun(tx, ctx.tenantId, input.runId, input.expectedVersion);
      if (before.status !== 'draft') denyPayroll('state');
      const period = requirePeriod(tx, ctx.tenantId, before.periodId);
      const policy = requireSinglePolicy(period.fromDate, period.untilDate);
      const regularAuthority =
        before.kind === 'regular'
          ? prepareRegularPayrollRunAuthority(tx, ctx.tenantId, before, period, timeZone)
          : null;
      const authority =
        regularAuthority?.preparation ??
        getAdjustmentPayrollRunPreparation(tx, ctx.tenantId, before);
      if (!authority.ready) denyPayroll('blocked');
      if (input.authorityToken !== authority.authorityToken) denyPayroll('authority_changed');
      if (before.kind === 'regular') {
        const expectedUsers = authority.employees.map(employee => employee.userId).sort();
        const submittedUsers = input.employees.map(employee => employee.userId).sort();
        if (
          expectedUsers.length !== submittedUsers.length ||
          expectedUsers.some((userId, index) => userId !== submittedUsers[index])
        ) {
          denyPayroll('employee_set');
        }
      }
      let prepared = input.employees.map(employee =>
        prepareEmployee(
          tx,
          ctx,
          before,
          period,
          policy,
          input,
          employee,
          clock.nowIso,
          regularAuthority?.employeesByUser.get(employee.userId) ?? null
        )
      );
      prepared = makeRunWideBlocked(prepared, policy.policyVersion);
      let grossAmount = aggregate(prepared, 'grossAmount');
      let deductionAmount = aggregate(prepared, 'deductionAmount');
      let netAmount = aggregate(prepared, 'netAmount');
      let employerContributionAmount = aggregate(prepared, 'employerContributionAmount');
      if (
        grossAmount === null ||
        deductionAmount === null ||
        netAmount === null ||
        employerContributionAmount === null
      ) {
        prepared = prepared.map(employee => ({
          ...employee,
          calculation: blockedCalculation(policy.policyVersion, ['money_range_exceeded']),
        }));
        grossAmount = deductionAmount = netAmount = employerContributionAmount = 0;
      }
      const revisionNumber = before.currentRevision + 1;
      const revisionStatus = prepared.every(employee => employee.calculation.status === 'complete')
        ? 'complete'
        : 'blocked';
      const revisionBlockers = [
        ...new Set(
          prepared.flatMap(employee =>
            employee.calculation.status === 'blocked' ? employee.calculation.blockers : []
          )
        ),
      ].sort();
      const revision = tx
        .insert(payrollRunRevisions)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          runId: before.id,
          revision: revisionNumber,
          status: revisionStatus,
          policyVersion: policy.policyVersion,
          policySnapshot: policy,
          sourceCutoff: clock.nowIso,
          currencyCode: period.currencyCode,
          grossAmount,
          deductionAmount,
          netAmount,
          employerContributionAmount,
          blockers: revisionBlockers,
          generatedByUserId: ctx.user.id,
          createdAt: clock.nowIso,
        })
        .returning()
        .get()!;
      for (const employee of prepared) {
        const employeeResult = tx
          .insert(payrollEmployeeResults)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            revisionId: revision.id,
            userId: employee.input.userId,
            payrollProfileId: employee.profileId,
            employmentContractId: employee.contractId,
            sourceSnapshot: { ...employee.sourceSnapshot, sourceCutoff: clock.nowIso },
            status: employee.calculation.status,
            currencyCode: period.currencyCode,
            grossAmount: employee.calculation.grossAmount,
            deductionAmount: employee.calculation.deductionAmount,
            netAmount: employee.calculation.netAmount,
            employerContributionAmount: employee.calculation.employerContributionAmount,
            blockers:
              employee.calculation.status === 'blocked' ? employee.calculation.blockers : [],
            createdAt: clock.nowIso,
          })
          .returning()
          .get()!;
        for (const source of employee.sources) {
          tx.insert(payrollResultSources)
            .values({
              id: nanoid(),
              tenantId: ctx.tenantId,
              employeeResultId: employeeResult.id,
              ...source,
              createdAt: clock.nowIso,
            })
            .run();
        }
        if (revisionStatus === 'complete' && employee.calculation.status === 'complete') {
          for (const concept of employee.calculation.concepts) {
            tx.insert(payrollConceptLines)
              .values({
                id: nanoid(),
                tenantId: ctx.tenantId,
                employeeResultId: employeeResult.id,
                ...concept,
                createdByUserId: ctx.user.id,
                createdAt: clock.nowIso,
              })
              .run();
          }
        }
      }
      const row = tx
        .update(payrollRuns)
        .set({
          currentRevision: revisionNumber,
          version: before.version + 1,
          updatedAt: clock.nowIso,
        })
        .where(
          and(
            eq(payrollRuns.tenantId, ctx.tenantId),
            eq(payrollRuns.id, before.id),
            eq(payrollRuns.status, 'draft'),
            eq(payrollRuns.version, before.version),
            eq(payrollRuns.currentRevision, before.currentRevision)
          )
        )
        .returning()
        .get();
      if (!row) denyPayroll('version');
      recordRunEvent(tx, ctx, row, 'recalculated', input.reason);
      auditRun(tx, ctx, row, before, 'recalculated');
      return finishRun(ctx, tx, row);
    },
    clock
  );
}

async function advancePayrollRun(
  ctx: WorkforceCommandContext,
  input: AdvanceRunInput,
  transition: 'reviewed' | 'approved'
): Promise<PayrollRunCommandResult> {
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  if (clock.countryCode !== 'CO') denyPayroll('country');
  return withPayrollWriter(
    ctx,
    tx => {
      const before = requireRun(tx, ctx.tenantId, input.runId, input.expectedVersion);
      requirePeriod(tx, ctx.tenantId, before.periodId);
      if (
        before.currentRevision !== input.expectedRevision ||
        (transition === 'reviewed' && before.status !== 'draft') ||
        (transition === 'approved' &&
          (before.status !== 'reviewed' || before.reviewedRevision !== input.expectedRevision))
      )
        denyPayroll('state');
      const revision = tx
        .select({ id: payrollRunRevisions.id, status: payrollRunRevisions.status })
        .from(payrollRunRevisions)
        .where(
          and(
            eq(payrollRunRevisions.tenantId, ctx.tenantId),
            eq(payrollRunRevisions.runId, before.id),
            eq(payrollRunRevisions.revision, input.expectedRevision)
          )
        )
        .get();
      if (!revision || revision.status !== 'complete') denyPayroll('blocked');
      const incomplete = tx
        .select({ id: payrollEmployeeResults.id })
        .from(payrollEmployeeResults)
        .where(
          and(
            eq(payrollEmployeeResults.tenantId, ctx.tenantId),
            eq(payrollEmployeeResults.revisionId, revision.id),
            eq(payrollEmployeeResults.status, 'blocked')
          )
        )
        .get();
      const anyEmployee = tx
        .select({ id: payrollEmployeeResults.id })
        .from(payrollEmployeeResults)
        .where(
          and(
            eq(payrollEmployeeResults.tenantId, ctx.tenantId),
            eq(payrollEmployeeResults.revisionId, revision.id)
          )
        )
        .get();
      if (incomplete || !anyEmployee) denyPayroll('blocked');
      const row = tx
        .update(payrollRuns)
        .set(
          transition === 'reviewed'
            ? {
                status: 'reviewed',
                reviewedRevision: input.expectedRevision,
                reviewedByUserId: ctx.user.id,
                reviewedAt: clock.nowIso,
                version: before.version + 1,
                updatedAt: clock.nowIso,
              }
            : {
                status: 'approved',
                approvedRevision: input.expectedRevision,
                approvedByUserId: ctx.user.id,
                approvedAt: clock.nowIso,
                version: before.version + 1,
                updatedAt: clock.nowIso,
              }
        )
        .where(
          and(
            eq(payrollRuns.tenantId, ctx.tenantId),
            eq(payrollRuns.id, before.id),
            eq(payrollRuns.status, before.status),
            eq(payrollRuns.version, before.version),
            eq(payrollRuns.currentRevision, input.expectedRevision)
          )
        )
        .returning()
        .get();
      if (!row) denyPayroll('version');
      recordRunEvent(tx, ctx, row, transition, input.reason);
      auditRun(tx, ctx, row, before, transition);
      return finishRun(ctx, tx, row);
    },
    clock
  );
}

export function reviewPayrollRun(
  ctx: WorkforceCommandContext,
  raw: z.input<typeof advancePayrollRunInput>
): Promise<PayrollRunCommandResult> {
  return advancePayrollRun(ctx, advancePayrollRunInput.parse(raw), 'reviewed');
}

export function approvePayrollRun(
  ctx: WorkforceCommandContext,
  raw: z.input<typeof advancePayrollRunInput>
): Promise<PayrollRunCommandResult> {
  return advancePayrollRun(ctx, advancePayrollRunInput.parse(raw), 'approved');
}
