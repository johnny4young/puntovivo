import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { DatabaseInstance } from '../../db/index.js';
import { auditLogs, companies, logos, tenants } from '../../db/schema.js';
import { clearTelemetryOptInCacheForTenant } from '../../observability/index.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { setCompanyLogoInput, upsertCompanyInput } from '../schemas/companies.js';

function buildCompanySelection() {
  return {
    id: companies.id,
    tenantId: companies.tenantId,
    name: companies.name,
    taxId: companies.taxId,
    address: companies.address,
    phone: companies.phone,
    email: companies.email,
    logoId: companies.logoId,
    logoUrl: companies.logoUrl,
    logoName: logos.name,
    createdAt: companies.createdAt,
    updatedAt: companies.updatedAt,
  };
}

/**
 * Resolve `tenants.settings.telemetryOptIn` for the
 * active tenant. Returns false by default (opt-in is per-tenant and
 * defaults off; the toggle is admin-driven via
 * `companies.updateTelemetryOptIn`). The query is a single row read
 * by primary key — sub-millisecond and never on the hot path of a
 * write mutation.
 */
async function resolveTelemetryOptIn(db: DatabaseInstance, tenantId: string): Promise<boolean> {
  const row = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  return settings.telemetryOptIn === true;
}

/**
 * Fetch a company row and stamp the tenant's
 * `telemetryOptIn` flag in one consistent shape. Used by
 * `getCurrent / upsert / setLogo` so every response surface carries
 * the field; without it react-query `setData` would silently drop
 * the flag on mutation cache writes.
 */
async function selectCompanyByIdWithTelemetry(
  db: DatabaseInstance,
  tenantId: string,
  companyId: string
) {
  // multi-tenant invariant: scope by both id AND tenantId.
  // Every caller already chained off a tenant-owned id, but pinning
  // the predicate here keeps the helper safe if a future caller
  // threads in a foreign id by mistake.
  const company = await db
    .select(buildCompanySelection())
    .from(companies)
    .leftJoin(logos, eq(companies.logoId, logos.id))
    .where(and(eq(companies.id, companyId), eq(companies.tenantId, tenantId)))
    .get();
  if (!company) return null;
  const telemetryOptIn = await resolveTelemetryOptIn(db, tenantId);
  return { ...company, telemetryOptIn };
}

async function resolveLogoSelection(
  tenantId: string,
  logoId: string | null | undefined,
  db: DatabaseInstance
) {
  if (logoId === undefined) {
    return undefined;
  }

  if (logoId === null) {
    return null;
  }

  const logo = await db
    .select()
    .from(logos)
    .where(and(eq(logos.id, logoId), eq(logos.tenantId, tenantId)))
    .get();

  if (!logo) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Selected logo was not found' });
  }

  return logo;
}

