import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { accountRecoveryCodes, tenants, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { hashPasswordSecurely } from '../../security/passwords.js';
import { registerSuccess as registerLoginSuccess } from '../../security/loginRateLimit.js';
import { applyRecoveredPassword } from '../../security/accountRecovery.js';
import { localOwnerRecoveryInput } from '../../trpc/schemas/auth.js';
import { writeAuditLog } from '../audit-logs.js';

/** Process-owned capability; only privileged launchers may call it, never HTTP handlers. */
export interface LocalOwnerRecoveryController {
  isAvailable: () => boolean;
  recover: (input: unknown) => Promise<{ recovered: true }>;
}

type RecoveryReader = Pick<DatabaseInstance, 'select'>;

interface EligibleOwner {
  id: string;
  tenantId: string;
  email: string;
}

/**
 * Sitting at the computer is the only proof a pre-code installation can offer,
 * so it only counts when nobody else could be impersonating the owner: one
 * active user, an admin, without a recovery code of their own.
 */
function findEligibleOwner(reader: RecoveryReader): EligibleOwner | null {
  const active = reader
    .select({ id: users.id, tenantId: users.tenantId, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.isActive, true))
    .limit(2)
    .all();
  const owner = active.length === 1 ? active[0] : undefined;
  if (!owner || owner.role !== 'admin') return null;
  const tenant = reader
    .select({ isActive: tenants.isActive })
    .from(tenants)
    .where(eq(tenants.id, owner.tenantId))
    .get();
  if (!tenant?.isActive) return null;
  const code = reader
    .select({ userId: accountRecoveryCodes.userId })
    .from(accountRecoveryCodes)
    .where(eq(accountRecoveryCodes.userId, owner.id))
    .get();
  return code ? null : { id: owner.id, tenantId: owner.tenantId, email: owner.email };
}

function unavailable(): never {
  throwServerError({
    trpcCode: 'FORBIDDEN',
    errorCode: 'AUTH_LOCAL_RECOVERY_UNAVAILABLE',
    message: 'This installation cannot reset the owner password from this computer',
  });
}

export function createLocalOwnerRecovery(db: DatabaseInstance): LocalOwnerRecoveryController {
  let hashing = false;
  let attempts = 0;
  let windowStartedAt = Date.now();

  return {
    isAvailable: () => findEligibleOwner(db) !== null,
    async recover(input) {
      const parsed = localOwnerRecoveryInput.safeParse(input);
      if (!parsed.success) {
        const policy = parsed.error.issues.some(issue => issue.path[0] === 'newPassword');
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: policy ? 'AUTH_PASSWORD_POLICY' : 'AUTH_LOCAL_RECOVERY_EMAIL_MISMATCH',
          message: 'Enter the owner email and a password that meets the policy',
        });
      }
      // Same budget as first-run setup: one Argon2 hash at a time, five per minute.
      if (Date.now() - windowStartedAt >= 60_000) {
        attempts = 0;
        windowStartedAt = Date.now();
      }
      if (hashing || attempts >= 5) {
        throwServerError({
          trpcCode: 'TOO_MANY_REQUESTS',
          errorCode: 'AUTH_LOCAL_RECOVERY_BUSY',
          message: 'Password recovery is busy; retry shortly',
        });
      }
      attempts += 1;

      const owner = findEligibleOwner(db);
      if (!owner) unavailable();
      if (owner.email.toLowerCase() !== parsed.data.email) {
        throwServerError({
          trpcCode: 'UNAUTHORIZED',
          errorCode: 'AUTH_LOCAL_RECOVERY_EMAIL_MISMATCH',
          message: 'This email does not belong to the owner of this installation',
        });
      }

      hashing = true;
      try {
        const passwordHash = await hashPasswordSecurely(parsed.data.newPassword);
        db.transaction(
          tx => {
            if (findEligibleOwner(tx)?.id !== owner.id) unavailable();
            const now = new Date().toISOString();
            if (
              !applyRecoveredPassword(tx, {
                tenantId: owner.tenantId,
                userId: owner.id,
                passwordHash,
                now,
              })
            ) {
              unavailable();
            }
            writeAuditLog({
              tx,
              tenantId: owner.tenantId,
              actorId: owner.id,
              action: 'auth.owner_recovered_locally',
              resourceType: 'user',
              resourceId: owner.id,
            });
          },
          { behavior: 'immediate' }
        );
        registerLoginSuccess(db, owner.email);
        return { recovered: true };
      } finally {
        hashing = false;
      }
    },
  };
}
