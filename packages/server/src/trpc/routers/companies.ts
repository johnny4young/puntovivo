import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { companies, logos, tenants } from '../../db/schema.js';
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

    return company ?? null;
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
        logoId: resolvedLogo === undefined ? existing.logoId : resolvedLogo?.id ?? null,
        logoUrl:
          resolvedLogo === undefined
            ? existing.logoId
              ? existing.logoUrl
              : input.logoUrl ?? existing.logoUrl ?? null
            : resolvedLogo?.imageUrl ?? input.logoUrl ?? null,
        updatedAt: now,
      };

      await ctx.db.update(companies).set(updateData).where(eq(companies.id, existing.id));

      await enqueueSync(ctx, {
        entityType: 'companies',
        entityId: existing.id,
        operation: 'update',
        data: { id: existing.id, ...updateData },
      });

      return (
        await ctx.db
          .select(buildCompanySelection())
          .from(companies)
          .leftJoin(logos, eq(companies.logoId, logos.id))
          .where(eq(companies.id, existing.id))
          .get()
      )!;
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
      data: { id, ...input, logoId: resolvedLogo?.id ?? null, logoUrl: resolvedLogo?.imageUrl ?? input.logoUrl ?? null },
    });

    return (
      await ctx.db
        .select(buildCompanySelection())
        .from(companies)
        .leftJoin(logos, eq(companies.logoId, logos.id))
        .where(eq(companies.id, id))
        .get()
    )!;
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

    await ctx.db.update(companies).set(updateData).where(eq(companies.id, company.id));

    await enqueueSync(ctx, {
      entityType: 'companies',
      entityId: company.id,
      operation: 'update',
      data: { id: company.id, ...updateData },
    });

    return (
      await ctx.db
        .select(buildCompanySelection())
        .from(companies)
        .leftJoin(logos, eq(companies.logoId, logos.id))
        .where(eq(companies.id, company.id))
        .get()
    )!;
  }),

  /**
   * ENG-104 — Admin opts out of the readiness force-redirect.
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
});
