/**
 * Delivery Orders tRPC Router (ENG-091) — tests.
 *
 * Covers the per-site delivery queue happy path plus the cross-tenant
 * isolation invariant on the hardened `advance` UPDATE: a caller from
 * tenant B must not be able to advance (mutate) a delivery order owned
 * by tenant A. The `advance` mutation runs a tenant-scoped pre-check
 * SELECT that throws `NOT_FOUND`, and its UPDATE WHERE clause is scoped
 * by `(id, tenantId)`, so a foreign id can never move another tenant's
 * order.
 *
 * Two-tenant harness mirrors `authority-router.test.ts` /
 * `audit-logs.test.ts`: tenant + company + site + admin user per tenant.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hash } from 'argon2';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, deliveryOrders, sites, tenants, users } from '../db/schema.js';
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
  const tenantId = `do-tenant-${suffix}`;
  const companyId = `do-company-${suffix}`;
  const siteId = `do-site-${suffix}`;
  const adminId = `do-admin-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Delivery Tenant ${suffix}`,
    slug: `do-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Delivery Company ${suffix}`,
    taxId: `DO-${suffix}`,
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

describe('Delivery Orders tRPC Router (ENG-091)', () => {
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

  it('creates a delivery order and advances its status through the queue', async () => {
    const caller = appRouter.createCaller(buildCtx(tenantA));

    const { id } = await caller.deliveryOrders.create({
      siteId: tenantA.siteId,
      customerName: 'Ada Lovelace',
      address: 'Calle 100 #20-30',
    });

    const advanced = await caller.deliveryOrders.advance({
      id,
      toStatus: 'preparing',
      courierName: 'Carlos',
    });
    expect(advanced).toEqual({ id, status: 'preparing' });

    const listed = await caller.deliveryOrders.list({ siteId: tenantA.siteId });
    const row = listed.find(order => order.id === id);
    expect(row?.status).toBe('preparing');
    expect(row?.courierName).toBe('Carlos');
    expect(row?.preparingAt).toBeTruthy();
  });

  it("rejects advancing another tenant's delivery order and leaves it unchanged", async () => {
    const callerA = appRouter.createCaller(buildCtx(tenantA));
    const callerB = appRouter.createCaller(buildCtx(tenantB));
    const db = getDatabase();

    const { id } = await callerA.deliveryOrders.create({
      siteId: tenantA.siteId,
      customerName: `Customer ${nanoid(6)}`,
      address: 'Av. Siempre Viva 742',
    });

    // Tenant B attempts to move tenant A's order — the pre-check rejects
    // with NOT_FOUND before the hardened UPDATE is reached.
    await expect(
      callerB.deliveryOrders.advance({ id, toStatus: 'cancelled' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const survivor = await db
      .select()
      .from(deliveryOrders)
      .where(eq(deliveryOrders.id, id))
      .get();
    expect(survivor).toBeTruthy();
    expect(survivor?.tenantId).toBe(tenantA.tenantId);
    // Status must still be the original 'accepted' — never moved to
    // 'cancelled', and cancelledAt must remain null.
    expect(survivor?.status).toBe('accepted');
    expect(survivor?.cancelledAt).toBeNull();
  });
});
