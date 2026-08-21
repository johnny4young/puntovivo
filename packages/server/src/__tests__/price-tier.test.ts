/**
 * Invariant tests for customer price tiers (H2.4).
 *
 * The tier decides which catalog price the override detector judges a
 * line against: a tier-2 customer buying at price2 is normal pricing,
 * the SAME price sold to a walk-in is a manual override that must leave
 * the sale.price_override audit trail. The resolver is shared with the
 * web cart (@puntovivo/shared/price-tier), so these tests pin the
 * server half of the lockstep.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  auditLogs,
  customers,
  inventoryBalances,
  products,
  saleItems,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { completeSale } from '../application/sales/completeSale.js';
import { resolveCustomerPriceTier } from '../application/sales/item-resolution.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let makeCaller: () => ReturnType<typeof appRouter.createCaller>;

function buildContext(overrides: Partial<CompleteSaleContext> = {}): CompleteSaleContext {
  return {
    db: getDatabase(),
    tenantId,
    siteId,
    user: { id: userId, role: 'admin' },
    envelope: null,
    deviceId: null,
    log: undefined,
    ...overrides,
  };
}

async function seedTierProduct(args: { sku: string; price: number; price2: number }) {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: `Tier product ${args.sku}`,
    sku: args.sku,
    price: args.price,
    price2: args.price2,
    price3: args.price,
    cost: 1,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: 1,
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId,
    unitId: baseUnitId,
    equivalence: 1,
    price: args.price,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId,
    productId,
    onHand: 50,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

async function sellAt(productId: string, unitPrice: number, customerId: string | null) {
  return completeSale(buildContext(), {
    mode: 'fresh',
    ...(customerId ? { customerId } : {}),
    items: [{ productId, unitId: baseUnitId, quantity: 1, unitPrice, discount: 0 }],
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    amountReceived: 100_000,
    discountAmount: 0,
  });
}

async function overrideAuditRowsFor(saleId: string) {
  const rows = await getDatabase()
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'sale.price_override')))
    .all();
  return rows.filter(row => row.resourceId === saleId);
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!seededUser) throw new Error('Expected seeded admin user');
  tenantId = seededUser.tenantId;
  userId = seededUser.id;

  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;

  const seededUnits = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
  const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
  if (!baseUnit) throw new Error('Expected seeded unit UND');
  baseUnitId = baseUnit.id;

  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'price-tier.test',
  });

  const fresh = makeFreshContextFactory({
    db,
    serverApp: server.app,
    tenantId,
    userId,
    email: 'admin@localhost',
    siteId,
    deviceId: reg.deviceId,
    defaultRole: 'admin',
  });
  makeCaller = () => appRouter.createCaller(fresh());
  await makeCaller().cashSessions.open({
    registerName: 'Tier register',
    openingFloat: 100,
    denominations: [{ value: 100, count: 1 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('customer price tier', () => {
  it('round-trips through customer create and update', async () => {
    const caller = makeCaller();
    const created = await caller.customers.create({ name: 'Mayorista Uno', priceTier: 2 });
    expect(created.priceTier).toBe(2);

    const updated = await caller.customers.update({
      id: created.id,
      version: created.version,
      priceTier: 3,
    });
    expect(updated.priceTier).toBe(3);
  });

  it('resolves walk-in and unknown customers to tier 1', async () => {
    const db = getDatabase();
    expect(await resolveCustomerPriceTier(db, tenantId, null)).toBe(1);
    expect(await resolveCustomerPriceTier(db, tenantId, 'no-such-customer')).toBe(1);
  });

  it('does not flag a tier-2 customer buying at price2 as an override', async () => {
    const caller = makeCaller();
    const customer = await caller.customers.create({ name: 'Contratista', priceTier: 2 });
    const productId = await seedTierProduct({
      sku: `TIER-OK-${nanoid(6)}`,
      price: 1000,
      price2: 800,
    });

    const result = await sellAt(productId, 800, customer.id);
    expect(result.sale.total).toBe(800);
    expect(await overrideAuditRowsFor(result.sale.id)).toHaveLength(0);
  });

  it('still flags the same wholesale price as an override for a walk-in', async () => {
    const productId = await seedTierProduct({
      sku: `TIER-WK-${nanoid(6)}`,
      price: 1000,
      price2: 800,
    });

    const result = await sellAt(productId, 800, null);
    const overrides = await overrideAuditRowsFor(result.sale.id);
    expect(overrides).toHaveLength(1);
  });

  it('flags a tier-2 customer sold at a price that is neither tier price', async () => {
    const caller = makeCaller();
    const customer = await caller.customers.create({ name: 'Contratista Dos', priceTier: 2 });
    const productId = await seedTierProduct({
      sku: `TIER-OD-${nanoid(6)}`,
      price: 1000,
      price2: 800,
    });

    const result = await sellAt(productId, 700, customer.id);
    expect(await overrideAuditRowsFor(result.sale.id)).toHaveLength(1);
  });

  it('does not flag a tier-2 customer sold at plain retail', async () => {
    const caller = makeCaller();
    const customer = await caller.customers.create({ name: 'Contratista Tres', priceTier: 2 });
    const productId = await seedTierProduct({
      sku: `TIER-RT-${nanoid(6)}`,
      price: 1000,
      price2: 800,
    });

    // Not applying the wholesale discount is not a hand-typed price.
    const result = await sellAt(productId, 1000, customer.id);
    expect(await overrideAuditRowsFor(result.sale.id)).toHaveLength(0);
  });

  it('never resolves another tenant customer tier', async () => {
    const db = getDatabase();
    const { tenants } = await import('../db/schema.js');
    const foreignTenantId = `foreign-${nanoid(8)}`;
    const foreignCustomerId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign Tenant',
      slug: foreignTenantId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(customers).values({
      id: foreignCustomerId,
      tenantId: foreignTenantId,
      name: 'Mayorista Ajeno',
      priceTier: 3,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    expect(await resolveCustomerPriceTier(db, tenantId, foreignCustomerId)).toBe(1);
  });

  it('audits a price tier change with before and after', async () => {
    const caller = makeCaller();
    const customer = await caller.customers.create({ name: 'Auditable', priceTier: 1 });
    await caller.customers.update({
      id: customer.id,
      version: customer.version,
      priceTier: 3,
    });

    const row = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, 'customer.price_tier.update'),
          eq(auditLogs.resourceId, customer.id)
        )
      )
      .get();
    expect(row?.resourceId).toBe(customer.id);
    expect(row?.before).toMatchObject({ priceTier: 1 });
    expect(row?.after).toMatchObject({ priceTier: 3 });
  });

  it('freezes the unit standard code onto the sale line', async () => {
    const productId = await seedTierProduct({
      sku: `TIER-UC-${nanoid(6)}`,
      price: 500,
      price2: 400,
    });

    const result = await sellAt(productId, 500, null);
    const line = await getDatabase()
      .select({ unitStandardCode: saleItems.unitStandardCode })
      .from(saleItems)
      .where(eq(saleItems.saleId, result.sale.id))
      .get();
    // The seeded UND unit carries C62; the sale line snapshots it.
    expect(line?.unitStandardCode).toBe('C62');
  });
});

describe('seeded unit dimensions', () => {
  it('carries dimension, UN/ECE code and reference factor on the core units', async () => {
    const db = getDatabase();
    const rows = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
    const byAbbr = new Map(rows.map(row => [row.abbreviation, row]));

    expect(byAbbr.get('KG')).toMatchObject({
      dimension: 'mass',
      standardCode: 'KGM',
      referenceFactor: 1000,
    });
    expect(byAbbr.get('GR')).toMatchObject({ dimension: 'mass', standardCode: 'GRM' });
    expect(byAbbr.get('LT')).toMatchObject({
      dimension: 'volume',
      standardCode: 'LTR',
      referenceFactor: 1000,
    });
    expect(byAbbr.get('MT')).toMatchObject({ dimension: 'length', standardCode: 'MTR' });
    expect(byAbbr.get('UND')).toMatchObject({ dimension: 'count', standardCode: 'C62' });
  });
});
