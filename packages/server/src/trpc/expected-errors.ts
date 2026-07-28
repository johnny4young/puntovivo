/**
 * Expected tRPC control-flow errors.
 *
 * Client mistakes, authorization decisions, business conflicts, and rate
 * limits are normal rejected requests. They belong in the request audit trail
 * at info level, not in the operational incident stream. Server failures keep
 * the error/capture path.
 *
 * A renderer also starts on an anonymous route by probing `auth.refresh` so it
 * can restore an httpOnly-cookie session when one exists. No refresh cookie is
 * the normal signed-out state. Keep the exception narrow: an invalid supplied
 * cookie still follows the incident path because it can indicate a stolen,
 * replayed, or corrupted credential.
 *
 * @module trpc/expected-errors
 */

import { REFRESH_COOKIE_NAME } from '../security/authTokens.js';

interface RequestWithCookies {
  cookies?: Record<string, unknown> | undefined;
}

const EXPECTED_CLIENT_CODES = new Set([
  'PARSE_ERROR',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'PAYMENT_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_SUPPORTED',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE_CONTENT',
  'TOO_MANY_REQUESTS',
  'CLIENT_CLOSED_REQUEST',
]);

export interface ExpectedTrpcControlFlow {
  code: string;
  reason: 'missing_refresh_cookie' | 'client_rejection';
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function isMissingRefreshError(error: unknown): boolean {
  if (getErrorCode(error) !== 'UNAUTHORIZED') {
    return false;
  }

  const candidate = error as { cause?: unknown; message?: unknown };
  if (
    candidate.cause &&
    typeof candidate.cause === 'object' &&
    (candidate.cause as { errorCode?: unknown }).errorCode === 'AUTH_REFRESH_INVALID'
  ) {
    return true;
  }

  // Electron's bundled tRPC runtime preserves the public code/message but can
  // flatten the custom cause while the error crosses its middleware boundary.
  // Keep the fallback exact (including the bundled duplicated form) and apply
  // it only after auth.refresh + no-cookie have already been established by
  // the caller. An invalid supplied cookie therefore still remains an incident.
  const expected = 'Refresh session is invalid or missing';
  return candidate.message === expected || candidate.message === `${expected}: ${expected}`;
}

export function isExpectedMissingRefresh(
  path: string | undefined,
  error: unknown,
  request: RequestWithCookies | undefined
): boolean {
  return (
    path === 'auth.refresh' &&
    typeof request?.cookies?.[REFRESH_COOKIE_NAME] !== 'string' &&
    isMissingRefreshError(error)
  );
}

export function classifyExpectedTrpcControlFlow(
  path: string | undefined,
  error: unknown,
  request: RequestWithCookies | undefined
): ExpectedTrpcControlFlow | null {
  if (isExpectedMissingRefresh(path, error, request)) {
    return {
      code: 'UNAUTHORIZED',
      reason: 'missing_refresh_cookie',
    };
  }

  const code = getErrorCode(error);
  if (!code || !EXPECTED_CLIENT_CODES.has(code)) {
    return null;
  }

  const hasSuppliedRefreshCookie =
    path === 'auth.refresh' && typeof request?.cookies?.[REFRESH_COOKIE_NAME] === 'string';
  if (code === 'UNAUTHORIZED' && hasSuppliedRefreshCookie) {
    return null;
  }

  return {
    code,
    reason: 'client_rejection',
  };
}
