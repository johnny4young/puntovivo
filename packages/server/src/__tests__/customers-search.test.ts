/**
 * `customers.list` server-side search.
 *
 * The param has existed since the router was written and had NO coverage,
 * which is how the web could ship a client-side filter over one 50-row page
 * for so long: a tenant with more customers than that was told "no results"
 * for people who exist. The web now delegates the term here, so this is the
 * contract that fix rests on.
 *
 * The load-bearing case is `finds a match that lives beyond the first page`:
 * it is the bug, expressed as a test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { customers, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

function createTestContext(overrides: { tenantId?: string } = {}): Context {
  const db = getDatabase();
  const activeTenantId = overrides.tenantId ?? tenantId;
  const user = {
    id: userId,
    email: 'admin@localhost',
    role: 'admin',
    tenantId: activeTenantId,
  };
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, ...user },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user,
    tenantId: activeTenantId,
    siteId: null,
  };
}

async function seedCustomer(args: {
  name: string;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
  tenant?: string;
}) {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(customers).values({
    id,
    tenantId: args.tenant ?? tenantId,
    name: args.name,
    email: args.email ?? null,
    phone: args.phone ?? null,
    taxId: args.taxId ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

beforeEach(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin user');
  tenantId = admin.tenantId;
  userId = admin.id;
});

afterEach(async () => {
  await server.close();
});

describe('customers.list search', () => {
  it('finds a match that lives beyond the first page', async () => {
    // THE bug: 60 customers, and the one we want sorts past the 50-row page
    // the web loads. A client-side filter over that page reports "no
    // results" for a real customer.
    for (let i = 0; i < 60; i += 1) {
      await seedCustomer({ name: `Cliente Relleno ${String(i).padStart(3, '0')}` });
    }
    const needleId = await seedCustomer({ name: 'Doña Rosa Escondida' });

    const caller = appRouter.createCaller(createTestContext());
    const unsearched = await caller.customers.list({ page: 1, perPage: 50 });
    expect(unsearched.items.some(c => c.id === needleId)).toBe(false);

    const searched = await caller.customers.list({ page: 1, perPage: 50, search: 'Escondida' });
    expect(searched.items.map(c => c.id)).toContain(needleId);
  });

  it('matches on email and phone, not just the name', async () => {
    // The table shows neither column by default ( trimmed them), so
    // the old name-only client filter could not find a customer by the phone
    // number the cashier was reading off a receipt.
    const byEmail = await seedCustomer({
      name: 'Ferretería El Tornillo',
      email: 'pagos@tornillo.co',
    });
    const byPhone = await seedCustomer({ name: 'Panadería La Espiga', phone: '+57 300 555 4444' });

    const caller = appRouter.createCaller(createTestContext());

    const emailHit = await caller.customers.list({ page: 1, perPage: 50, search: 'tornillo.co' });
    expect(emailHit.items.map(c => c.id)).toContain(byEmail);

    const phoneHit = await caller.customers.list({ page: 1, perPage: 50, search: '555 4444' });
    expect(phoneHit.items.map(c => c.id)).toContain(byPhone);
  });

  it('matches on the identification document in list and search', async () => {
    const byDocument = await seedCustomer({ name: 'María López', taxId: '1020304050' });
    await seedCustomer({ name: 'Otro Cliente', taxId: '900111222' });

    const caller = appRouter.createCaller(createTestContext());

    const listHit = await caller.customers.list({ page: 1, perPage: 50, search: '10203' });
    expect(listHit.items.map(c => c.id)).toEqual([byDocument]);

    const searchHit = await caller.customers.search({ q: '1020304050', limit: 5 });
    expect(searchHit.items.map(c => c.id)).toEqual([byDocument]);
  });

  it('returns search matches in name order', async () => {
    const zoe = await seedCustomer({ name: 'Zoe Mar' });
    const ana = await seedCustomer({ name: 'Ana Mar' });
    const caller = appRouter.createCaller(createTestContext());
    const result = await caller.customers.search({ q: 'Mar', limit: 5 });
    expect(result.items.map(c => c.id)).toEqual([ana, zoe]);
  });

  it('can limit search to active customers', async () => {
    const active = await seedCustomer({ name: 'Rosa Activa' });
    const inactive = await seedCustomer({ name: 'Rosa Inactiva' });
    await getDatabase()
      .update(customers)
      .set({ isActive: false })
      .where(eq(customers.id, inactive));

    const caller = appRouter.createCaller(createTestContext());
    const all = await caller.customers.search({ q: 'Rosa', limit: 5 });
    expect(all.items.map(c => c.id).sort()).toEqual([active, inactive].sort());

    const onlyActive = await caller.customers.search({ q: 'Rosa', limit: 5, isActive: true });
    expect(onlyActive.items.map(c => c.id)).toEqual([active]);
  });

  it('reports the searched total, not the whole book', async () => {
    await seedCustomer({ name: 'Doña Rosa Escondida' });
    await seedCustomer({ name: 'Cliente Visible Sin Coincidencia' });
    const caller = appRouter.createCaller(createTestContext());
    const all = await caller.customers.list({ page: 1, perPage: 50 });
    const searched = await caller.customers.list({ page: 1, perPage: 50, search: 'Escondida' });

    // The count query has to carry the same WHERE, or the pager would offer
    // pages of a result set the search already narrowed.
    expect(searched.totalItems).toBeLessThan(all.totalItems);
    expect(searched.totalItems).toBe(searched.items.length);
  });

  it('never reaches across tenants', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const foreignTenantId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Tenant Vecino Search',
      slug: `tenant-vecino-search-${foreignTenantId}`,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignId = await seedCustomer({
      name: 'Doña Rosa Escondida',
      tenant: foreignTenantId,
    });
    const localId = await seedCustomer({ name: 'Doña Rosa Escondida' });

    // Same term, same name — only the caller's own row may come back.
    const caller = appRouter.createCaller(createTestContext());
    const searched = await caller.customers.list({ page: 1, perPage: 50, search: 'Escondida' });

    expect(searched.items.map(c => c.id)).toContain(localId);
    expect(searched.items.map(c => c.id)).not.toContain(foreignId);
    expect(searched.items.every(c => c.tenantId === tenantId)).toBe(true);
  });

  it('treats an absent search as no filter', async () => {
    const customerId = await seedCustomer({ name: 'Cliente Sin Filtro' });
    const caller = appRouter.createCaller(createTestContext());
    const all = await caller.customers.list({ page: 1, perPage: 50 });
    expect(all.items.map(c => c.id)).toContain(customerId);
  });
});
