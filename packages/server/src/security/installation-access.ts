import type { FastifyRequest } from 'fastify';
import { throwServerError } from '../lib/errorCodes.js';
import { CSRF_COOKIE_NAME, csrfTokensMatch, getCsrfHeader } from './csrf.js';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Owner credentials may only cross the local setup channel. Use the actual
 * socket, not proxy-controlled IP/protocol headers. A remote hub must be
 * provisioned locally (or through an operator-owned loopback tunnel).
 */
export function assertInstallationSetupAccess(request: FastifyRequest): void {
  const origin = request.headers.origin;
  let localOrigin = origin === 'puntovivo-app://app';
  if (typeof origin === 'string' && !localOrigin) {
    try {
      const url = new URL(origin);
      localOrigin =
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
        url.origin === origin;
    } catch {
      localOrigin = false;
    }
  }
  if (!LOOPBACK_ADDRESSES.has(request.raw.socket.remoteAddress ?? '') || !localOrigin) {
    throwServerError({
      trpcCode: 'FORBIDDEN',
      errorCode: 'SETUP_LOCAL_ACCESS_REQUIRED',
      message: 'Create the installation owner from this computer, not a remote HTTP connection',
    });
  }
  // The ordinary hook requires a refresh cookie; first-run users have none.
  // Enforce double-submit independently instead of inheriting that exception.
  const cookie = request.cookies[CSRF_COOKIE_NAME];
  if (typeof cookie !== 'string' || !csrfTokensMatch(getCsrfHeader(request), cookie)) {
    throwServerError({
      trpcCode: 'FORBIDDEN',
      errorCode: 'SETUP_CSRF_REQUIRED',
      message: 'Reload the installation page before submitting again',
    });
  }
}
