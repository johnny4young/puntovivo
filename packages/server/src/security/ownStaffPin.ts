/**
 * A signed-in user confirming an action with their own staff PIN.
 *
 * @module security/ownStaffPin
 */
import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../db/index.js';
import { users } from '../db/schema.js';
import {
  checkStaffPin,
  registerStaffPinFailure,
  registerStaffPinSuccess,
} from './loginRateLimit.js';
import { getDummyStaffPinHash, verifyStaffPin } from './staffPins.js';

export type OwnStaffPinResult =
  | { status: 'ok'; name: string }
  | { status: 'no_pin'; name: string }
  | { status: 'invalid' }
  | { status: 'unknown_user' };

/**
 * `no_pin` means the user never set one, so the caller decides whether the
 * session alone is enough. Failures count against the shared PIN rate limit.
 */
export async function verifyOwnStaffPin(
  db: DatabaseInstance,
  tenantId: string,
  userId: string,
  pin: string | null
): Promise<OwnStaffPinResult> {
  const identity = { tenantId, actorUserId: userId, targetUserId: userId };
  checkStaffPin(db, identity);
  const user = db
    .select({ name: users.name, staffPinHash: users.staffPinHash })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.isActive, true)))
    .get();
  if (!user) return { status: 'unknown_user' };
  if (user.staffPinHash === null) return { status: 'no_pin', name: user.name };
  // Verify against a dummy hash when no PIN came so both failures take as long.
  const matches = await verifyStaffPin(
    pin ? user.staffPinHash : await getDummyStaffPinHash(),
    pin ?? ''
  );
  if (!pin || !matches) {
    registerStaffPinFailure(db, identity);
    return { status: 'invalid' };
  }
  registerStaffPinSuccess(db, identity);
  return { status: 'ok', name: user.name };
}
