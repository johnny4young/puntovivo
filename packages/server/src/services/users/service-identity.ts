/**
 * Service identities.
 *
 * A payment worker runs on behalf of no human: it must still leave an
 * immutable audit row, and `audit_logs.actor_id` is NOT NULL by design. The
 * answer is an explicit service identity — a `users` row with
 * `kind = 'service'`, no email, no password hash and no PIN — never a fake
 * human account and never a weakened audit column.
 *
 * The database enforces the shape (`chk_users_service_has_no_credentials`) and
 * the uniqueness (one service identity per tenant and name, partial index), so
 * concurrent callers converge on the same row instead of racing into
 * duplicates.
 *
 * @module services/users/service-identity
 */
import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { users } from '../../db/schema.js';

/** The only service identity implemented today. */
export const PAYMENT_WORKER_SERVICE_NAME = 'payment-worker';

export interface ServiceIdentity {
  id: string;
  tenantId: string;
  name: string;
}

/**
 * Get (or create) the service identity of one tenant.
 *
 * Idempotent by database constraint: the insert is attempted, and a conflict
 * on the partial unique index (tenant, name where kind='service') resolves to
 * the row another caller just created. The caller never needs a lock.
 */
export function ensureServiceIdentity(
  db: DatabaseInstance,
  args: { tenantId: string; name?: string }
): ServiceIdentity {
  const name = args.name ?? PAYMENT_WORKER_SERVICE_NAME;

  const existing = db
    .select({ id: users.id, tenantId: users.tenantId, name: users.name })
    .from(users)
    .where(
      and(eq(users.tenantId, args.tenantId), eq(users.kind, 'service'), eq(users.name, name))
    )
    .get();
  if (existing) return existing;

  const id = `service:${args.tenantId}:${name}`;
  const now = new Date().toISOString();

  try {
    db.insert(users)
      .values({
        id,
        tenantId: args.tenantId,
        kind: 'service',
        // No email, no password hash, no PIN: the CHECK constraint requires
        // all three to be absent for a service identity.
        email: null,
        name,
        passwordHash: null,
        staffPinHash: null,
        // Least privilege: a service identity never carries an admin role.
        role: 'viewer',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return { id, tenantId: args.tenantId, name };
  } catch (error) {
    // Two workers booted at once: the partial unique index rejected the
    // loser, which now reads the winner's row. Any other error is real.
    const raced = db
      .select({ id: users.id, tenantId: users.tenantId, name: users.name })
      .from(users)
      .where(
        and(eq(users.tenantId, args.tenantId), eq(users.kind, 'service'), eq(users.name, name))
      )
      .get();
    if (raced) return raced;
    throw error;
  }
}

/** Whether an actor id belongs to a service identity of this tenant. */
export function isServiceIdentity(
  db: DatabaseInstance,
  tenantId: string,
  actorId: string
): boolean {
  const row = db
    .select({ kind: users.kind })
    .from(users)
    .where(and(eq(users.id, actorId), eq(users.tenantId, tenantId)))
    .get();
  return row?.kind === 'service';
}
