import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

type EmployeeShiftOutputs = inferRouterOutputs<AppRouter>['employeeShifts']['attendance'];

/** One privacy-minimal planned-vs-actual row; it never carries compensation or private reasons. */
export type PlanActualRow = EmployeeShiftOutputs['planActual']['list']['items'][number];

/** Stable keyset cursor for a bounded schedule window. */
export type PlanActualCursor = NonNullable<
  EmployeeShiftOutputs['planActual']['list']['nextCursor']
>;

/** Correction-aware attendance evidence eligible for one exact scheduled shift. */
export type ReconciliationCandidate = EmployeeShiftOutputs['planActual']['candidates'][number];

/** Admin-only regular operational estimate; explicitly not a payroll result. */
export type OperationalLaborCostReport = EmployeeShiftOutputs['costs'];
