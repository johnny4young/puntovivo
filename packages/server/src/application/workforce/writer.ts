/** Shared authority/clock fence for private workforce commands. No await inside the writer. */
import { MANAGER_OR_ADMIN_ROLES, USER_ROLES, type UserRole } from '@puntovivo/shared/roles';
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { tenants, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { CriticalCommandContext } from '../../trpc/middleware/commandEnvelope.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';

/** Authorized command capability; completion must be persisted by the caller's transaction. */
export type WorkforceCommandContext = Pick<
  CriticalCommandContext,
  'db' | 'tenantId' | 'user' | 'deviceId' | 'envelope' | 'completeInTransaction'
>;
/** Captured clock can also bind an asynchronous preflight to the final writer. */
export type WorkforceClock = Awaited<ReturnType<typeof resolveTenantBusinessClock>>;
async function withActorWriter<T>(
  ctx: WorkforceCommandContext,
  action: (tx: DatabaseInstance, timeZone: string) => T,
  capturedClock: WorkforceClock | undefined,
  allowedRoles: readonly UserRole[]
): Promise<T> {
  const clock = capturedClock ?? (await resolveTenantBusinessClock(ctx.db, ctx.tenantId));
  return ctx.db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      const actor = tx
        .select({ role: users.role })
        .from(users)
        .where(
          and(eq(users.tenantId, ctx.tenantId), eq(users.id, ctx.user.id), eq(users.isActive, true))
        )
        .get();
      const tenant = tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.id, ctx.tenantId), eq(tenants.isActive, true)))
        .get();
      if (
        !tenant ||
        !actor ||
        actor.role !== ctx.user.role ||
        !allowedRoles.some(role => role === actor.role)
      )
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'AUTH_IDENTITY_CHANGED',
          message: 'Workforce authority changed; sign in again',
        });
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
      return action(tx, clock.timezone);
    },
    { behavior: 'immediate' }
  );
}

/** Existing private workforce commands remain manager/admin-only, including direct service calls. */
export function withWorkforceWriter<T>(
  ctx: WorkforceCommandContext,
  action: (tx: DatabaseInstance, timeZone: string) => T,
  clock?: WorkforceClock
): Promise<T> {
  return withActorWriter(ctx, action, clock, MANAGER_OR_ADMIN_ROLES);
}
/** Employee self-service still rechecks active tenant/identity; each command must enforce row ownership. */
export function withEmployeeWriter<T>(
  ctx: WorkforceCommandContext,
  action: (tx: DatabaseInstance, timeZone: string) => T
): Promise<T> {
  return withActorWriter(ctx, action, undefined, USER_ROLES);
}
