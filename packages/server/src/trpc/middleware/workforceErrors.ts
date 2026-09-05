/** Safe labor-domain errors; storage messages and private terms never cross the transport. */
import { EmploymentContractError } from '../../application/workforce/contracts.js';
import {
  ServerErrorWithCode,
  throwServerError,
  type ServerErrorCode,
} from '../../lib/errorCodes.js';
import { middleware } from '../init.js';

const domainErrors = {
  forbidden: [
    'FORBIDDEN',
    'EMPLOYMENT_CONTRACT_FORBIDDEN',
    'Only an administrator can manage employment compensation',
  ],
  not_found: [
    'NOT_FOUND',
    'EMPLOYMENT_CONTRACT_NOT_FOUND',
    'The employment record, employee or site is not available',
  ],
  currency: [
    'BAD_REQUEST',
    'EMPLOYMENT_CONTRACT_CURRENCY_MISMATCH',
    'Employment compensation must use the business currency',
  ],
  overlap: [
    'CONFLICT',
    'EMPLOYMENT_CONTRACT_OVERLAP',
    'The employee already has an assignment in this effective period',
  ],
  version: [
    'CONFLICT',
    'STALE_VERSION',
    'The employment record changed; reload it before continuing',
  ],
  state: [
    'CONFLICT',
    'EMPLOYMENT_CONTRACT_STATE_INVALID',
    'This employment change is not valid for the current record',
  ],
} as const satisfies Record<
  EmploymentContractError['reason'],
  readonly [string, ServerErrorCode, string]
>;

export const workforceErrors = middleware(async ({ next }) => {
  const result = await next();
  if (result.ok) return result;
  const cause = result.error.cause;
  if (cause instanceof EmploymentContractError) {
    const [trpcCode, errorCode, message] = domainErrors[cause.reason];
    throwServerError({ trpcCode, errorCode, message });
  }
  if (result.error.code === 'INTERNAL_SERVER_ERROR' && !(cause instanceof ServerErrorWithCode)) {
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'EMPLOYMENT_CONTRACT_TEMPORARILY_UNAVAILABLE',
      message: 'Employment records are temporarily unavailable; retry the same operation',
    });
  }
  return result;
});
