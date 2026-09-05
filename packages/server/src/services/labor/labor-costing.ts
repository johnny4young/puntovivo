/** Admin-only regular operational labor cost; never a statutory payroll calculation. */
import { and, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { employmentContracts } from '../../db/schema.js';
import { roundMoney, tryRoundMoneyToSafeCents } from '../../lib/money.js';
import type { ListLaborCostInput } from '../../trpc/schemas/employeeShifts.js';
import { exportEmployeeAttendance } from './attendance-report.js';
import { estimateRegularLaborCost, type EmploymentContractTerms } from './employment-contract.js';
import { zonedWallTimeToIso } from './timezone.js';

/** Why a worked interval could not be priced from explicit employment terms. */
export type LaborCostUnavailableReason =
  | 'employment_terms_missing'
  | 'employment_terms_overlap'
  | 'monthly_costing_rate_missing'
  | 'invalid_contract_boundary'
  | 'unsafe_money_range';

/** One safely rounded currency subtotal; mixed currencies are never collapsed. */
export interface CostComponent {
  currencyCode: string;
  amount: number;
}

/** Correction-aware clock evidence needed by the pure operational-cost projection. */
export interface OperationalCostAttendanceRow {
  id: string;
  userId: string;
  userName: string;
  siteId: string;
  siteName: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  breaks: Array<{ startedAt: string; endedAt: string | null }>;
}

/** Effective-dated terms needed to price one attendance interval. */
export type OperationalCostContract = Pick<
  typeof employmentContracts.$inferSelect,
  | 'userId'
  | 'siteId'
  | 'position'
  | 'effectiveFrom'
  | 'effectiveUntil'
  | 'timeZone'
  | 'currencyCode'
  | 'payBasis'
  | 'payAmount'
  | 'costingHourlyRate'
>;

/** Exact UTC bounds for one report; observedAt closes an active shift without projecting ahead. */
export interface OperationalCostWindow {
  startsAt: string;
  endsAt: string;
  observedAt: string;
}

function overlapSeconds(
  start: string,
  end: string,
  intervalStart: string,
  intervalEnd: string
): number {
  const from = Math.max(Date.parse(start), Date.parse(intervalStart));
  const to = Math.min(Date.parse(end), Date.parse(intervalEnd));
  return Math.max(0, Math.floor((to - from) / 1_000));
}

function contractTerms(row: OperationalCostContract): EmploymentContractTerms {
  return {
    userId: row.userId,
    siteId: row.siteId,
    position: row.position,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    currencyCode: row.currencyCode,
    pay:
      row.payBasis === 'hourly'
        ? { basis: 'hourly', amount: row.payAmount }
        : {
            basis: 'monthly',
            amount: row.payAmount,
            costingHourlyRate: row.costingHourlyRate,
          },
  };
}

/**
 * Price only the portion of one attendance record inside the requested report window.
 * Overlapping terms fail closed instead of choosing a wage, while gaps and unsafe money
 * remain explicit unavailable time rather than becoming zero.
 */
export function estimateOperationalShiftCost(
  row: OperationalCostAttendanceRow,
  contracts: OperationalCostContract[],
  window: OperationalCostWindow
) {
  const observedEnd = row.clockedOutAt ?? window.observedAt;
  const effectiveStartMs = Math.max(Date.parse(row.clockedInAt), Date.parse(window.startsAt));
  const effectiveEndMs = Math.min(Date.parse(observedEnd), Date.parse(window.endsAt));
  const effectiveStart = new Date(effectiveStartMs).toISOString();
  const effectiveEnd = new Date(Math.max(effectiveStartMs, effectiveEndMs)).toISOString();
  const workedSeconds =
    effectiveEnd <= effectiveStart
      ? 0
      : Math.max(
          0,
          overlapSeconds(effectiveStart, effectiveEnd, effectiveStart, effectiveEnd) -
            row.breaks.reduce(
              (sum, item) =>
                sum +
                overlapSeconds(
                  item.startedAt,
                  item.endedAt ?? observedEnd,
                  effectiveStart,
                  effectiveEnd
                ),
              0
            )
        );
  const components = new Map<string, number>();
  const reasons = new Set<LaborCostUnavailableReason>();
  let pricedSeconds = 0;
  let coveredSeconds = 0;

  const windows: Array<{
    contract: OperationalCostContract;
    startsAt: string;
    endsAt: string;
  }> = [];

  for (const contract of contracts) {
    let contractStart: string;
    let contractEnd: string;
    try {
      contractStart = zonedWallTimeToIso(contract.effectiveFrom, '00:00', contract.timeZone);
      contractEnd = contract.effectiveUntil
        ? zonedWallTimeToIso(contract.effectiveUntil, '00:00', contract.timeZone)
        : '9999-12-31T23:59:59.999Z';
    } catch {
      reasons.add('invalid_contract_boundary');
      continue;
    }
    const segmentStartMs = Math.max(effectiveStartMs, Date.parse(contractStart));
    const segmentEndMs = Math.min(effectiveEndMs, Date.parse(contractEnd));
    if (segmentEndMs <= segmentStartMs) continue;
    windows.push({
      contract,
      startsAt: new Date(segmentStartMs).toISOString(),
      endsAt: new Date(segmentEndMs).toISOString(),
    });
  }

  windows.sort(
    (left, right) =>
      left.startsAt.localeCompare(right.startsAt) || left.endsAt.localeCompare(right.endsAt)
  );
  if (windows.some((item, index) => index > 0 && item.startsAt < windows[index - 1]!.endsAt)) {
    reasons.add('employment_terms_overlap');
    return {
      employeeShiftId: row.id,
      userId: row.userId,
      userName: row.userName,
      siteId: row.siteId,
      siteName: row.siteName,
      clockedInAt: row.clockedInAt,
      clockedOutAt: row.clockedOutAt,
      costedFrom: effectiveStart,
      costedUntil: effectiveEnd,
      workedSeconds,
      pricedSeconds: 0,
      unavailableSeconds: workedSeconds,
      status: 'unavailable' as const,
      components: [] as CostComponent[],
      reasons: [...reasons].sort(),
    };
  }

  for (const { contract, startsAt: segmentStart, endsAt: segmentEnd } of windows) {
    const elapsedSeconds = overlapSeconds(segmentStart, segmentEnd, segmentStart, segmentEnd);
    const breakSeconds = row.breaks.reduce(
      (sum, item) =>
        sum + overlapSeconds(item.startedAt, item.endedAt ?? observedEnd, segmentStart, segmentEnd),
      0
    );
    const workedSeconds = Math.max(0, elapsedSeconds - breakSeconds);
    coveredSeconds += workedSeconds;
    let cost: ReturnType<typeof estimateRegularLaborCost>;
    try {
      cost = estimateRegularLaborCost(contractTerms(contract), workedSeconds);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      reasons.add('unsafe_money_range');
      continue;
    }
    if (!cost.available) {
      reasons.add(cost.reason);
      continue;
    }
    const accumulated = tryRoundMoneyToSafeCents(
      (components.get(cost.currencyCode) ?? 0) + cost.amount
    );
    if (accumulated === null) {
      reasons.add('unsafe_money_range');
      continue;
    }
    components.set(cost.currencyCode, accumulated);
    pricedSeconds += workedSeconds;
  }
  const uncoveredSeconds = Math.max(0, workedSeconds - coveredSeconds);
  if (uncoveredSeconds > 0) reasons.add('employment_terms_missing');
  const unavailableSeconds = Math.max(0, workedSeconds - pricedSeconds);
  return {
    employeeShiftId: row.id,
    userId: row.userId,
    userName: row.userName,
    siteId: row.siteId,
    siteName: row.siteName,
    clockedInAt: row.clockedInAt,
    clockedOutAt: row.clockedOutAt,
    costedFrom: effectiveStart,
    costedUntil: effectiveEnd,
    workedSeconds,
    pricedSeconds,
    unavailableSeconds,
    status:
      unavailableSeconds === 0
        ? ('complete' as const)
        : pricedSeconds > 0
          ? ('partial' as const)
          : ('unavailable' as const),
    components: [...components.entries()]
      .map(([currencyCode, amount]) => ({ currencyCode, amount }))
      .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
    reasons: [...reasons].sort(),
  };
}

/** Aggregate safe row components without returning a believable partial total after overflow. */
export function aggregateOperationalCostTotals(
  rows: ReadonlyArray<{ components: readonly CostComponent[] }>
) {
  const totals = new Map<string, number>();
  const unavailableTotalCurrencies = new Set<string>();
  for (const row of rows) {
    for (const component of row.components) {
      if (unavailableTotalCurrencies.has(component.currencyCode)) continue;
      const amount = tryRoundMoneyToSafeCents(
        (totals.get(component.currencyCode) ?? 0) + component.amount
      );
      if (amount === null) {
        totals.delete(component.currencyCode);
        unavailableTotalCurrencies.add(component.currencyCode);
      } else totals.set(component.currencyCode, amount);
    }
  }
  return {
    totals: [...totals.entries()]
      .map(([currencyCode, amount]): CostComponent => ({
        currencyCode,
        amount: roundMoney(amount),
      }))
      .sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
    unavailableTotalCurrencies: [...unavailableTotalCurrencies].sort(),
  };
}

/**
 * Estimate regular operational cost from effective attendance and dated contracts.
 * Missing terms remain explicit unknown time; amounts never imply overtime, tax,
 * benefits, holiday, collective-agreement or electronic-payroll compliance.
 */
export async function listOperationalLaborCost(
  db: DatabaseInstance,
  tenantId: string,
  input: ListLaborCostInput
) {
  const attendance = await exportEmployeeAttendance(db, tenantId, 'admin', input);
  const window = {
    startsAt: zonedWallTimeToIso(input.fromDate, '00:00', attendance.timeZone),
    endsAt: zonedWallTimeToIso(input.toDate, '00:00', attendance.timeZone),
    observedAt: attendance.generatedAt,
  } satisfies OperationalCostWindow;
  const userIds = [...new Set(attendance.rows.map(row => row.userId))];
  const contracts =
    userIds.length === 0
      ? []
      : await db
          .select()
          .from(employmentContracts)
          .where(
            and(
              eq(employmentContracts.tenantId, tenantId),
              inArray(employmentContracts.userId, userIds),
              isNull(employmentContracts.voidedAt),
              lt(employmentContracts.effectiveFrom, input.toDate),
              or(
                isNull(employmentContracts.effectiveUntil),
                gt(employmentContracts.effectiveUntil, input.fromDate)
              )!
            )
          )
          .all();
  const byUser = new Map<string, Array<typeof employmentContracts.$inferSelect>>();
  for (const contract of contracts) {
    const rows = byUser.get(contract.userId) ?? [];
    rows.push(contract);
    byUser.set(contract.userId, rows);
  }
  const rows = attendance.rows.map(row =>
    estimateOperationalShiftCost(row, byUser.get(row.userId) ?? [], window)
  );
  const aggregate = aggregateOperationalCostTotals(rows);
  return {
    kind: 'regular_operational_estimate' as const,
    timeZone: attendance.timeZone,
    generatedAt: attendance.generatedAt,
    fromDate: input.fromDate,
    toDate: input.toDate,
    workedSeconds: rows.reduce((sum, row) => sum + row.workedSeconds, 0),
    pricedSeconds: rows.reduce((sum, row) => sum + row.pricedSeconds, 0),
    unavailableSeconds: rows.reduce((sum, row) => sum + row.unavailableSeconds, 0),
    totals: aggregate.totals,
    unavailableTotalCurrencies: aggregate.unavailableTotalCurrencies,
    rows,
    limitations: [
      'regular_time_only',
      'not_payroll',
      'no_statutory_premiums',
      'no_benefits_or_taxes',
    ] as const,
  };
}
