/** Sanitize storage failures on both sides of command reservation without hiding domain rejections. */
import { ServerErrorWithCode, throwServerError } from '../../lib/errorCodes.js';
import { middleware } from '../init.js';
export const scheduleErrors = middleware(async ({ next }) => {
  const result = await next();
  if (
    !result.ok &&
    result.error.code === 'INTERNAL_SERVER_ERROR' &&
    !(result.error.cause instanceof ServerErrorWithCode)
  ) {
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'SCHEDULE_TEMPORARILY_UNAVAILABLE',
      message: 'Schedules are temporarily unavailable; retry the same operation',
    });
  }
  return result;
});
