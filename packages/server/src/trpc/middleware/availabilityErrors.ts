/** Storage failures retain safe retry identity; never reveal private SQLite statements. */
import { ServerErrorWithCode, throwServerError } from '../../lib/errorCodes.js';
import { middleware } from '../init.js';
export const availabilityErrors = middleware(async ({ next }) => {
  const result = await next();
  if (
    !result.ok &&
    result.error.code === 'INTERNAL_SERVER_ERROR' &&
    !(result.error.cause instanceof ServerErrorWithCode)
  )
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'AVAILABILITY_TEMPORARILY_UNAVAILABLE',
      message: 'Availability is temporarily unavailable; retry the same operation',
    });
  return result;
});
