/**
 * Push subscriptions: one row per browser endpoint, owned by one user.
 *
 * @module services/push/subscriptions
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { pushSubscriptions, users, type PushLanguage } from '../../db/schema.js';
import { openSubscriptionKeys, sealSubscriptionKeys } from './key-store.js';
import type { PushSubscriptionKeys } from './web-push.js';

export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

export interface SavePushSubscriptionInput {
  tenantId: string;
  userId: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  language: PushLanguage;
}

/**
 * Insert or refresh the endpoint's row. A browser re-subscribed by another
 * person on the same phone moves to that person, but only with the same keys:
 * knowing an endpoint URL is not proof of holding that browser. The oldest
 * rows beyond the per-user cap are dropped. True when the endpoint is new to
 * this person; a refresh of their own row (a language change) returns false.
 */
export function savePushSubscription(
  db: DatabaseInstance,
  input: SavePushSubscriptionInput
): boolean {
  const now = new Date().toISOString();
  const sealedKeys = sealSubscriptionKeys(input.endpoint, input.keys);
  return db.transaction(tx => {
    const owner = tx
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.tenantId, input.tenantId)))
      .get();
    if (!owner) throw new Error('PUSH_OWNER_NOT_FOUND');
    const existing = tx
      .select({
        tenantId: pushSubscriptions.tenantId,
        userId: pushSubscriptions.userId,
        sealedKeys: pushSubscriptions.sealedKeys,
        sessionVersion: pushSubscriptions.sessionVersion,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, input.endpoint))
      .get();
    if (
      existing &&
      (existing.tenantId !== input.tenantId || existing.userId !== input.userId) &&
      !sameKeys(input.endpoint, existing.sealedKeys, input.keys)
    ) {
      throw new Error('PUSH_ENDPOINT_TAKEN');
    }
    tx.insert(pushSubscriptions)
      .values({
        id: nanoid(),
        tenantId: input.tenantId,
        userId: input.userId,
        endpoint: input.endpoint,
        sealedKeys,
        language: input.language,
        sessionVersion: owner.sessionVersion,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          tenantId: input.tenantId,
          userId: input.userId,
          sealedKeys,
          language: input.language,
          sessionVersion: owner.sessionVersion,
          updatedAt: now,
        },
      })
      .run();

    const owned = tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.tenantId, input.tenantId),
          eq(pushSubscriptions.userId, input.userId)
        )
      )
      .orderBy(asc(pushSubscriptions.updatedAt), asc(pushSubscriptions.createdAt))
      .all();
    const excess = owned.slice(0, Math.max(0, owned.length - MAX_PUSH_SUBSCRIPTIONS_PER_USER));
    if (excess.length > 0) {
      tx.delete(pushSubscriptions)
        .where(
          inArray(
            pushSubscriptions.id,
            excess.map(row => row.id)
          )
        )
        .run();
    }
    return (
      !existing ||
      existing.tenantId !== input.tenantId ||
      existing.userId !== input.userId ||
      existing.sessionVersion !== owner.sessionVersion
    );
  });
}

function sameKeys(endpoint: string, sealed: string, keys: PushSubscriptionKeys): boolean {
  try {
    const stored = openSubscriptionKeys(endpoint, sealed);
    return stored.p256dh === keys.p256dh && stored.auth === keys.auth;
  } catch {
    // Sealed under an earlier database key: the row can no longer be delivered.
    return true;
  }
}

/** Rows subscribed before the owner's sessions were last revoked stay silent. */
export const liveSession = and(
  eq(users.id, pushSubscriptions.userId),
  eq(users.sessionVersion, pushSubscriptions.sessionVersion)
);

interface OwnedEndpoint {
  tenantId: string;
  userId: string;
  endpoint: string;
}

const ownedEndpoint = (input: OwnedEndpoint) =>
  and(
    eq(pushSubscriptions.tenantId, input.tenantId),
    eq(pushSubscriptions.userId, input.userId),
    eq(pushSubscriptions.endpoint, input.endpoint)
  );

export function removePushSubscription(db: DatabaseInstance, input: OwnedEndpoint): void {
  db.delete(pushSubscriptions).where(ownedEndpoint(input)).run();
}

/** The language a caller's endpoint is subscribed in, or null when it is not subscribed. */
export function findPushSubscriptionLanguage(
  db: DatabaseInstance,
  input: OwnedEndpoint
): PushLanguage | null {
  return (
    db
      .select({ language: pushSubscriptions.language })
      .from(pushSubscriptions)
      .innerJoin(users, liveSession)
      .where(ownedEndpoint(input))
      .get()?.language ?? null
  );
}
