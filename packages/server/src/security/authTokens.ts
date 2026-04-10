import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';

export const REFRESH_COOKIE_NAME = 'open_yojob_refresh';
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

async function verifyToken(
  request: FastifyRequest,
  token: string | null,
  expectedType: AuthTokenType
): Promise<AuthTokenPayload | null> {
  if (!token) {
    return null;
  }

  try {
    const payload = await request.server.jwt.verify<AuthTokenPayload>(token);
    if (payload.tokenType !== expectedType) {
      return null;
    }

    const user = await request.server.db
      .select({
        tenantId: users.tenantId,
        isActive: users.isActive,
        sessionVersion: users.sessionVersion,
      })
      .from(users)
      .where(eq(users.id, payload.userId))
      .get();

    if (!user || !user.isActive) {
      return null;
    }

    if (user.tenantId !== payload.tenantId || user.sessionVersion !== payload.sessionVersion) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function verifyAccessToken(request: FastifyRequest): Promise<AuthTokenPayload | null> {
  return verifyToken(request, getBearerToken(request), 'access');
}

export function verifyRefreshToken(request: FastifyRequest): Promise<AuthTokenPayload | null> {
  return verifyToken(request, request.cookies[REFRESH_COOKIE_NAME] ?? null, 'refresh');
}

export function clearRefreshCookie(reply: FastifyReply): void {
  if (typeof reply.clearCookie !== 'function') {
    return;
  }

  reply.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
}