export const companiesRouter = router({
  getCurrent: tenantProcedure.query(async ({ ctx }) => {
    const company = await ctx.db
      .select(buildCompanySelection())
      .from(companies)
      .leftJoin(logos, eq(companies.logoId, logos.id))
      .where(eq(companies.tenantId, ctx.tenantId))
      .get();

    if (!company) return null;
    // surface `telemetryOptIn` on the same response so
    // the CompanyTelemetryCard renders without a second round-trip.
    // Defensive default: false. The toggle is admin-driven via
    // `companies.updateTelemetryOptIn` below.
    return (await selectCompanyByIdWithTelemetry(ctx.db, ctx.tenantId, company.id))!;
  }),

  upsert: adminProcedure.input(upsertCompanyInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const existing = await ctx.db
      .select()
      .from(companies)
      .where(eq(companies.tenantId, ctx.tenantId))
      .get();

    const resolvedLogo = await resolveLogoSelection(ctx.tenantId, input.logoId, ctx.db);

    if (existing) {
      const updateData = {
        name: input.name,
        taxId: input.taxId ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        logoId: resolvedLogo === undefined ? existing.logoId : (resolvedLogo?.id ?? null),
        logoUrl:
          resolvedLogo === undefined
            ? existing.logoId
              ? existing.logoUrl
              : (input.logoUrl ?? existing.logoUrl ?? null)
            : (resolvedLogo?.imageUrl ?? input.logoUrl ?? null),
        updatedAt: now,
      };

      await ctx.db
        .update(companies)
        .set(updateData)
        .where(and(eq(companies.id, existing.id), eq(companies.tenantId, ctx.tenantId)));

      await enqueueSync(ctx, {
        entityType: 'companies',
        entityId: existing.id,
        operation: 'update',
        data: { id: existing.id, ...updateData },
      });

      return (await selectCompanyByIdWithTelemetry(ctx.db, ctx.tenantId, existing.id))!;
    }

    const id = nanoid();
    await ctx.db.insert(companies).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      taxId: input.taxId ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      logoId: resolvedLogo?.id ?? null,
      logoUrl: resolvedLogo?.imageUrl ?? input.logoUrl ?? null,
      createdAt: now,
      updatedAt: now,
    });

    await enqueueSync(ctx, {
      entityType: 'companies',
      entityId: id,
      operation: 'create',
      data: {
        id,
        ...input,
        logoId: resolvedLogo?.id ?? null,
        logoUrl: resolvedLogo?.imageUrl ?? input.logoUrl ?? null,
      },
    });

    return (await selectCompanyByIdWithTelemetry(ctx.db, ctx.tenantId, id))!;
  }),

  setLogo: adminProcedure.input(setCompanyLogoInput).mutation(async ({ ctx, input }) => {
    const company = await ctx.db
      .select()
      .from(companies)
      .where(eq(companies.tenantId, ctx.tenantId))
      .get();

    if (!company) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Company not found' });
    }

    const selectedLogo = await resolveLogoSelection(ctx.tenantId, input.logoId, ctx.db);
    const now = new Date().toISOString();
    const updateData = {
      logoId: selectedLogo?.id ?? null,
      logoUrl: selectedLogo?.imageUrl ?? null,
      updatedAt: now,
    };

    await ctx.db
      .update(companies)
      .set(updateData)
      .where(and(eq(companies.id, company.id), eq(companies.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'companies',
      entityId: company.id,
      operation: 'update',
      data: { id: company.id, ...updateData },
    });

    return (await selectCompanyByIdWithTelemetry(ctx.db, ctx.tenantId, company.id))!;
  }),

  /**
   * Admin opts out of the readiness force-redirect.
   *
   * Writes the current ISO timestamp into
   * `tenants.settings.setupAcknowledgedAt`. Future logins will land
   * on `/dashboard` even when blockers remain — the readiness card
   * and the in-shell banner stay visible so the operator can finish
   * configuring at their own pace.
   *
   * Idempotent: the timestamp is refreshed on each call (the
   * mutation never throws on repeated invocations).
   */
  acknowledgeSetup: adminProcedure.mutation(async ({ ctx }) => {
    const now = new Date().toISOString();
    await ctx.db
      .update(tenants)
      .set({
        // SQLite's `json_set` returns NULL when applied to NULL, so we
        // COALESCE to '{}' to seed an empty settings blob for fresh
        // tenants. Mirrors the merge pattern used by `modules.setActive`.
        settings: sql`json_set(COALESCE(${tenants.settings}, '{}'), '$.setupAcknowledgedAt', ${now})`,
        updatedAt: now,
      })
      .where(eq(tenants.id, ctx.tenantId));
    return { acknowledgedAt: now };
  }),

  /**
   * Admin toggles per-tenant telemetry opt-in.
   *
   * Flips `tenants.settings.telemetryOptIn` and writes an audit row
   * (`telemetry.opt_in.updated`) with `before` / `after` carrying the
   * boolean state. The captureException / withSpan helpers read the
   * flag at the next opt-in cache window (60s) — the value is the
   * primary gate between the local pino log (always on) and the
   * centralized telemetry sink (opt-in only).
   *
   * Idempotent: calling `updateTelemetryOptIn({ optedIn: true })`
   * twice keeps the flag true; the audit row still records the
   * call so the consent log is complete.
   */
  updateTelemetryOptIn: adminProcedure
    .input(z.object({ optedIn: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const before = await resolveTelemetryOptIn(ctx.db, ctx.tenantId);
      const now = new Date().toISOString();
      // SQLite stores JSON booleans as integers (0/1) inside the
      // packed text; `json('true')` / `json('false')` force the
      // resulting JSON to use the canonical boolean literal so a
      // downstream reader using `json_extract(... '$.telemetryOptIn')`
      // gets `true` / `false`, not `1` / `0`. The fragment is
      // selected here in TS so no string concatenation reaches the
      // SQL layer — both branches are parametrized literals.
      const optedInFragment = input.optedIn ? sql`json('true')` : sql`json('false')`;
      await ctx.db.transaction(tx => {
        tx.update(tenants)
          .set({
            settings: sql`json_set(COALESCE(${tenants.settings}, '{}'), '$.telemetryOptIn', ${optedInFragment})`,
            updatedAt: now,
          })
          .where(eq(tenants.id, ctx.tenantId))
          .run();

        tx.insert(auditLogs)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            // adminProcedure guarantees ctx.user is non-null; the bang
            // mirrors the convention in authority.ts / ai.ts.
            actorId: ctx.user!.id,
            action: 'telemetry.opt_in.updated',
            resourceType: 'tenant',
            resourceId: ctx.tenantId,
            before: { telemetryOptIn: before },
            after: { telemetryOptIn: input.optedIn },
            metadata: null,
            createdAt: now,
          })
          .run();
      });

      clearTelemetryOptInCacheForTenant(ctx.tenantId);

      return { telemetryOptIn: input.optedIn, updatedAt: now };
    }),
});
