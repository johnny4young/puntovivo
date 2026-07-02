/**
 * Refresh-token family rotation + reuse detection (Auditoría 2026-07).
 *
 * The refresh JWT alone cannot tell "the newest token" from "a stolen
 * copy that was already rotated away" — both verify. Each login mints a
 * *family* row whose `current_jti` always names the single valid token;
 * `auth.refresh` rotates it atomically. Presenting a verified refresh
 * token whose `jti` is NOT the family's current one is proof of replay
 * (the legitimate client already rotated past it), so the family is
 * revoked and the user's `sessionVersion` is bumped — killing every
 * outstanding access AND refresh token for that user, attacker's copy
 * included.
 *
 * Rotation atomicity relies on the conditional UPDATE
 * (`WHERE id = ? AND current_jti = ?`): better-sqlite3 is synchronous
 * and single-writer, so two racing refreshes cannot both observe
 * `changes === 1`.
 *
 * Tokens signed before this feature carry no `jti`/`familyId`; they are
 * accepted once through the legacy path and upgraded into a fresh
 * family, so a deploy does not force a fleet-wide re-login. That grace
 * closes itself: 7 days after deploy no legacy-signed token remains
 * valid.
 *
 * @module security/refreshTokenFamilies
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import { authRefreshFamilies, users } from '../db/schema.js';
import { createModuleLogger } from '../logging/logger.js';

const familyLog = createModuleLogger('security/refresh-families');

/** Mirror of the refresh JWT TTL in `security/authTokens.ts` (7d). */
export const REFRESH_FAMILY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface RefreshFamilyGrant {
  familyId: string;
  jti: string;
}

export type RefreshRotationResult =
  | { status: 'rotated'; familyId: string; jti: string }
  /** The presented jti was already rotated away — replay detected. */
  | { status: 'reused' }
  /** No live family row (revoked, pruned, or forged familyId). */
  | { status: 'missing' };

function nowIso(now: () => number): string {
  return new Date(now()).toISOString();
}

/**
 * Start a new family (login, or legacy-token upgrade). Returns the grant
 * to embed in the signed refresh token.
 */
export function createRefreshFamily(
  db: DatabaseInstance,
  args: { tenantId: string; userId: string; now?: () => number }
): RefreshFamilyGrant {
  const now = args.now ?? (() => Date.now());
  const grant: RefreshFamilyGrant = { familyId: nanoid(), jti: nanoid() };
  db.insert(authRefreshFamilies)
    .values({
      id: grant.familyId,
      tenantId: args.tenantId,
      userId: args.userId,
      currentJti: grant.jti,
      issuedAt: nowIso(now),
      lastRotatedAt: nowIso(now),
      expiresAt: new Date(now() + REFRESH_FAMILY_TTL_MS).toISOString(),
    })
    .run();
  return grant;
}

/**
 * Atomically rotate the family to a fresh jti if — and only if — the
 * presented jti is the family's current one. On a jti mismatch of a
 * still-live family, this is a replay: the family is revoked and the
 * user's `sessionVersion` is bumped inside the same transaction.
 */
export function rotateRefreshFamily(
  db: DatabaseInstance,
  args: {
    familyId: string;
    presentedJti: string;
    userId: string;
    now?: () => number;
  }
): RefreshRotationResult {
  const now = args.now ?? (() => Date.now());
  const nextJti = nanoid();

  return db.transaction(tx => {
    const updated = tx
      .update(authRefreshFamilies)
      .set({
        currentJti: nextJti,
        lastRotatedAt: nowIso(now),
        expiresAt: new Date(now() + REFRESH_FAMILY_TTL_MS).toISOString(),
      })
      .where(
        and(
          eq(authRefreshFamilies.id, args.familyId),
          eq(authRefreshFamilies.userId, args.userId),
          eq(authRefreshFamilies.currentJti, args.presentedJti)
        )
      )
      .run() as { changes?: number };

    if ((updated.changes ?? 0) === 1) {
      return { status: 'rotated', familyId: args.familyId, jti: nextJti };
    }

    const family = tx
      .select({ id: authRefreshFamilies.id, userId: authRefreshFamilies.userId })
      .from(authRefreshFamilies)
      .where(eq(authRefreshFamilies.id, args.familyId))
      .get();

    if (!family || family.userId !== args.userId) {
      return { status: 'missing' };
    }

    // Live family + verified token + stale jti ⇒ replay. Revoke the
    // family and kill every outstanding token for the user.
    tx.delete(authRefreshFamilies)
      .where(eq(authRefreshFamilies.id, args.familyId))
      .run();
    tx.update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, args.userId))
      .run();
    familyLog.warn(
      { familyId: args.familyId, userId: args.userId },
      'refresh token replay detected — family revoked, sessionVersion bumped'
    );
    return { status: 'reused' };
  });
}

/**
 * Drop every family for a user (logout, password change). The
 * `sessionVersion` bump those flows already perform is what invalidates
 * the JWTs; this keeps the table from accumulating dead rows.
 */
export function revokeRefreshFamiliesForUser(db: DatabaseInstance, userId: string): number {
  const result = db
    .delete(authRefreshFamilies)
    .where(eq(authRefreshFamilies.userId, userId))
    .run() as { changes?: number };
  return result.changes ?? 0;
}

/**
 * Prune expired families. Called opportunistically from `auth.login`
 * (low frequency, indexed delete) so no dedicated worker is needed.
 */
export function pruneExpiredRefreshFamilies(
  db: DatabaseInstance,
  now: () => number = () => Date.now()
): number {
  const result = db
    .delete(authRefreshFamilies)
    .where(lt(authRefreshFamilies.expiresAt, new Date(now()).toISOString()))
    .run() as { changes?: number };
  const deleted = result.changes ?? 0;
  if (deleted > 0) {
    familyLog.info({ deleted }, 'pruned expired refresh families');
  }
  return deleted;
}
