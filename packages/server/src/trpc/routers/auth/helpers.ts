/**
 * Auth router shared helpers ( split).
 *
 * Leaf module: the HTTP-only refresh cookie setter (strict SameSite).
 * Imported by mutations.ts.
 *
 * @module trpc/routers/auth/helpers
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { REFRESH_COOKIE_NAME } from '../../../security/authTokens.js';
import { shouldUseSecureCookies } from '../../../security/cookies.js';

const REFRESH_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function setRefreshCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string
): void {
  if (typeof reply.setCookie !== 'function') {
    return;
  }

  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureCookies(request),
    path: '/',
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  });
}
