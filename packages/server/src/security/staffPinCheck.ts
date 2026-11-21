import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../db/index.js';
import { users } from '../db/schema.js';
import {
  checkStaffPin,
  registerStaffPinFailure,
  registerStaffPinSuccess,
} from './loginRateLimit.js';
import { getDummyStaffPinHash, verifyStaffPin } from './staffPins.js';

/** The user's enrolled staff PIN hash, or null without one. */
export function readStaffPinHash(
  db: DatabaseInstance,
  tenantId: string,
  userId: string
): string | null {
  const row = db
    .select({ staffPinHash: users.staffPinHash })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .get();
  return row?.staffPinHash ?? null;
}

/**
 * Verify the actor's own staff PIN against a hash already read, through the
 * shared throttle. Without a hash it still pays the cost against a dummy so
 * timing does not reveal who has a PIN.
 */
export async function verifyOwnStaffPin(
  db: DatabaseInstance,
  identity: { tenantId: string; userId: string; staffPinHash: string | null },
  pin: string
): Promise<boolean> {
  const throttle = {
    tenantId: identity.tenantId,
    actorUserId: identity.userId,
    targetUserId: identity.userId,
  };
  checkStaffPin(db, throttle);
  const matches = await verifyStaffPin(
    identity.staffPinHash ?? (await getDummyStaffPinHash()),
    pin
  );
  if (!identity.staffPinHash || !matches) {
    registerStaffPinFailure(db, throttle);
    return false;
  }
  registerStaffPinSuccess(db, throttle);
  return true;
}
