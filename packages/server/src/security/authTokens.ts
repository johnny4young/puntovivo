import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { tenants, users } from '../db/schema.js';
import { shouldUseSecureCookies } from './cookies.js';

export const REFRESH_COOKIE_NAME = 'puntovivo_refresh';
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export type AuthTokenType = 'access' | 'refresh';

export interface AuthTokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  sessionVersion: number;
  tokenType: AuthTokenType;
}

interface AuthUserIdentity {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  sessionVersion: number;
}

function buildTokenPayload(user: AuthUserIdentity, tokenType: AuthTokenType): AuthTokenPayload {
  return {
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
    sessionVersion: user.sessionVersion,
    tokenType,
  };
}

export function signAccessToken(server: FastifyInstance, user: AuthUserIdentity): string {
  return server.jwt.sign(buildTokenPayload(user, 'access'), {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function signRefreshToken(server: FastifyInstance, user: AuthUserIdentity): string {
  return server.jwt.sign(buildTokenPayload(user, 'refresh'), {
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

function getAuthorizationHeader(request: FastifyRequest): string | null {
  const headerValue = request.headers.authorization;
  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }

  return typeof headerValue === 'string' ? headerValue : null;
}

export function getBearerToken(request: FastifyRequest): string | null {
  const authorizationHeader = getAuthorizationHeader(request);
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

/**
 * In-process token verification.
 *
 * Receives the FastifyInstance directly (not a FastifyRequest) so that
 * non-HTTP callers — specifically the Electron main-process
 * `desktopSession` (ENG-025) — can validate tokens without faking a
 * Fastify request object. Both `verifyAccessToken` and
 * `verifyRefreshToken` collapse onto this helper for consistency: any
 * change to the verification contract (e.g. revoking on tenant
 * deactivation) lands once here.
 */
export async function verifyTokenWithServer(
  server: FastifyInstance,
  token: string | null,
  expectedType: AuthTokenType
): Promise<AuthTokenPayload | null> {
  if (!token) {
    return null;
  }

  try {
    const payload = await server.jwt.verify<AuthTokenPayload>(token);
    if (payload.tokenType !== expectedType) {
      return null;
    }

    const user = await server.db
      .select({
        email: users.email,
        role: users.role,
        tenantId: users.tenantId,
        isActive: users.isActive,
        sessionVersion: users.sessionVersion,
        tenantIsActive: tenants.isActive,
      })
      .from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(eq(users.id, payload.userId))
      .get();

    if (!user || !user.isActive || !user.tenantIsActive) {
      return null;
    }

    if (
      user.tenantId !== payload.tenantId ||
      user.email !== payload.email ||
      user.role !== payload.role ||
      user.sessionVersion !== payload.sessionVersion
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function verifyAccessToken(request: FastifyRequest): Promise<AuthTokenPayload | null> {
  return verifyTokenWithServer(request.server, getBearerToken(request), 'access');
}

export function verifyRefreshToken(request: FastifyRequest): Promise<AuthTokenPayload | null> {
  return verifyTokenWithServer(
    request.server,
    request.cookies[REFRESH_COOKIE_NAME] ?? null,
    'refresh'
  );
}

export function clearRefreshCookie(request: FastifyRequest, reply: FastifyReply): void {
  if (typeof reply.clearCookie !== 'function') {
    return;
  }

  reply.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request),
    path: '/',
  });
}
