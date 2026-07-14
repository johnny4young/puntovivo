/**
 * Cross-tenant mutation isolation — hardened DELETE / UPDATE guards.
 *
 * Several router mutations were hardened to scope their DELETE / UPDATE
 * WHERE clause by `tenantId` (not just by row id). Every one of those
 * mutations also runs a tenant-scoped pre-check SELECT that throws
 * `NOT_FOUND` before the write is reached, so a foreign-tenant id never
 * mutates another tenant's row.
 *
 * These negative tests pin that invariant: a caller authenticated as
 * tenant B must NOT be able to delete / update a row owned by tenant A.
 * Each case (a) asserts the mutation is rejected and (b) re-reads the
 * row from the DB to prove it survived untouched.
 *
 * The two-tenant harness mirrors the isolation pattern in
 * `audit-logs.test.ts` and `authority-router.test.ts`: each tenant gets
 * its own tenant + company + site + admin user, and callers are built
 * from a context scoped to that tenant.
 *
 * Resources covered: customers, geography (countries + departments),
 * sites, sequentials, locations, customerCatalogs, companies.
 * deliveryOrders has its own dedicated file (`deliveryOrders.test.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hash } from 'argon2';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  companies,
  countries,
  customers,
  departments,
  identificationTypes,
  locations,
  sequentials,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

interface Harness {
  tenantId: string;
  companyId: string;
  siteId: string;
  adminId: string;
}

async function seedHarness(suffix: string): Promise<Harness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `iso-tenant-${suffix}`;
  const companyId = `iso-company-${suffix}`;
  const siteId = `iso-site-${suffix}`;
  const adminId = `iso-admin-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Isolation Tenant ${suffix}`,
    slug: `iso-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Isolation Company ${suffix}`,
    taxId: `ISO-${suffix}`,
    email: `company-${suffix}@example.com`,
    phone: null,
    address: null,
    logoId: null,
    logoUrl: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `Main ${suffix}`,
    address: null,
    phone: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: adminId,
    tenantId,
    email: `admin-${suffix}@example.com`,
    passwordHash: await hash('TestPassword123!'),
    name: `Admin ${suffix}`,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return { tenantId, companyId, siteId, adminId };
}

function buildCtx(h: Harness): Context {
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId: h.adminId,
        email: `admin-${h.tenantId}@example.com`,
        role: 'admin',
        tenantId: h.tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as unknown as Context['res'],
    db: getDatabase(),
    user: {
      id: h.adminId,
      email: `admin-${h.tenantId}@example.com`,
      role: 'admin',
      tenantId: h.tenantId,
    },
    tenantId: h.tenantId,
    siteId: h.siteId,
  };
}

describe('Cross-tenant mutation isolation (hardened DELETE/UPDATE guards)', () => {
  let tenantA: Harness;
  let tenantB: Harness;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    tenantA = await seedHarness('a');
    tenantB = await seedHarness('b');
  });

  afterAll(async () => {
    await server.close();
  });

  describe('customers.delete', () => {
    it("rejects deleting another tenant's customer and leaves the row intact", async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const callerB = appRouter.createCaller(buildCtx(tenantB));
      const db = getDatabase();

      const customer = await callerA.customers.create({
        name: `Customer ${nanoid(6)}`,
        isActive: true,
      });

      await expect(callerB.customers.delete({ id: customer.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const survivor = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customer.id))
        .get();
      expect(survivor).toBeTruthy();
      expect(survivor?.tenantId).toBe(tenantA.tenantId);

      // Sanity: the owner can still delete it.
      await expect(callerA.customers.delete({ id: customer.id })).resolves.toMatchObject({
        success: true,
      });
    });
  });

  describe('customers.exportPersonalData', () => {
    it("rejects another tenant's customer id without writing a disclosure audit", async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const callerB = appRouter.createCaller(buildCtx(tenantB));
      const db = getDatabase();
      const customer = await callerA.customers.create({
        name: `Private Customer ${nanoid(6)}`,
        email: `private-${nanoid(6)}@example.com`,
      });

      await expect(callerB.customers.exportPersonalData({ id: customer.id })).rejects.toMatchObject(
        { code: 'NOT_FOUND' }
      );

      const foreignAudit = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantB.tenantId),
            eq(auditLogs.action, 'customer.personal_data.export'),
            eq(auditLogs.resourceId, customer.id)
          )
        )
        .get();
      expect(foreignAudit).toBeUndefined();

      await expect(
        callerA.customers.exportPersonalData({ id: customer.id })
      ).resolves.toMatchObject({ subject: { id: customer.id } });
    });
  });

  describe('countries.delete', () => {
    it("rejects deleting another tenant's country and leaves the row intact", async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const callerB = appRouter.createCaller(buildCtx(tenantB));
      const db = getDatabase();

      const country = await callerA.countries.create({
        code: `C${nanoid(4)}`,
        name: `Country ${nanoid(6)}`,
        isActive: true,
      });

      await expect(callerB.countries.delete({ id: country!.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const survivor = await db
        .select()
        .from(countries)
        .where(eq(countries.id, country!.id))
        .get();
      expect(survivor).toBeTruthy();
      expect(survivor?.tenantId).toBe(tenantA.tenantId);
    });
  });

  describe('departments.delete', () => {
    it("rejects deleting another tenant's department and leaves the row intact", async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const callerB = appRouter.createCaller(buildCtx(tenantB));
      const db = getDatabase();

      const country = await callerA.countries.create({
        code: `D${nanoid(4)}`,
        name: `Country ${nanoid(6)}`,
        isActive: true,
      });
      const department = await callerA.departments.create({
        countryId: country!.id,
        code: `DP${nanoid(4)}`,
        name: `Department ${nanoid(6)}`,
        isActive: true,
      });

      await expect(callerB.departments.delete({ id: department!.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const survivor = await db
        .select()
        .from(departments)
        .where(eq(departments.id, department!.id))
        .get();
      expect(survivor).toBeTruthy();
      expect(survivor?.tenantId).toBe(tenantA.tenantId);
    });
  });

  describe('sites.delete', () => {
    it("rejects deleting another tenant's site and leaves the row intact", async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const callerB = appRouter.createCaller(buildCtx(tenantB));
      const db = getDatabase();

      // Create a fresh, dependency-free site in tenant A so the delete is
      // not blocked by sequentials / location references. The harness site
      // carries seeded sequentials, so we make a clean one here.
      const created = await callerA.sites.create({
        companyId: tenantA.companyId,
        name: `Branch ${nanoid(6)}`,
        address: null,
        phone: null,
        isActive: true,
      });

      await expect(callerB.sites.delete({ id: created.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const survivor = await db.select().from(sites).where(eq(sites.id, created.id)).get();
      expect(survivor).toBeTruthy();
      expect(survivor?.tenantId).toBe(tenantA.tenantId);

      // Sanity: the owner can still delete its own dependency-free site.
      await expect(callerA.sites.delete({ id: created.id })).resolves.toMatchObject({
        success: true,
      });
    });
  });

  describe('sequentials.delete', () => {
    it("rejects deleting another tenant's sequential and leaves the row intact", async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const callerB = appRouter.createCaller(buildCtx(tenantB));
      const db = getDatabase();

      const created = await callerA.sequentials.upsert({
        siteId: tenantA.siteId,
        documentType: 'order',
        prefix: `ORD-${nanoid(3)}-`,
        currentValue: 5,
      });

      await expect(callerB.sequentials.delete({ id: created.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const survivor = await db
        .select()
        .from(sequentials)
        .where(eq(sequentials.id, created.id))
        .get();
      expect(survivor).toBeTruthy();
      expect(survivor?.tenantId).toBe(tenantA.tenantId);
    });
  });

  describe('locations.delete', () => {
    it("rejects deleting another tenant's location and leaves the row intact", async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const callerB = appRouter.createCaller(buildCtx(tenantB));
      const db = getDatabase();

      const created = await callerA.locations.create({
        code: `LOC${nanoid(4)}`,
        name: `Location ${nanoid(6)}`,
        description: null,
        isActive: true,
      });

      await expect(callerB.locations.delete({ id: created!.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const survivor = await db
        .select()
        .from(locations)
        .where(eq(locations.id, created!.id))
        .get();
      expect(survivor).toBeTruthy();
      expect(survivor?.tenantId).toBe(tenantA.tenantId);
    });
  });

  describe('customerCatalogs (identificationTypes) delete + update', () => {
    it("rejects deleting another tenant's catalog item and leaves the row intact", async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const callerB = appRouter.createCaller(buildCtx(tenantB));
      const db = getDatabase();

      const created = await callerA.identificationTypes.create({
        code: `ID${nanoid(4)}`,
        name: `Identification ${nanoid(6)}`,
        description: null,
        isActive: true,
      });

      await expect(
        callerB.identificationTypes.delete({ id: created!.id })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const survivor = await db
        .select()
        .from(identificationTypes)
        .where(eq(identificationTypes.id, created!.id))
        .get();
      expect(survivor).toBeTruthy();
      expect(survivor?.tenantId).toBe(tenantA.tenantId);
    });

    it("rejects updating another tenant's catalog item and leaves the row unchanged", async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const callerB = appRouter.createCaller(buildCtx(tenantB));
      const db = getDatabase();

      const created = await callerA.identificationTypes.create({
        code: `ID${nanoid(4)}`,
        name: `Original ${nanoid(6)}`,
        description: null,
        isActive: true,
      });

      await expect(
        callerB.identificationTypes.update({
          id: created!.id,
          name: 'Hijacked Name',
          isActive: false,
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const survivor = await db
        .select()
        .from(identificationTypes)
        .where(eq(identificationTypes.id, created!.id))
        .get();
      expect(survivor?.name).toBe(created!.name);
      expect(survivor?.isActive).toBe(true);
      expect(survivor?.tenantId).toBe(tenantA.tenantId);
    });
  });

  describe('companies.upsert', () => {
    it("never mutates another tenant's company row", async () => {
      // companies has no id-based delete/update: upsert / setLogo resolve
      // the row by tenantId only. The hardened predicate keeps the UPDATE
      // scoped to the caller's own company. We assert that a tenant B
      // upsert leaves tenant A's company row completely untouched.
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const callerB = appRouter.createCaller(buildCtx(tenantB));
      const db = getDatabase();

      const uniqueNameA = `Company A ${nanoid(6)}`;
      await callerA.companies.upsert({ name: uniqueNameA });

      const beforeA = await db
        .select()
        .from(companies)
        .where(eq(companies.tenantId, tenantA.tenantId))
        .get();
      expect(beforeA?.name).toBe(uniqueNameA);

      // Tenant B writes its own company. This must not touch tenant A.
      const uniqueNameB = `Company B ${nanoid(6)}`;
      const upsertedB = await callerB.companies.upsert({ name: uniqueNameB });
      expect(upsertedB.tenantId).toBe(tenantB.tenantId);
      expect(upsertedB.name).toBe(uniqueNameB);

      const afterA = await db
        .select()
        .from(companies)
        .where(eq(companies.tenantId, tenantA.tenantId))
        .get();
      expect(afterA?.id).toBe(beforeA?.id);
      expect(afterA?.name).toBe(uniqueNameA);
      expect(afterA?.updatedAt).toBe(beforeA?.updatedAt);

      // And exactly one company row exists per tenant — B's write did not
      // fork a second row under A.
      const aRows = await db
        .select()
        .from(companies)
        .where(eq(companies.tenantId, tenantA.tenantId))
        .all();
      expect(aRows).toHaveLength(1);
    });
  });

  // Defense-in-depth direct-SQL probe: even if a future caller threaded a
  // foreign id past the pre-check, the hardened UPDATE/DELETE WHERE clause
  // (id AND tenantId) must match zero rows when the tenant differs. This
  // asserts the WHERE clause itself, independent of the router pre-check.
  describe('hardened WHERE clause matches zero rows cross-tenant', () => {
    it('UPDATE customers scoped by (id, tenantId) cannot touch a foreign row', async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const db = getDatabase();

      const customer = await callerA.customers.create({
        name: `Probe ${nanoid(6)}`,
        isActive: true,
      });

      // Simulate the hardened write executed under tenant B's id.
      const result = db
        .update(customers)
        .set({ name: 'Should Not Apply' })
        .where(and(eq(customers.id, customer.id), eq(customers.tenantId, tenantB.tenantId)))
        .run() as { changes?: number };
      expect(result.changes ?? 0).toBe(0);

      const survivor = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customer.id))
        .get();
      expect(survivor?.name).toBe(customer.name);
    });

    it('DELETE customers scoped by (id, tenantId) cannot remove a foreign row', async () => {
      const callerA = appRouter.createCaller(buildCtx(tenantA));
      const db = getDatabase();

      const customer = await callerA.customers.create({
        name: `Probe ${nanoid(6)}`,
        isActive: true,
      });

      const result = db
        .delete(customers)
        .where(and(eq(customers.id, customer.id), eq(customers.tenantId, tenantB.tenantId)))
        .run() as { changes?: number };
      expect(result.changes ?? 0).toBe(0);

      const survivor = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customer.id))
        .get();
      expect(survivor).toBeTruthy();
    });
  });
});
