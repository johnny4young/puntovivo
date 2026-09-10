/** External inbox failures never expose driver details, input payloads or sealed credentials. */
import { middleware } from '../init.js';
import { ServerErrorWithCode, throwServerError } from '../../lib/errorCodes.js';
export const externalOrderErrors = middleware(async ({ next }) => {
  const result = await next();
  if (
    !result.ok &&
    result.error.code === 'INTERNAL_SERVER_ERROR' &&
    !(result.error.cause instanceof ServerErrorWithCode)
  ) {
    // Domain rejections retain their safe code. Unexpected/SQLITE_BUSY failures
    // are retryable with the same identity; the writer has committed all or none.
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'EXTERNAL_ORDER_TEMPORARILY_UNAVAILABLE',
      message: 'External orders are temporarily unavailable; retry the same request',
    });
  }
  return result;
});
