import { randomInt } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import { accountRecoveryCodes, devices, users } from '../db/schema.js';
import { parkDraftsForIdentityChange } from '../application/sales/parkDraftsForIdentityChange.js';
import { revokeRefreshFamiliesForUser } from './refreshTokenFamilies.js';

// Crockford base32: no I, L, O or U, so a handwritten code survives retyping.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 4;
const GROUP_LENGTH = 5;

/** 100 random bits shown once as XXXXX-XXXXX-XXXXX-XXXXX. */
export function generateRecoveryCode(): string {
  return Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  ).join('-');
}

/** Canonical form that is hashed and verified: separators dropped, look-alikes folded. */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Login rate-limit key for recovery attempts, separate from password failures. */
export function recoveryAttemptKey(email: string): string {
  return `recovery:${email}`;
}

export interface RecoveredPasswordArgs {
  tenantId: string;
  userId: string;
  passwordHash: string;
  now: string;
}

/**
 * Replaces a forgotten password inside the caller's write transaction and ends
 * every session, device binding and recovery code the old identity held.
 * Returns false when the active user row did not change, so the caller can throw.
 */
export function applyRecoveredPassword(tx: DatabaseInstance, args: RecoveredPasswordArgs): boolean {
  const { tenantId, userId, passwordHash, now } = args;
  const updated = tx
    .update(users)
    .set({
      passwordHash,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: now,
    })
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.isActive, true)))
    .run();
  if (updated.changes !== 1) return false;

  parkDraftsForIdentityChange(tx, { tenantId, actorId: userId, reason: 'password_change', now });
  tx.update(devices)
    .set({
      activeUserId: null,
      identityVersion: sql`${devices.identityVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(devices.tenantId, tenantId),
        eq(devices.activeUserId, userId),
        eq(devices.isActive, true)
      )
    )
    .run();
  revokeRefreshFamiliesForUser(tx, userId);
  tx.delete(accountRecoveryCodes)
    .where(
      and(eq(accountRecoveryCodes.userId, userId), eq(accountRecoveryCodes.tenantId, tenantId))
    )
    .run();
  return true;
}
