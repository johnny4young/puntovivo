/**
 * ENG-068 — `modules.*` tRPC router.
 *
 * Three procedures:
 *
 *   - `modules.list` (managerOrAdmin) — admin-tab read. Returns the
 *     full descriptor list joined with the tenant's current state so
 *     the admin UI can render labels + descriptions + the toggle.
 *   - `modules.setActive` (admin, criticalCommandProcedure) — flips
 *     `tenants.settings.modules[moduleId]`. Writes an audit log row
 *     `action='module.toggle'` with metadata carrying the before /
 *     after snapshot.
 *   - `modules.getEffective` (tenantProcedure) — render-side read.
 *     Returns `Record<ModuleId, boolean>` resolved against defaults
 *     so the renderer's `useIsModuleActive` hook always sees a
 *     complete map, even for a tenant that has never been toggled.
 *
 * @module trpc/routers/modules
 */

import { eq, sql } from 'drizzle-orm';
import { tenants } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  MODULES_MANIFEST,
  resolveModulesState,
  visibleDescriptors,
  type ModuleId,
} from '../../services/modules/manifest.js';
import { resolvePresetPatch } from '../../services/modules/presets.js';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { criticalCommandAdminProcedure } from '../middleware/criticalCommand.js';
import { applyModulePresetInput, setModuleActiveInput } from '../schemas/modules.js';

function normalizeActorRole(role: string | undefined): 'admin' | 'manager' | 'cashier' | 'viewer' {
  if (role === 'admin' || role === 'manager' || role === 'cashier' || role === 'viewer') {
    return role;
  }
  return 'viewer';
}

