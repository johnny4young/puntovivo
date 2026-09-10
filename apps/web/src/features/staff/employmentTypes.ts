import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

/** Inferred employment responses; private contracts are never used by manager queries. */
type WorkforceOutputs = inferRouterOutputs<AppRouter>['workforce'];
/** One administrator-only terms row, including its optimistic version. */
export type EmploymentContract = WorkforceOutputs['contracts']['list']['items'][number];
/** Public-to-managers assignment without compensation or private history. */
export type EmploymentAssignment = WorkforceOutputs['assignments']['items'][number];
/** Immutable administrator-only before/after evidence. */
export type EmploymentSnapshot = WorkforceOutputs['contracts']['events']['items'][number]['after'];
/** Keyset boundary; tied start dates are ordered by the unique contract id. */
export type EmploymentCursor = NonNullable<WorkforceOutputs['contracts']['list']['nextCursor']>;
/** Lifecycle editors keep an immutable selected version until the operator explicitly reloads. */
export type EmploymentEditor =
  { action: 'create' } | { action: 'replace' | 'end' | 'void'; contract: EmploymentContract };
/** Raw input strings keep blank compensation distinct from an explicitly entered zero. */
export interface EmploymentFormValues {
  userId: string;
  siteId: string;
  position: string;
  effectiveFrom: string;
  effectiveUntil: string;
  payBasis: 'hourly' | 'monthly';
  payAmount: string;
  costingHourlyRate: string;
  reason: string;
}
/** Tenant currency is provided by the server; empty monthly costing stays unknown, not zero. */
export function employmentTermsFromForm(
  values: EmploymentFormValues,
  currencyCode: string
): inferRouterInputs<AppRouter>['workforce']['contracts']['create']['terms'] {
  const amount = parseEmploymentMoney(values.payAmount);
  const costing = values.costingHourlyRate.trim()
    ? parseEmploymentMoney(values.costingHourlyRate)
    : null;
  if (
    amount === null ||
    (values.payBasis === 'monthly' && values.costingHourlyRate.trim() && costing === null)
  ) {
    throw new Error('Invalid employment money');
  }
  return {
    userId: values.userId,
    siteId: values.siteId,
    position: values.position.trim(),
    effectiveFrom: values.effectiveFrom,
    effectiveUntil: values.effectiveUntil || null,
    currencyCode,
    pay:
      values.payBasis === 'hourly'
        ? { basis: 'hourly', amount }
        : { basis: 'monthly', amount, costingHourlyRate: costing },
  };
}

/** Exact two-decimal nonnegative input; no exponent, implicit zero, or silent rounding. */
export function parseEmploymentMoney(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount <= 1_000_000_000_000 ? amount : null;
}

/** Calendar dates, not instants; avoid JavaScript's normalization of invalid month/day pairs. */
export function isEmploymentDate(value: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
