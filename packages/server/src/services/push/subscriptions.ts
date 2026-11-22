/**
 * Push subscriptions: one row per browser endpoint, owned by one user.
 *
 * @module services/push/subscriptions
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { pushSubscriptions, type PushLanguage } from '../../db/schema.js';
import { sealSubscriptionKeys } from './key-store.js';
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
 * person on the same phone moves to that person; the oldest rows beyond the
 * per-user cap are dropped.
 */
export function savePushSubscription(db: DatabaseInstance, input: SavePushSubscriptionInput): void {
  const now = new Date().toISOString();
  const sealedKeys = sealSubscriptionKeys(input.endpoint, input.keys);
  db.transaction(tx => {
    tx.insert(pushSubscriptions)
      .values({
        id: nanoid(),
        tenantId: input.tenantId,
        userId: input.userId,
        endpoint: input.endpoint,
        sealedKeys,
        language: input.language,
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
  });
}

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
      .where(ownedEndpoint(input))
      .get()?.language ?? null
  );
}