export const modulesRouter = router({
  /**
   * Admin-tab listing. Returns descriptor + current effective state
   * + the explicit-vs-default flag so the UI can show "default ON"
   * vs "tenant set this ON" vs "tenant set this OFF".
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

    const visible = visibleDescriptors(normalizeActorRole(ctx.user?.role));

    return {
      modules: visible.map(descriptor => {
        const { id } = descriptor;
        const explicit = stored && typeof stored === 'object' ? stored[id] : undefined;
        const isExplicit = typeof explicit === 'boolean';
        return {
          id,
          i18nKey: descriptor.i18nKey,
          adminVisibilityRole: descriptor.adminVisibilityRole,
          defaultEnabled: descriptor.defaultEnabled,
          enabled: effective[id],
          isExplicit,
        };
      }),
    };
  }),

  /**
   * Renderer-side read. Returns the full effective state map so the
   * `<RequireModule>` wrapper + `useIsModuleActive` hook always see
   * every known module key.
   */
  getEffective: tenantProcedure.query(async ({ ctx }) => {
    const row = await ctx.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .get();
    const blob = (row?.settings as Record<string, unknown> | null | undefined) ?? null;
    const stored =
      blob && typeof blob === 'object' ? (blob as Record<string, unknown>).modules : undefined;
    return { modules: resolveModulesState(stored) };
  }),

  /**
   * Admin toggle. Writes the new state to `tenants.settings.modules[id]`
   * via SQLite's `json_set` so the merge is atomic + doesn't clobber
   * sibling settings keys (fiscal, ai, locale).
   *
   * Always emits an audit log row with the before/after snapshot so
   * the operator can trace activation history.
   */
  setActive: criticalCommandAdminProcedure
    .input(setModuleActiveInput)
    .mutation(async ({ ctx, input }) => {
      const { moduleId, enabled } = input;

      // Snapshot the current effective state for the audit row's
      // `before` field. Reading via the helper handles missing /
      // malformed JSON without bespoke null-checks.
      const beforeRow = await ctx.db
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .get();
      const beforeBlob =
        beforeRow?.settings && typeof beforeRow.settings === 'object'
          ? ((beforeRow.settings as Record<string, unknown>).modules as
              Record<string, unknown> | undefined)
          : undefined;
      const beforeEffective = resolveModulesState(beforeBlob);
      const beforeEnabled = beforeEffective[moduleId as ModuleId];

      // Idempotent path: same state → no write, no audit row. The
      // operator UI debounces but a stale client could double-fire;
      // this short-circuit keeps the audit trail clean.
      if (beforeEnabled === enabled) {
        return { moduleId, enabled, changed: false as const };
      }

      // Atomic JSON merge. SQLite's `json_set` returns NULL when
      // applied to NULL, so we COALESCE to '{}' to seed an empty
      // settings blob for fresh tenants.
      const path = `$.modules.${moduleId}`;
      const now = new Date().toISOString();
      await ctx.db.transaction(tx => {
        tx.update(tenants)
          .set({
            settings: sql`json_set(COALESCE(${tenants.settings}, '{}'), ${path}, ${
              enabled ? sql`json('true')` : sql`json('false')`
            })`,
            updatedAt: now,
          })
          .where(eq(tenants.id, ctx.tenantId))
          .run();

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'module.toggle',
          resourceType: 'tenant_module',
          resourceId: moduleId,
          before: { enabled: beforeEnabled },
          after: { enabled },
          metadata: {
            moduleId,
            // The dev-seed defaults travel with the row so an audit
            // viewer can tell whether the tenant flipped from "default"
            // to "explicit-OFF" or "default" to "explicit-ON".
            wasExplicit: beforeBlob ? moduleId in beforeBlob : false,
            defaultEnabled: MODULES_MANIFEST[moduleId as ModuleId].defaultEnabled,
          },
        });
      });

      return { moduleId, enabled, changed: true as const };
    }),

  /**
   * A-30 — apply a vertical preset. Resolves the server-owned patch for
   * the preset, then json_sets ONLY the modules the patch names (the AI
   * trio + events-api are never in a patch, so an operator's paid-feature
   * choices survive). Writes ONE audit row with the preset id and the
   * before/after of every touched module. Idempotent: keys already at the
   * target state are skipped, and an all-no-op apply writes nothing.
   */
  applyPreset: criticalCommandAdminProcedure
    .input(applyModulePresetInput)
    .mutation(async ({ ctx, input }) => {
      const patch = resolvePresetPatch(input.presetId);

      const beforeRow = await ctx.db
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .get();
      const beforeBlob =
        beforeRow?.settings && typeof beforeRow.settings === 'object'
          ? ((beforeRow.settings as Record<string, unknown>).modules as
              Record<string, unknown> | undefined)
          : undefined;
      const beforeEffective = resolveModulesState(beforeBlob);

      // Only the keys that actually change — an idempotent re-apply is a
      // no-op with no audit row, matching setActive's posture.
      const changes = (Object.entries(patch) as Array<[ModuleId, boolean]>).filter(
        ([id, target]) => beforeEffective[id] !== target
      );

      if (changes.length === 0) {
        return { presetId: input.presetId, changed: false as const, applied: [] };
      }

      const now = new Date().toISOString();
      await ctx.db.transaction(tx => {
        for (const [id, target] of changes) {
          const path = `$.modules.${id}`;
          tx.update(tenants)
            .set({
              settings: sql`json_set(COALESCE(${tenants.settings}, '{}'), ${path}, ${
                target ? sql`json('true')` : sql`json('false')`
              })`,
              updatedAt: now,
            })
            .where(eq(tenants.id, ctx.tenantId))
            .run();
        }

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'module.preset_applied',
          resourceType: 'tenant_module',
          resourceId: input.presetId,
          before: Object.fromEntries(changes.map(([id]) => [id, beforeEffective[id]])),
          after: Object.fromEntries(changes),
          metadata: { presetId: input.presetId, changedCount: changes.length },
        });
      });

      return {
        presetId: input.presetId,
        changed: true as const,
        applied: changes.map(([id, enabled]) => ({ moduleId: id, enabled })),
      };
    }),
});

export type ModulesRouter = typeof modulesRouter;
