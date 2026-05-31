/**
 * Desktop session singleton (ENG-025 vector 1).
 *
 * The Electron preload exposes a `db.*` / `sync.*` IPC bridge that
 * historically accepted the `tenantId` as a renderer-supplied
 * argument. That contract was a breach: any code in the renderer
 * (incl. before login, or a compromised dependency) could call
 * `window.db.deleteByTenant('sales', '<other-tenant-id>')` and bypass
 * every multi-tenant guard the tRPC layer enforces.
 *
 * This module closes that breach by holding the authenticated
 * identity server-side. After a successful login the renderer
 * dispatches `session:register({ accessToken })`; main validates the
 * token via `verifyTokenWithServer` (the embedded Fastify instance
 * provides `jwt.verify` + the DB) and stores the payload. Every
 * `db:*` / `sync:*` handler then reads `tenantId` / `userId` / `role`
 * from this singleton instead of trusting the renderer.
 *
 * The singleton is process-wide because Electron's main process is
 * single-threaded; one `BrowserWindow` (the production layout uses
 * exactly one) maps to one logged-in operator at a time. If a future
 * design ever needs per-window sessions, this file is the seam.
 *
 * @module main/session/desktopSession
 */

import { createModuleLogger, type AuthTokenPayload } from '@puntovivo/server';

const sessionLog = createModuleLogger('desktop-session');

/**
 * Verifier signature shared by `register()` callers. Production code
 * passes a closure over `verifyTokenWithServer(server.app, _, 'access')`;
 * tests pass a stub that returns a fabricated payload (or null) without
 * booting Fastify.
 */
export type AccessTokenVerifier = (
  token: string
) => Promise<AuthTokenPayload | null>;

/**
 * Error thrown when an IPC handler runs without a registered
 * session. The renderer can catch the message and prompt the user to
 * log in again. The string is stable so tests can match against it.
 */
export const SESSION_NOT_REGISTERED = 'SESSION_NOT_REGISTERED';

/**
 * Error thrown when `register()` cannot validate the supplied access
 * token (expired, forged, stale `sessionVersion`, deactivated
 * tenant/user, or malformed). Renderer catches this to drive the user
 * back to the login screen.
 */
export const SESSION_REGISTER_REJECTED = 'SESSION_REGISTER_REJECTED';
export const SESSION_ROLE_FORBIDDEN = 'SESSION_ROLE_FORBIDDEN';

interface DesktopSessionState {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  sessionVersion: number;
  registeredAt: number;
}

let current: DesktopSessionState | null = null;

/**
 * Validate the renderer-supplied access token and store the
 * authenticated identity for subsequent IPC handlers.
 *
 * @param accessToken The bearer token the renderer just received from
 *               `auth.login` (or a successful `auth.refresh`).
 * @param verify Closure that resolves the token to an `AuthTokenPayload`
 *               (or `null` when invalid). Production callers pass
 *               `t => verifyTokenWithServer(server.app, t, 'access')`;
 *               tests pass a stub.
 * @throws Error(SESSION_REGISTER_REJECTED) when the token cannot be
 *               validated. Caller should treat this as "log out".
 */
export async function register(
  accessToken: string,
  verify: AccessTokenVerifier
): Promise<void> {
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    sessionLog.warn({ reason: 'empty-token' }, 'session:register rejected');
    throw new Error(SESSION_REGISTER_REJECTED);
  }
  const payload = await verify(accessToken);
  if (!payload) {
    sessionLog.warn(
      { reason: 'verifier-returned-null' },
      'session:register rejected (token invalid / expired / stale sessionVersion)'
    );
    throw new Error(SESSION_REGISTER_REJECTED);
  }
  current = {
    userId: payload.userId,
    tenantId: payload.tenantId,
    email: payload.email,
    role: payload.role,
    sessionVersion: payload.sessionVersion,
    registeredAt: Date.now(),
  };
  sessionLog.info(
    {
      userId: payload.userId,
      tenantId: payload.tenantId,
      role: payload.role,
    },
    'desktop session registered'
  );
}

/**
 * Wipe the stored session. Called on logout. Idempotent.
 */
export function clear(): void {
  if (current) {
    sessionLog.info(
      { userId: current.userId, tenantId: current.tenantId },
      'desktop session cleared'
    );
  }
  current = null;
}

/**
 * Return the currently registered session, or `null` when no user is
 * logged in. Tests use this for assertions; production code should
 * prefer the `require*` helpers below to fail loud on missing state.
 */
export function peek(): Readonly<DesktopSessionState> | null {
  return current ? { ...current } : null;
}

/**
 * Return the active tenant id. Throws `SESSION_NOT_REGISTERED` when
 * no session is loaded — IPC handlers MUST gate on this rather than
 * accept a tenant id from the renderer.
 */
export function requireTenantId(): string {
  if (!current) throw new Error(SESSION_NOT_REGISTERED);
  return current.tenantId;
}

export function requireUserId(): string {
  if (!current) throw new Error(SESSION_NOT_REGISTERED);
  return current.userId;
}

export function requireRole(): string {
  if (!current) throw new Error(SESSION_NOT_REGISTERED);
  return current.role;
}

export function requireOneOfRoles(allowedRoles: readonly string[]): string {
  const role = requireRole();
  if (!allowedRoles.includes(role)) throw new Error(SESSION_ROLE_FORBIDDEN);
  return role;
}

/**
 * Returns true when an arbitrary tenant id matches the registered
 * session — defensive helper for handlers that historically accepted
 * a `tenantId` argument and want to log a warning when the renderer
 * passes a mismatch.
 */
export function matchesTenant(tenantId: string | undefined | null): boolean {
  if (!current) return false;
  if (typeof tenantId !== 'string' || tenantId.length === 0) return false;
  return tenantId === current.tenantId;
}

/**
 * Test-only helper that fully resets the singleton. Production code
 * uses `clear()`. Tests use `__resetForTests` so the type signature
 * makes the intent obvious in suite setup.
 */
export function __resetForTests(): void {
  current = null;
}

/**
 * Audit-friendly summary for logging — never returns the raw token,
 * only the identity claims.
 */
export function describe(): {
  registered: boolean;
  userId?: string;
  tenantId?: string;
  role?: string;
} {
  if (!current) return { registered: false };
  return {
    registered: true,
    userId: current.userId,
    tenantId: current.tenantId,
    role: current.role,
  };
}
