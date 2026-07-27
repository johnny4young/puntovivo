/**
 * Expected tRPC control-flow errors.
 *
 * A renderer starts on an anonymous route by probing `auth.refresh` so it can
 * restore an httpOnly-cookie session when one exists. No refresh cookie is the
 * normal signed-out state, not an operational incident. Keep the distinction
 * narrow: an invalid cookie still follows the normal error/capture path.
 *
 * @module trpc/expected-errors
 */

import { TRPCError } from '@trpc/server';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { REFRESH_COOKIE_NAME } from '../security/authTokens.js';

interface RequestWithCookies {
  cookies?: Record<string, unknown> | undefined;
}

export function isExpectedMissingRefresh(
  path: string | undefined,
  error: unknown,
  request: RequestWithCookies | undefined
): boolean {
  return (
    path === 'auth.refresh' &&
    typeof request?.cookies?.[REFRESH_COOKIE_NAME] !== 'string' &&
    error instanceof TRPCError &&
    error.code === 'UNAUTHORIZED' &&
    error.cause instanceof ServerErrorWithCode &&
    error.cause.errorCode === 'AUTH_REFRESH_INVALID'
  );
}
