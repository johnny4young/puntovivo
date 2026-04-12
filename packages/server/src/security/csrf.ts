import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const CSRF_COOKIE_NAME = 'puntovivo_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function shouldUseSecureCookies(request: FastifyRequest): boolean {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const normalizedForwardedProto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto;

  return request.protocol === 'https' || normalizedForwardedProto === 'https';
}

export function ensureCsrfCookie(request: FastifyRequest, reply: FastifyReply): string {
  const existingToken = request.cookies[CSRF_COOKIE_NAME];
  if (existingToken) {
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
