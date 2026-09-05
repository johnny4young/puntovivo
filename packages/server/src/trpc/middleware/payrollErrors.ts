/** Stable safe payroll-domain errors; SQLite and private employee evidence never cross tRPC. */
import { PayrollDomainError } from '../../application/payroll/errors.js';
import {
  ServerErrorWithCode,
  throwServerError,
  type ServerErrorCode,
} from '../../lib/errorCodes.js';
import { middleware } from '../init.js';

const domainErrors = {
  not_found: ['NOT_FOUND', 'PAYROLL_NOT_FOUND', 'The payroll record is not available'],
  country: [
    'BAD_REQUEST',
    'PAYROLL_COUNTRY_UNSUPPORTED',
    'Pre-payroll is not available for the configured country',
  ],
  currency: [
    'BAD_REQUEST',
    'PAYROLL_CURRENCY_MISMATCH',
    'Pre-payroll must use the business currency',
  ],
  policy: [
    'PRECONDITION_FAILED',
    'PAYROLL_POLICY_UNAVAILABLE',
    'A reviewed payroll policy does not cover the whole period',
  ],
  profile_overlap: [
    'CONFLICT',
    'PAYROLL_PROFILE_OVERLAP',
    'A payroll profile already covers part of this effective period',
  ],
  period_overlap: [
    'CONFLICT',
    'PAYROLL_PERIOD_OVERLAP',
    'A payroll period already covers part of this window',
  ],
  regular_run_exists: [
    'CONFLICT',
    'PAYROLL_REGULAR_RUN_EXISTS',
    'This payroll period already has a regular run',
  ],
  employee_set: [
    'CONFLICT',
    'PAYROLL_EMPLOYEE_SET_CHANGED',
    'The authoritative employee set changed; reload before recalculating',
  ],
  authority_changed: [
    'CONFLICT',
    'PAYROLL_AUTHORITY_CHANGED',
    'Payroll evidence changed after review; reload before recalculating',
  ],
  version: ['CONFLICT', 'STALE_VERSION', 'The payroll record changed; reload before continuing'],
  state: [
    'CONFLICT',
    'PAYROLL_STATE_INVALID',
    'This payroll change is not valid for the current state',
  ],
  blocked: [
    'PRECONDITION_FAILED',
    'PAYROLL_PREREQUISITES_INCOMPLETE',
    'Complete and recalculate every payroll prerequisite before continuing',
  ],
  adjustment: [
    'BAD_REQUEST',
    'PAYROLL_ADJUSTMENT_INVALID',
    'The adjustment does not reference an approved employee result',
  ],
} as const satisfies Record<
  PayrollDomainError['reason'],
  readonly [string, ServerErrorCode, string]
>;

export const payrollErrors = middleware(async ({ next }) => {
  const result = await next();
  if (result.ok) return result;
  const cause = result.error.cause;
  if (cause instanceof PayrollDomainError) {
    const [trpcCode, errorCode, message] = domainErrors[cause.reason];
    throwServerError({ trpcCode, errorCode, message });
  }
  if (result.error.code === 'INTERNAL_SERVER_ERROR' && !(cause instanceof ServerErrorWithCode)) {
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'PAYROLL_TEMPORARILY_UNAVAILABLE',
      message: 'Pre-payroll is temporarily unavailable; retry the same operation',
    });
  }
  return result;
});
