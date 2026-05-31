/**
 * Sites tRPC Router
 *
 * Site selection support for tenant-aware flows.
 *
 * Procedures:
 * - sites.list (tenant) - List sites for the current tenant
 * - sites.create (tenant, admin) - Create a site
 * - sites.update (tenant, admin) - Update a site
 * - sites.delete (tenant, admin) - Delete a site when not referenced
 *
 * @module trpc/routers/sites
 */

import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { companies, locationXSite, locations, sequentials, sites } from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  createSiteInput,
  deleteSiteInput,
  listSiteLocationAssignmentsInput,
  listSitesInput,
  replaceSiteLocationAssignmentsInput,
  updateSiteInput,
} from '../schemas/sites.js';

async function ensureTenantSite(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
) {
  const site = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .get();

  if (!site) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });
  }

  return site;
}

export const sitesRouter = router({
  list: tenantProcedure.input(listSitesInput).query(async ({ ctx, input }) => {
    const conditions = [eq(sites.tenantId, ctx.tenantId)];

    if (input?.search) {
      conditions.push(
        or(like(sites.name, `%${input.search}%`), like(sites.address, `%${input.search}%`))!
      );
    }

    if (input?.isActive !== undefined) {
      conditions.push(eq(sites.isActive, input.isActive));
    } else if (!input?.includeInactive) {
      conditions.push(eq(sites.isActive, true));
    }

    const items = await ctx.db
      .select()
      .from(sites)
      .where(and(...conditions))
      .orderBy(asc(sites.name))
      .all();

    const siteIds = items.map(site => site.id);
    const assignmentCounts =
      siteIds.length > 0
        ? await ctx.db
            .select({
              siteId: locationXSite.siteId,
              count: sql<number>`count(*)`,
            })
            .from(locationXSite)
            .where(and(eq(locationXSite.tenantId, ctx.tenantId), inArray(locationXSite.siteId, siteIds)))
            .groupBy(locationXSite.siteId)
            .all()
        : [];
    const assignmentCountBySiteId = new Map(
      assignmentCounts.map(item => [item.siteId, item.count])
    );

    return {
      items: items.map(site => ({
        ...site,
        assignedLocationCount: assignmentCountBySiteId.get(site.id) ?? 0,
      })),
      activeSiteId: ctx.siteId,
    };
  }),

  create: adminProcedure.input(createSiteInput).mutation(async ({ ctx, input }) => {
    const company = await ctx.db
      .select()
      .from(companies)
      .where(and(eq(companies.id, input.companyId), eq(companies.tenantId, ctx.tenantId)))
      .get();

    if (!company) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Company not found' });
    }

    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(sites).values({
      id,
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      name: input.name,
      address: input.address ?? null,
      phone: input.phone ?? null,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await enqueueSync(ctx, {
      entityType: 'sites',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
    });

    return (await ctx.db.select().from(sites).where(eq(sites.id, id)).get())!;
  }),

  update: adminProcedure.input(updateSiteInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(sites)
      .where(and(eq(sites.id, id), eq(sites.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });
    }

    if (updates.companyId) {
      const company = await ctx.db
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.id, updates.companyId), eq(companies.tenantId, ctx.tenantId)))
        .get();

      if (!company) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Company not found' });
      }
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (updates.companyId !== undefined) updateData.companyId = updates.companyId;
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.address !== undefined) updateData.address = updates.address ?? null;
    if (updates.phone !== undefined) updateData.phone = updates.phone ?? null;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await ctx.db.update(sites).set(updateData).where(eq(sites.id, id));

    await enqueueSync(ctx, {
      entityType: 'sites',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
    });

    return (await ctx.db.select().from(sites).where(eq(sites.id, id)).get())!;
  }),

  listLocationAssignments: adminProcedure
    .input(listSiteLocationAssignmentsInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);

      const items = await ctx.db
        .select({
          id: locationXSite.id,
          locationId: locationXSite.locationId,
          code: locations.code,
          name: locations.name,
          description: locations.description,
          isActive: locations.isActive,
          createdAt: locationXSite.createdAt,
          updatedAt: locationXSite.updatedAt,
        })
        .from(locationXSite)
        .innerJoin(locations, eq(locationXSite.locationId, locations.id))
        .where(
          and(eq(locationXSite.tenantId, ctx.tenantId), eq(locationXSite.siteId, input.siteId))
        )
        .orderBy(asc(locations.name))
        .all();

      return {
        items,
        siteId: input.siteId,
        locationIds: items.map(item => item.locationId),
      };
    }),

  replaceLocationAssignments: adminProcedure
    .input(replaceSiteLocationAssignmentsInput)
    .mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);

      const uniqueLocationIds = [...new Set(input.locationIds)];
      const availableLocations =
        uniqueLocationIds.length > 0
          ? await ctx.db
              .select({
                id: locations.id,
              })
              .from(locations)
              .where(
                and(
                  eq(locations.tenantId, ctx.tenantId),
                  inArray(locations.id, uniqueLocationIds)
                )
              )
              .all()
          : [];

      if (availableLocations.length !== uniqueLocationIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'One or more selected locations were not found',
        });
      }

      const existingAssignments = await ctx.db
        .select({
          id: locationXSite.id,
          locationId: locationXSite.locationId,
        })
        .from(locationXSite)
        .where(
          and(eq(locationXSite.tenantId, ctx.tenantId), eq(locationXSite.siteId, input.siteId))
        )
        .all();

      const existingByLocationId = new Map(
        existingAssignments.map(assignment => [assignment.locationId, assignment.id])
      );
      const nextLocationIds = new Set(uniqueLocationIds);
      const removedAssignments = existingAssignments.filter(
        assignment => !nextLocationIds.has(assignment.locationId)
      );
      const addedLocationIds = uniqueLocationIds.filter(
        locationId => !existingByLocationId.has(locationId)
      );

      const now = new Date().toISOString();
      const addedAssignmentIds = addedLocationIds.map(locationId => ({
        assignmentId: nanoid(),
        locationId,
      }));
      ctx.db.transaction(tx => {
        for (const assignment of removedAssignments) {
          tx.delete(locationXSite).where(eq(locationXSite.id, assignment.id)).run();
        }

        for (const { assignmentId, locationId } of addedAssignmentIds) {
          tx.insert(locationXSite)
            .values({
              id: assignmentId,
              tenantId: ctx.tenantId,
              siteId: input.siteId,
              locationId,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
      });

      for (const assignment of removedAssignments) {
        await enqueueSync(ctx, {
          entityType: 'location_x_site',
          entityId: assignment.id,
          operation: 'delete',
          data: { id: assignment.id, siteId: input.siteId, locationId: assignment.locationId },
        });
      }

      for (const { assignmentId, locationId } of addedAssignmentIds) {
        await enqueueSync(ctx, {
          entityType: 'location_x_site',
          entityId: assignmentId,
          operation: 'create',
          data: { id: assignmentId, siteId: input.siteId, locationId },
        });
      }

      return {
        success: true,
        siteId: input.siteId,
        locationIds: uniqueLocationIds,
      };
    }),

  delete: adminProcedure.input(deleteSiteInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(sites)
      .where(and(eq(sites.id, input.id), eq(sites.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });
    }

    const references = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(sequentials)
      .where(and(eq(sequentials.tenantId, ctx.tenantId), eq(sequentials.siteId, input.id)))
      .get();

    if ((references?.count ?? 0) > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Site has configured sequentials. Deactivate it instead of deleting it.',
      });
    }

    const locationAssignmentCount = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(locationXSite)
      .where(and(eq(locationXSite.tenantId, ctx.tenantId), eq(locationXSite.siteId, input.id)))
      .get();

    if ((locationAssignmentCount?.count ?? 0) > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Site has assigned locations. Remove them before deleting the site.',
      });
    }

    await ctx.db
      .delete(sites)
      .where(and(eq(sites.id, input.id), eq(sites.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'sites',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
    });

    return { success: true, id: input.id };
  }),
});
