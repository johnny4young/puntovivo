/**
 * `criticalCommandProcedure` decorators.
 *
 * Composes `tenantProcedure` (already validates tenant + auth) with
 * the new `commandEnvelope` middleware so the closed list of critical
 * mutations from ADR-0002 picks up envelope semantics with a single
 * decorator change.
 *
 * Variants stack a role guard on top so consumers can pick the
 * matching procedure type without re-stating the role list per
 * router. The role-guard primitives come from
 * `trpc/middleware/roles.ts`.
 *
 * Use:
 * - `criticalCommandProcedure`: any authenticated tenant user.
 * - `criticalCommandManagerOrAdminProcedure`: manager + admin.
 * - `criticalCommandAdminProcedure`: admin only.
 * - `criticalCommandCashierManagerOrAdminProcedure`: cashier + manager + admin.
 *
 * @module trpc/middleware/criticalCommand
 */

import { ADMIN_ONLY_ROLES, MANAGER_OR_ADMIN_ROLES, SALES_ROLES } from '@puntovivo/shared/roles';
import { commandEnvelope } from './commandEnvelope.js';
import { createRoleGuard } from './roles.js';
import { tenantProcedure } from './tenant.js';

/**
 * Base critical command — only requires the envelope + an
 * authenticated tenant user. Most flows use one of the role-gated
 * variants below.
 */
export const criticalCommandProcedure = tenantProcedure.use(commandEnvelope);

/**
 * The role guard is chained BEFORE `commandEnvelope`, never after.
 *
 * `commandEnvelope` short-circuits on an idempotency cache hit, on a replay
 * conflict, and while the original command is still processing: those paths
 * return a result (or throw) WITHOUT calling `next()`, so anything chained
 * after the envelope simply never runs. A role guard placed downstream would
 * therefore be skipped on exactly the replay paths, letting a lower-privileged
 * user on a shared terminal replay an administrator's idempotency key and
 * receive the cached admin-only payload back. Ordering the guard first makes
 * authorization apply to every path through the envelope, including the ones
 * that never reach the procedure body.
 */
export const criticalCommandAdminProcedure = tenantProcedure
  .use(createRoleGuard(ADMIN_ONLY_ROLES, 'Only administrators can perform this action'))
  .use(commandEnvelope);

export const criticalCommandManagerOrAdminProcedure = tenantProcedure
  .use(
    createRoleGuard(
      MANAGER_OR_ADMIN_ROLES,
      'Only administrators and managers can perform this action'
    )
  )
  .use(commandEnvelope);

export const criticalCommandCashierManagerOrAdminProcedure = tenantProcedure
  .use(
    createRoleGuard(
      SALES_ROLES,
      'Only cashiers, managers, and administrators can perform this action'
    )
  )
  .use(commandEnvelope);
