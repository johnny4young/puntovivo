/**
 * Catalog changes (products, categories, units, tax rates, numbering) leave a
 * chained audit row with before/after, scoped to the acting tenant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, companies, sites, tenants, units, users, vatRates } from '../db/schema.js';
import { verifyAuditChain } from '../services/audit-logs.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { appRouter } from '../trpc/router.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let fresh: ReturnType<typeof makeFreshContextFactory>;
let tenantId = '';
let siteId = '';
let baseUnitId = '';
let vatRateId = '';

function caller() {
  return appRouter.createCaller(fresh());
}

function latestAudit(action: string, resourceId: string) {
  return getDatabase()
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.action, action),
        eq(auditLogs.resourceId, resourceId)
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .get();
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin');
  tenantId = admin.tenantId;
  const site = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
  const unit = db
    .select()
    .from(units)
    .where(eq(units.tenantId, tenantId))
    .all()
    .find(row => row.abbreviation === 'UND');
  const vat = db
    .select()
    .from(vatRates)
    .where(and(eq(vatRates.tenantId, tenantId), eq(vatRates.name, 'IVA 19%')))
    .get();
  if (!site || !unit || !vat) throw new Error('Expected seeded site, unit and VAT rate');
  siteId = site.id;
  baseUnitId = unit.id;
  vatRateId = vat.id;
  const device = await registerDevice(db, {
    tenantId,
    userId: admin.id,
    kind: 'web',
    name: 'catalog-audit',
  });
  fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId: admin.id,
    email: admin.email,
    siteId,
    deviceId: device.deviceId,
  });
}, 30_000);

afterAll(async () => {
  await server.close();
});

describe('catalog audit', () => {
  it('audits product creation and only the changed price, cost and tax fields on update', async () => {
    const product = await caller().products.create({
      name: 'Audit Coffee',
      sku: `AUD-${nanoid(6)}`,
      cost: 5,
      initialCost: 0,
      price: 100,
      price2: 100,
      price3: 100,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 0,
      minStock: 0,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 100, isBase: true }],
    });
    expect(latestAudit('product.create', product.id)).toMatchObject({
      resourceType: 'product',
      before: null,
      after: { name: 'Audit Coffee', price: 100, cost: 5 },
    });

    await caller().products.update({
      id: product.id,
      version: product.version,
      price: 120,
      cost: 6,
      vatRateId,
    });
    const update = latestAudit('product.update', product.id);
    expect(update?.before).toMatchObject({ price: 100, cost: 5, vatRateId: null });
    expect(update?.after).toMatchObject({ price: 120, cost: 6, vatRateId });
    expect(update?.after).not.toHaveProperty('name');
  });

  it('audits category, unit and tax rate create, update and delete', async () => {
    const category = await caller().categories.create({ name: 'Audit Drinks' });
    const renamed = await caller().categories.update({
      id: category.id,
      version: category.version,
      name: 'Audit Beverages',
    });
    await caller().categories.delete({ id: category.id });
    expect(latestAudit('category.create', category.id)?.after).toMatchObject({
      name: 'Audit Drinks',
    });
    expect(latestAudit('category.update', category.id)).toMatchObject({
      before: { name: 'Audit Drinks' },
      after: { name: renamed.name },
    });
    expect(latestAudit('category.delete', category.id)?.before).toMatchObject({
      name: 'Audit Beverages',
    });

    const unit = await caller().units.create({ name: 'Audit Box', abbreviation: 'ABX' });
    await caller().units.update({ id: unit.id, name: 'Audit Crate' });
    await caller().units.delete({ id: unit.id });
    expect(latestAudit('unit.create', unit.id)?.after).toMatchObject({ abbreviation: 'ABX' });
    expect(latestAudit('unit.update', unit.id)).toMatchObject({
      before: { name: 'Audit Box' },
      after: { name: 'Audit Crate' },
    });
    expect(latestAudit('unit.delete', unit.id)?.resourceType).toBe('unit');

    const rate = await caller().vatRates.create({ name: 'Audit 5%', rate: 5 });
    await caller().vatRates.update({ id: rate.id, rate: 8 });
    await caller().vatRates.delete({ id: rate.id });
    expect(latestAudit('vat_rate.create', rate.id)?.after).toMatchObject({ rate: 5 });
    expect(latestAudit('vat_rate.update', rate.id)).toMatchObject({
      before: { rate: 5 },
      after: { rate: 8 },
    });
    expect(latestAudit('vat_rate.delete', rate.id)?.before).toMatchObject({ rate: 8 });

    expect((await verifyAuditChain(getDatabase(), tenantId)).valid).toBe(true);
  });

  it('keeps catalog audit rows out of another tenant and blocks foreign edits', async () => {
    const db = getDatabase();
    const foreignTenantId = nanoid();
    const now = new Date().toISOString();
    db.insert(tenants)
      .values({
        id: foreignTenantId,
        name: 'Foreign',
        slug: `f-${foreignTenantId}`,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(companies)
      .values({
        id: nanoid(),
        tenantId: foreignTenantId,
        name: 'Foreign Co',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const foreignRateId = nanoid();
    db.insert(vatRates)
      .values({
        id: foreignRateId,
        tenantId: foreignTenantId,
        name: 'Foreign 10%',
        rate: 10,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    await expect(caller().vatRates.update({ id: foreignRateId, rate: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(caller().vatRates.delete({ id: foreignRateId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const foreignRows = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, foreignRateId))
      .all();
    expect(foreignRows).toHaveLength(0);
    expect(
      db.select().from(auditLogs).where(eq(auditLogs.tenantId, foreignTenantId)).all()
    ).toHaveLength(0);
  });
});
