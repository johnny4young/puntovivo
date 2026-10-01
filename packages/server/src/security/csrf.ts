import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { shouldUseSecureCookies } from './cookies.js';

export const CSRF_COOKIE_NAME = 'puntovivo_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_CSRF_TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/;
const SESSION_CSRF_KEY_CONTEXT = 'puntovivo/csrf/session/v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Refresh-family identity remains stable when its JWT jti rotates. */
export interface SessionCsrfIdentity {
  familyId: string;
  tenantId: string;
  userId: string;
  sessionVersion: number;
}

/**
 * Mint an opaque, deterministic CSRF companion for one authenticated login.
 * The JWT signing secret is purpose-separated before use as an HMAC key;
 * no family, user, or tenant identifier appears in the JS-readable cookie.
 * A caller must still verify the refresh JWT and live family row separately.
 */
export function createSessionCsrfToken(jwtSecret: string, identity: SessionCsrfIdentity): string {
  if (
    !jwtSecret ||
    !identity.familyId ||
    !identity.tenantId ||
    !identity.userId ||
    !Number.isSafeInteger(identity.sessionVersion) ||
    identity.sessionVersion < 0
  ) {
    throw new Error('A valid signing secret and refresh-family identity are required');
  }

  const key = createHmac('sha256', jwtSecret).update(SESSION_CSRF_KEY_CONTEXT).digest();
  const mac = createHmac('sha256', key);
  for (const value of [
    identity.familyId,
    identity.tenantId,
    identity.userId,
    String(identity.sessionVersion),
  ]) {
    mac
      .update(String(Buffer.byteLength(value, 'utf8')))
      .update(':')
      .update(value);
  }
  return `v1.${mac.digest('base64url')}`;
}

/** Cookie/header equality alone is insufficient: both must match the session. */
export function csrfTokensMatchSession(
  jwtSecret: string,
  identity: SessionCsrfIdentity,
  cookieToken: string | undefined | null,
  headerToken: string | null
): boolean {
  return csrfTokensMatchExpected(
    createSessionCsrfToken(jwtSecret, identity),
    cookieToken,
    headerToken
  );
}

/**
 * Migration-only proof bound to an already verified legacy refresh JWT.
 * It never authorizes business mutations; the exact refresh endpoint exchanges
 * it for a family-bound companion. A separate key context prevents cross-use.
 */
export function createLegacySessionCsrfToken(
  jwtSecret: string,
  verifiedRefreshToken: string
): string {
  if (!jwtSecret || !verifiedRefreshToken) {
    throw new Error('A signing secret and verified legacy refresh token are required');
  }
  const key = createHmac('sha256', jwtSecret).update('puntovivo/csrf/legacy-upgrade/v1').digest();
  return `v1.${createHmac('sha256', key).update(verifiedRefreshToken).digest('base64url')}`;
}

/** Validate the legacy upgrade proof only after signature and live-user checks. */
export function csrfTokensMatchLegacySession(
  jwtSecret: string,
  verifiedRefreshToken: string,
  cookieToken: string | undefined | null,
  headerToken: string | null
): boolean {
  return csrfTokensMatchExpected(
    createLegacySessionCsrfToken(jwtSecret, verifiedRefreshToken),
    cookieToken,
    headerToken
  );
}

function csrfTokensMatchExpected(
  expectedToken: string,
  cookieToken: string | undefined | null,
  headerToken: string | null
): boolean {
  const header = headerToken ?? '';
  if (
    typeof cookieToken !== 'string' ||
    !SESSION_CSRF_TOKEN_PATTERN.test(cookieToken) ||
    !SESSION_CSRF_TOKEN_PATTERN.test(header)
  ) {
    return false;
  }

  const expected = Buffer.from(expectedToken, 'utf8');
  const cookieValid = timingSafeEqual(Buffer.from(cookieToken, 'utf8'), expected);
  const headerValid = timingSafeEqual(Buffer.from(header, 'utf8'), expected);
  return cookieValid && headerValid;
}

export function isValidCsrfToken(token: string | undefined | null): token is string {
  return typeof token === 'string' && CSRF_TOKEN_PATTERN.test(token);
}

export function isSessionCsrfToken(token: string | undefined | null): token is string {
  return typeof token === 'string' && SESSION_CSRF_TOKEN_PATTERN.test(token);
}

function setCsrfCookie(request: FastifyRequest, reply: FastifyReply, token: string): void {
  if (typeof reply.setCookie !== 'function') {
    return;
  }
  reply.setCookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request),
    path: '/',
  });
}

/** Replace a pre-login companion whenever a new refresh family is issued. */
export function setSessionCsrfCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string
): void {
  setCsrfCookie(request, reply, token);
}

/** Remove a companion when its authenticated family is revoked or rejected. */
export function clearSessionCsrfCookie(request: FastifyRequest, reply: FastifyReply): void {
  if (typeof reply.clearCookie !== 'function') {
    return;
  }
  reply.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request),
    path: '/',
  });
}

export function ensureCsrfCookie(request: FastifyRequest, reply: FastifyReply): string {
  const existingToken = request.cookies[CSRF_COOKIE_NAME];
  if (isValidCsrfToken(existingToken)) {
    return existingToken;
  }

  const token = randomBytes(32).toString('base64url');
  setCsrfCookie(request, reply, token);

  return token;
}

export function isUnsafeMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function getCsrfHeader(request: FastifyRequest): string | null {
  const headerValue = request.headers[CSRF_HEADER_NAME];
  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }

  return typeof headerValue === 'string' ? headerValue : null;
}

export function csrfTokensMatch(headerToken: string | null, cookieToken: string): boolean {
  if (!isValidCsrfToken(headerToken) || !isValidCsrfToken(cookieToken)) {
    return false;
  }

  const headerBuffer = Buffer.from(headerToken, 'utf8');
  const cookieBuffer = Buffer.from(cookieToken, 'utf8');

  return headerBuffer.length === cookieBuffer.length && timingSafeEqual(headerBuffer, cookieBuffer);
}
