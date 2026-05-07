/**
 * ENG-069 — `surfaces.*` tRPC router.
 *
 * One procedure today:
 *
 *   - `surfaces.list` (managerOrAdmin) — returns the manifest joined
 *     with the active modules state so a future "surfaces" admin tab
 *     (or the renderer's `useSurfacesSnapshot()` hook) can render
 *     each surface's `enabled` flag without a second `modules.list`
 *     round-trip.
 *
 * The list itself is always available regardless of any module state
 * — clients need to know the full universe of surfaces to render the
 * "off" state correctly. The individual surfaces gate via their
 * `moduleId` field, which the renderer joins at render time.
 *
 * @module trpc/routers/surfaces
 */

import { eq } from 'drizzle-orm';
import { tenants } from '../../db/schema.js';
import {
  resolveModulesState,
  type ModuleId,
} from '../../services/modules/manifest.js';
import {
  SURFACE_IDS,
  SURFACES_MANIFEST,
} from '../../services/surfaces/manifest.js';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';

export const surfacesRouter = router({
  /**
   * Admin-tab + renderer listing. Returns every surface in the
   * manifest with its module-resolved `enabled` flag. POS Desktop
   * (moduleId === null) reports `enabled: true` unconditionally —
   * it's the implicit default surface and cannot be disabled.
   */
  list: managerOrAdminProcedure.query(async ({ ctx }) => {
    const row = await ctx.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .get();
    const blob = (row?.settings as Record<string, unknown> | null | undefined) ?? null;
    const stored =
      blob && typeof blob === 'object'
        ? ((blob as Record<string, unknown>).modules as Record<string, unknown> | undefined)
        : undefined;
    const effective = resolveModulesState(stored);

    return {
      surfaces: SURFACE_IDS.map(id => {
        const descriptor = SURFACES_MANIFEST[id];
        const enabled =
          descriptor.moduleId === null
            ? true
            : effective[descriptor.moduleId as ModuleId];
        return {
          id,
          moduleId: descriptor.moduleId,
          defaultRoute: descriptor.defaultRoute,
          defaultRoleSet: descriptor.defaultRoleSet,
          i18nKey: descriptor.i18nKey,
          enabled,
        };
      }),
    };
  }),
});

export type SurfacesRouter = typeof surfacesRouter;
