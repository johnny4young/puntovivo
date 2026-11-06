/**
 * Auth router — forgotten-password recovery codes.
 *
 * Admins generate a one-use code while signed in; anyone holding it can set a
 * new password from the sign-in screen. Every failure branch returns the same
 * error and pays the same Argon2 cost, so the procedure cannot enumerate accounts.
 *
 * @module trpc/routers/auth/recovery
 */
import { and, eq } from 'drizzle-orm';
import { publicProcedure } from '../../init.js';
import { adminProcedure } from '../../middleware/roles.js';
import { rateLimitFor } from '../../middleware/procedureRateLimit.js';
import { accountRecoveryCodes, tenants, users } from '../../../db/schema.js';
import { generateRecoveryCodeInput, recoverWithCodeInput } from '../../schemas/auth.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import {
  getDummyPasswordHash,
  hashPasswordSecurely,
  verifyPasswordSecurely,
} from '../../../security/passwords.js';
import {
  checkIp as checkLoginIp,
  checkUsername as checkLoginUsername,
  registerFailure as registerLoginFailure,
  registerSuccess as registerLoginSuccess,
} from '../../../security/loginRateLimit.js';
import {
  applyRecoveredPassword,
  generateRecoveryCode,
  normalizeRecoveryCode,
  recoveryAttemptKey,
} from '../../../security/accountRecovery.js';
import { writeAuditLog } from '../../../services/audit-logs.js';

function invalidRecovery(): never {
  throwServerError({
    trpcCode: 'UNAUTHORIZED',
    errorCode: 'AUTH_RECOVERY_INVALID',
    message: 'The email or recovery code is incorrect',
  });
}

export const recoveryProcedures = {
  recoveryCodeStatus: adminProcedure.query(({ ctx }) => {
    const row = ctx.db
      .select({ createdAt: accountRecoveryCodes.createdAt })
      .from(accountRecoveryCodes)
      .where(
        and(
          eq(accountRecoveryCodes.userId, ctx.user!.id),
          eq(accountRecoveryCodes.tenantId, ctx.tenantId)
        )
      )
      .get();
    return { configured: Boolean(row), createdAt: row?.createdAt ?? null };
  }),

  generateRecoveryCode: adminProcedure
    .use(
      rateLimitFor({
        name: 'auth.generateRecoveryCode',
        max: 5,
        windowMs: 15 * 60_000,
        keyBy: ['userId'],
      })
    )
    .input(generateRecoveryCodeInput)
    .mutation(async ({ ctx, input }) => {
      const actorId = ctx.user!.id;
      const user = ctx.db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(and(eq(users.id, actorId), eq(users.tenantId, ctx.tenantId)))
        .get();
      if (!user || !(await verifyPasswordSecurely(user.passwordHash, input.currentPassword))) {
        throwServerError({
          trpcCode: 'UNAUTHORIZED',
          errorCode: 'AUTH_CURRENT_PASSWORD_INCORRECT',
          message: 'Current password is incorrect',
        });
      }

      const code = generateRecoveryCode();
      const codeHash = await hashPasswordSecurely(normalizeRecoveryCode(code));
      ctx.db.transaction(
        tx => {
          const now = new Date().toISOString();
          tx.insert(accountRecoveryCodes)
            .values({ userId: actorId, tenantId: ctx.tenantId, codeHash, createdAt: now })
            .onConflictDoUpdate({
              target: accountRecoveryCodes.userId,
              set: { codeHash, createdAt: now },
            })
            .run();
          writeAuditLog({
            tx,
            tenantId: ctx.tenantId,
            actorId,
            action: 'auth.recovery_code.generated',
            resourceType: 'user',
            resourceId: actorId,
          });
        },
        { behavior: 'immediate' }
      );
      return { code };
    }),

  recoverWithCode: publicProcedure.input(recoverWithCodeInput).mutation(async ({ ctx, input }) => {
    const { email, recoveryCode, newPassword } = input;
    const ip = ctx.req.ip;
    const attemptKey = recoveryAttemptKey(email);
    checkLoginIp(ctx.db, ip);
    checkLoginUsername(ctx.db, attemptKey);

    const dummyHash = await getDummyPasswordHash();
    const target = ctx.db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        role: users.role,
        isActive: users.isActive,
        tenantActive: tenants.isActive,
        codeHash: accountRecoveryCodes.codeHash,
      })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .leftJoin(
        accountRecoveryCodes,
        and(
          eq(accountRecoveryCodes.userId, users.id),
          eq(accountRecoveryCodes.tenantId, users.tenantId)
        )
      )
      .where(eq(users.email, email))
      .get();

    const matches = await verifyPasswordSecurely(
      target?.codeHash ?? dummyHash,
      normalizeRecoveryCode(recoveryCode)
    );
    if (
      !target?.codeHash ||
      !matches ||
      !target.isActive ||
      !target.tenantActive ||
      target.role !== 'admin'
    ) {
      registerLoginFailure(ctx.db, ip, attemptKey);
      invalidRecovery();
    }

    const passwordHash = await hashPasswordSecurely(newPassword);
    ctx.db.transaction(
      tx => {
        const current = tx
          .select({ codeHash: accountRecoveryCodes.codeHash })
          .from(accountRecoveryCodes)
          .where(eq(accountRecoveryCodes.userId, target.id))
          .get();
        // A concurrent regeneration or recovery already replaced this code.
        if (current?.codeHash !== target.codeHash) invalidRecovery();
        const now = new Date().toISOString();
        if (
          !applyRecoveredPassword(tx, {
            tenantId: target.tenantId,
            userId: target.id,
            passwordHash,
            now,
          })
        ) {
          invalidRecovery();
        }
        writeAuditLog({
          tx,
          tenantId: target.tenantId,
          actorId: target.id,
          action: 'auth.recovered_with_code',
          resourceType: 'user',
          resourceId: target.id,
        });
      },
      { behavior: 'immediate' }
    );
    registerLoginSuccess(ctx.db, attemptKey);
    registerLoginSuccess(ctx.db, email);
    return { success: true as const };
  }),
};
