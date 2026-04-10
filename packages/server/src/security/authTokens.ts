import type { FastifyInstance, FastifyRequest } from 'fastify';

export const REFRESH_COOKIE_NAME = 'open_yojob_refresh';
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export type AuthTokenType = 'access' | 'refresh';

export interface AuthTokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  tokenType: AuthTokenType;
}

interface AuthUserIdentity {
  id: string;
  tenantId: string;
  email: string;
  role: string;
}

function buildTokenPayload(user: AuthUserIdentity, tokenType: AuthTokenType): AuthTokenPayload {
  return {
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
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
    return payload.tokenType === expectedType ? payload : null;
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
