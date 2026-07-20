/**
 * `throwServerError` — throw a TRPCError carrying a stable code in `cause`
 * ( split).  explicit `| undefined` preserved.
 *
 * @module lib/errorCodes/throw
 */
import { TRPCError, type TRPC_ERROR_CODE_KEY } from '@trpc/server';

import { ServerErrorWithCode } from './error-with-code.js';
import type { ServerErrorCode } from './registry.js';

/**
 * Throw a TRPCError that carries a stable error code in `cause`. The `message`
 * remains an English fallback so server logs and pre-i18n callers still
 * surface something useful, but the canonical user-facing text comes from the
 * client's translation layer keyed by `errorCode`.
 *
 * @example
 * throwServerError({
 * trpcCode: 'UNAUTHORIZED',
 * errorCode: 'AUTH_INVALID_CREDENTIALS',
 * message: 'Email or password is incorrect',
 * });
 */
export function throwServerError(args: {
  trpcCode: TRPC_ERROR_CODE_KEY;
  errorCode: ServerErrorCode;
  message: string;
  // explicit `| undefined` so callers can spread
  // `{ details: maybeDetails }` (where maybeDetails is built from a
  // partial source) without violating `exactOptionalPropertyTypes`.
  details?: Record<string, unknown> | undefined;
}): never {
  throw new TRPCError({
    code: args.trpcCode,
    message: args.message,
    cause: new ServerErrorWithCode(args.errorCode, args.message, args.details),
  });
}
