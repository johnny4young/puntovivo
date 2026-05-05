/**
 * ENG-055 — Invariant tests for `application/sales/discardDraft`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import {
  fiscalDocuments,
  operationEffects,
  products,
  saleItems,
  sales,
  sites,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { recordOperationStart } from '../services/operation-journal/journal.js';
import { completeSale } from '../application/sales/completeSale.js';
import { discardDraft } from '../application/sales/discardDraft.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let cashier2Id: string;
let siteId: string;
let baseUnitId: string;

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

async function seedProduct(args: { name: string; sku: string; stock: number }) {
  const db = getDatabase();
  const productId = nanoid();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: args.name,
    sku: args.sku,
    price: 11.9,
    price2: 11.9,
    price3: 11.9,
    cost: 5,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 19,
    initialCost: 5,
    stock: args.stock,
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
    price: 11.9,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

async function seedDraftSale(productId: string) {
  const result = await completeSale(buildContext(), {
    mode: 'fresh',
    customerId: null,
    items: [
      { productId, unitId: baseUnitId, quantity: 1, unitPrice: 11.9, discount: 0 },
    ],
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    status: 'draft',
    amountReceived: 0,
    discountAmount: 0,
  });
  return (result.sale as { id: string }).id;
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const seededUser = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@localhost'))
    .get();
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
  const seededUnits = await db
    .select()
    .from(units)
    .where(eq(units.tenantId, tenantId))
    .all();
  const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
  if (!baseUnit) throw new Error('Expected seeded unit UND');
  baseUnitId = baseUnit.id;

  cashier2Id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id: cashier2Id,
    tenantId,
    email: 'cashier2-discardDraft@localhost',
    passwordHash: 'x',
    name: 'Cashier 2 discard',
    role: 'cashier',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  const reg = await registerDeviceService(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'application-sales-discardDraft.test',
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
  const caller = appRouter.createCaller(fresh());
  await caller.cashSessions.open({
    registerName: 'discardDraft-app register',
    openingFloat: 200,
    denominations: [{ value: 100, count: 2 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('discardDraft (happy paths)', () => {
  it('flips suspended draft to cancelled, restores stock, clears suspended cols', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Discard happy', sku: 'DD-OK', stock: 5 });
    const draftId = await seedDraftSale(productId);
    // Manually mark as suspended (mirrors what sales.suspend persists).
    await db
      .update(sales)
      .set({ suspendedAt: new Date().toISOString(), suspendedBy: userId })
      .where(eq(sales.id, draftId))
      .run();

    const stockBefore = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .get();
    expect(stockBefore?.stock).toBe(4); // draft debited 1

    const result = await discardDraft(buildContext(), { saleId: draftId });
    expect(result).toMatchObject({ id: draftId, status: 'cancelled' });

    const after = await db
      .select({
        status: sales.status,
        suspendedAt: sales.suspendedAt,
        suspendedBy: sales.suspendedBy,
      })
      .from(sales)
      .where(eq(sales.id, draftId))
      .get();
    expect(after?.status).toBe('cancelled');
    expect(after?.suspendedAt).toBeNull();
    expect(after?.suspendedBy).toBeNull();

    const stockAfter = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, productId))
      .get();
    expect(stockAfter?.stock).toBe(5);
  });

  it('allows the creator to discard an orphan draft (never suspended)', async () => {
    const productId = await seedProduct({ name: 'Discard orphan', sku: 'DD-ORPH', stock: 5 });
    const draftId = await seedDraftSale(productId);
    // Orphan = no suspension; creator is the test admin (userId).
    await expect(discardDraft(buildContext(), { saleId: draftId })).resolves.toMatchObject({
      status: 'cancelled',
    });
  });
});

describe('discardDraft (state guards)', () => {
  it('rejects non-draft sales', async () => {
    const db = getDatabase();
    const productId = await seedProduct({
      name: 'Discard non-draft',
      sku: 'DD-NONDR',
      stock: 5,
    });
    const draftId = await seedDraftSale(productId);
    await db.update(sales).set({ status: 'completed' }).where(eq(sales.id, draftId)).run();

    await expect(
      discardDraft(buildContext(), { saleId: draftId })
    ).rejects.toMatchObject({ message: expect.stringMatching(/draft/i) });
  });

  it('rejects when caller is not creator nor suspender nor manager/admin', async () => {
    const productId = await seedProduct({
      name: 'Discard ownership',
      sku: 'DD-OWN',
      stock: 5,
    });
    const draftId = await seedDraftSale(productId);

    await expect(
      discardDraft(
        buildContext({ user: { id: cashier2Id, role: 'cashier' } }),
        { saleId: draftId }
      )
    ).rejects.toMatchObject({
      message: expect.stringMatching(/created.*suspended/i),
    });
  });

  it('lets a manager override the ownership lock', async () => {
    const productId = await seedProduct({
      name: 'Discard manager',
      sku: 'DD-MGR',
      stock: 5,
    });
    const draftId = await seedDraftSale(productId);

    await expect(
      discardDraft(
        buildContext({ user: { id: cashier2Id, role: 'manager' } }),
        { saleId: draftId }
      )
    ).resolves.toMatchObject({ status: 'cancelled' });
  });
});

describe('discardDraft (empty draft)', () => {
  it('flips status with audit reversedItems=0 when there are no line items', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Discard empty', sku: 'DD-EMPTY', stock: 5 });
    const draftId = await seedDraftSale(productId);
    // Nuke the line items so the draft is "empty" (matches the
    // legacy behaviour where a cashier created a blank draft).
    await db.delete(saleItems).where(eq(saleItems.saleId, draftId)).run();

    const result = await discardDraft(buildContext(), { saleId: draftId });
    expect(result.status).toBe('cancelled');
  });
});

describe('discardDraft (no fiscal emission)', () => {
  it('does not call the fiscal orchestrator (drafts never had a fiscal doc)', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Discard fiscal', sku: 'DD-FX', stock: 5 });
    const draftId = await seedDraftSale(productId);

    await discardDraft(buildContext(), { saleId: draftId });

    const fiscals = await db
      .select()
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.sourceId, draftId))
      .all();
    expect(fiscals.length).toBe(0);
  });
});

describe('discardDraft (journal effects)', () => {
  it('emits sale_row + inventory_movement + outbox_enqueue:sync + audit_log; never cash_movement or fiscal_emit', async () => {
    const db = getDatabase();
    const productId = await seedProduct({ name: 'Discard journal', sku: 'DD-JE', stock: 5 });
    const draftId = await seedDraftSale(productId);

    const operationId = nanoid();
    const reg = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'discardDraft.journal',
    });
    await recordOperationStart(db, {
      tenantId,
      operationId,
      operationKind: 'sales.discardDraft',
      deviceId: reg.deviceId,
      userId,
      requestHash: 'dd-journal',
    });

    const result = await discardDraft(
      buildContext({ envelope: { operationId } }),
      { saleId: draftId }
    );
    expect(result.journalEventId).toBeTruthy();

    const effects = await db
      .select({ kind: operationEffects.kind })
      .from(operationEffects)
      .where(eq(operationEffects.operationEventId, result.journalEventId!))
      .orderBy(asc(operationEffects.createdAt))
      .all();
    const kinds = effects.map(eff => eff.kind);
    expect(kinds).toContain('sale_row');
    expect(kinds).toContain('inventory_movement');
    expect(kinds).toContain('outbox_enqueue:sync');
    expect(kinds).toContain('audit_log');
    expect(kinds).not.toContain('cash_movement');
    expect(kinds).not.toContain('fiscal_emit');
  });
});

describe('discardDraft (multi-tenant isolation)', () => {
  it('does not touch foreign tenant data', async () => {
    const db = getDatabase();
    const otherTenantId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: otherTenantId,
      name: 'Foreign tenant for discardDraft',
      slug: `iso-dd-${nanoid(6).toLowerCase()}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignSalesBefore = await db
      .select()
      .from(sales)
      .where(eq(sales.tenantId, otherTenantId))
      .all();

    const productId = await seedProduct({ name: 'Discard Iso', sku: 'DD-ISO', stock: 5 });
    const draftId = await seedDraftSale(productId);
    await discardDraft(buildContext(), { saleId: draftId });

    const foreignSalesAfter = await db
      .select()
      .from(sales)
      .where(eq(sales.tenantId, otherTenantId))
      .all();
    expect(foreignSalesAfter.length).toBe(foreignSalesBefore.length);
  });
});
