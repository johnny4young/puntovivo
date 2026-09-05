/** Unknown storage failures are outcome-uncertain; retain retry identity without exposing internals. */
import { ServerErrorWithCode, throwServerError } from '../../lib/errorCodes.js';
import { middleware } from '../init.js';

export const timeOffErrors = middleware(async ({ next }) => {
  const result = await next();
  if (
    !result.ok &&
    result.error.code === 'INTERNAL_SERVER_ERROR' &&
    !(result.error.cause instanceof ServerErrorWithCode)
  )
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'TIME_OFF_TEMPORARILY_UNAVAILABLE',
      message: 'Time-off records are temporarily unavailable; retry the same operation',
    });
  return result;
});
