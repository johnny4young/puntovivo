import { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { shouldUseSecureCookies } from './cookies.js';

export const CSRF_COOKIE_NAME = 'puntovivo_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isValidCsrfToken(token: string | undefined | null): token is string {
  return typeof token === 'string' && CSRF_TOKEN_PATTERN.test(token);
}

export function ensureCsrfCookie(request: FastifyRequest, reply: FastifyReply): string {
  const existingToken = request.cookies[CSRF_COOKIE_NAME];
  if (isValidCsrfToken(existingToken)) {
    return existingToken;
  }

  const token = randomBytes(32).toString('base64url');
  reply.setCookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request),
    path: '/',
  });

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

  return (
    headerBuffer.length === cookieBuffer.length &&
    timingSafeEqual(headerBuffer, cookieBuffer)
  );
}
