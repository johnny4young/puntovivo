import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  companies,
  products,
  sites,
  syncConflicts,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let otherTenantSiteId: string;
let adminId: string;

function makeCtx(
  role: 'admin' | 'manager' | 'cashier' | 'viewer',
  overrides: Partial<Context> = {}
): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId: adminId, email: `${role}@localhost`, role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as unknown as Context['res'],
    db,
    user: { id: adminId, email: `${role}@localhost`, role, tenantId },
    tenantId,
    siteId,
    ...overrides,
  };
}

describe('Band 1 security guards and audit coverage', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin');
    tenantId = admin.tenantId;
    adminId = admin.id;
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;

    const now = new Date().toISOString();
    const otherTenantId = `other-tenant-${nanoid(6)}`;
    const otherCompanyId = `other-co-${nanoid(6)}`;
    otherTenantSiteId = `other-site-${nanoid(6)}`;
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Other Tenant',
      slug: otherTenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: otherCompanyId,
      tenantId: otherTenantId,
      name: 'Other Co',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: otherTenantSiteId,
      tenantId: otherTenantId,
      companyId: otherCompanyId,
      name: 'Other Site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => server.close());

  it('rejects viewer on sync.push and peripherals.printReceipt, and rejects cashier on dashboard.summary', async () => {
    const viewerCaller = appRouter.createCaller(makeCtx('viewer'));
    await expect(viewerCaller.sync.push({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      viewerCaller.peripherals.printReceipt({ saleId: 'missing-sale', siteId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const cashierCaller = appRouter.createCaller(makeCtx('cashier'));
    await expect(cashierCaller.dashboard.summary()).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const viewerSummary = await viewerCaller.dashboard.summary();
    expect(viewerSummary).toBeDefined();
  });

  it('rejects cross-tenant siteId in productSerials.list', async () => {
    const adminCaller = appRouter.createCaller(makeCtx('admin'));
    await expect(
      adminCaller.productSerials.list({ productId: 'any-prod', siteId: otherTenantSiteId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('writes audit logs for product.delete, fiscal.settings.update (without PIN), and sync.conflict.resolve', async () => {
    const db = getDatabase();
    const adminCaller = appRouter.createCaller(makeCtx('admin'));
    const now = new Date().toISOString();

    const prodId = `del-prod-${nanoid(6)}`;
    await db.insert(products).values({
      id: prodId,
      tenantId,
      name: 'Disposable Product',
      sku: `DISP-${nanoid(6)}`,
      price: 1000,
      cost: 500,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await adminCaller.products.delete({ id: prodId });

    await adminCaller.fiscalSettings.updateCo({
      environment: 'habilitacion',
      softwareId: '11111111-2222-3333-4444-555555555555',
      softwarePin: '98765',
      enabled: false,
    });

    const prodKeepId = `keep-prod-${nanoid(6)}`;
    await db.insert(products).values({
      id: prodKeepId,
      tenantId,
      name: 'Kept Product',
      sku: `KEEP-${nanoid(6)}`,
      price: 1000,
      cost: 500,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const conflictId = `conf-${nanoid(6)}`;
    await db.insert(syncConflicts).values({
      id: conflictId,
      tenantId,
      entityType: 'products',
      entityId: prodKeepId,
      localData: { name: 'Kept Product' },
      remoteData: { name: 'Remote Product' },
      status: 'pending',
      createdAt: now,
    });
    await adminCaller.sync.resolve({ id: conflictId, resolution: 'local_wins' });

    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tenantId))
      .orderBy(desc(auditLogs.createdAt))
      .all();

    const actions = new Set(rows.map(r => r.action));
    expect(actions.has('product.delete')).toBe(true);
    expect(actions.has('fiscal.settings.update')).toBe(true);
    expect(actions.has('sync.conflict.resolve')).toBe(true);

    const fiscalAudit = rows.find(r => r.action === 'fiscal.settings.update');
    expect(JSON.stringify(fiscalAudit ?? {})).not.toContain('98765');
  });
});
