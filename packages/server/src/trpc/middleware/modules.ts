/**
 * Module activation gate middleware.
 *
 * Companion to `roles.ts`. Adds a per-procedure check that the
 * caller's tenant has the named module activated. Returns FORBIDDEN
 * with the stable error code `MODULE_NOT_ACTIVATED` when the module
 * is deactivated; the renderer keys off this code to show a
 * "feature not available" toast distinct from a role-based FORBIDDEN.
 *
 * Reads from `tenants.settings.modules` (a JSON column the kernel
 * shares with existing fiscal / AI gates per ADR-0007). The gate
 * MUST run AFTER `tenantProcedure` so `ctx.tenantId` is already
 * resolved — the factory composition functions below enforce this.
 *
 * @module trpc/middleware/modules
 */

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { tenants } from '../../db/schema.js';
import { ServerErrorWithCode } from '../../lib/errorCodes.js';
import { resolveModulesState, type ModuleId } from '../../services/modules/manifest.js';
import { middleware } from '../init.js';
import {
  adminProcedure,
  cashierManagerOrAdminProcedure,
  managerOrAdminProcedure,
} from './roles.js';

/**
 * Read `tenants.settings.modules` and resolve whether `moduleId` is
 * active for the given tenant. Falls back to the manifest default
 * when the JSON blob is absent / malformed.
 */
export async function isModuleActiveForTenant(
  db: DatabaseInstance,
  tenantId: string,
  moduleId: ModuleId
): Promise<boolean> {
  const row = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const blob = row?.settings as Record<string, unknown> | null | undefined;
  const modules =
    blob && typeof blob === 'object' ? (blob as Record<string, unknown>).modules : undefined;
  return resolveModulesState(modules)[moduleId];
}

/**
 * Procedure middleware factory. Throws FORBIDDEN with
 * `MODULE_NOT_ACTIVATED` when the tenant's module is off.
 *
 * Stack the result via `.use(...)` after a role-aware procedure:
 * the role check runs first (cheap, in-memory), then the module
 * check (one DB read on `tenants`). The order matters because
 * `ctx.tenantId` MUST be set before the module read.
 */
export function createModuleGuard(moduleId: ModuleId) {
  return middleware(async ({ ctx, next }) => {
    if (!ctx.tenantId) {
      // Should never happen — the gate is composed atop tenantProcedure.
      // Surface the violation explicitly so a misconfiguration fails loud.
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Module gate requires a tenant context',
      });
    }
    const active = await isModuleActiveForTenant(ctx.db, ctx.tenantId, moduleId);
    if (!active) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Module '${moduleId}' is not activated for this tenant`,
        cause: new ServerErrorWithCode(
          'MODULE_NOT_ACTIVATED',
          `Module '${moduleId}' is not activated for this tenant`,
          { moduleId }
        ),
      });
    }
    return next();
  });
}

// ─────────────────────────────────────────────────────────────────
// Pre-composed factories — opt-in. Existing role procedures stay
// untouched so non-module routes don't pay the JSON-read cost.
// ─────────────────────────────────────────────────────────────────

/**
 * Admin-only procedure that ALSO requires the named module to be
 * active. Equivalent to `adminProcedure.use(createModuleGuard(id))`.
 */
export function adminProcedureWithModule(moduleId: ModuleId) {
  return adminProcedure.use(createModuleGuard(moduleId));
}

/**
 * Manager-or-admin procedure that ALSO requires the named module.
 */
export function managerOrAdminProcedureWithModule(moduleId: ModuleId) {
  return managerOrAdminProcedure.use(createModuleGuard(moduleId));
}

/**
 * Cashier/manager/admin procedure that ALSO requires the named module.
 */
export function cashierManagerOrAdminProcedureWithModule(moduleId: ModuleId) {
  return cashierManagerOrAdminProcedure.use(createModuleGuard(moduleId));
}
