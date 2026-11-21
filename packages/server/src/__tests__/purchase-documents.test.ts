import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  orderItems,
  orders,
  products,
  providers,
  purchaseDocuments,
  purchases,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { freshCriticalContext, makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let testDeviceId: string;
let testDatabaseDirectory: string;

function createTestContext(role: 'admin' | 'manager' | 'cashier' = 'manager'): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: makeEnvelopeHeadersProxy({
      getDeviceId: () => testDeviceId,
      getSiteId: () => siteId,
    }),
    user: { userId, email: `${role}@localhost`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: { id: userId, email: `${role}@localhost`, role, tenantId },
    tenantId,
    siteId,
  };
}

async function seedCatalogFixture() {
  const db = getDatabase();
  const now = new Date().toISOString();
  const providerId = nanoid();
  const productId = nanoid();

  await db.insert(providers).values({
    id: providerId,
    tenantId,
    name: `Document Fixture Supplier ${nanoid(5)}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(products).values({
    id: productId,
    tenantId,
    name: 'Document Fixture Product',
    sku: `DOC-${randomUUID().slice(0, 8)}`,
    price: 10,
    price2: 10,
    price3: 10,
    cost: 3,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    initialCost: 3,
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
    price: 10,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });

  return { providerId, productId };
}

async function insertPurchaseRow() {
  const db = getDatabase();
  const now = new Date().toISOString();
  const purchaseId = nanoid();
  const providerId = nanoid();

  await db.insert(providers).values({
    id: providerId,
    tenantId,
    name: `Row Supplier ${purchaseId.slice(0, 6)}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(purchases).values({
    id: purchaseId,
    tenantId,
    purchaseNumber: `DOC-${purchaseId.slice(0, 8)}`,
    providerId,
    siteId,
    status: 'completed',
    subtotal: 10,
    total: 10,
    createdBy: userId,
    syncStatus: 'pending',
    syncVersion: 1,
    createdAt: now,
    updatedAt: now,
  });

  return purchaseId;
}

describe('Purchase documents', () => {
  beforeAll(async () => {
    testDatabaseDirectory = mkdtempSync(join(tmpdir(), 'puntovivo-purchase-docs-'));
    server = await createServer({
      dbPath: join(testDatabaseDirectory, 'purchase-docs.db'),
      verbose: false,
    });

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

    const registration = await registerDeviceService(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'purchase-documents.test',
    });
    testDeviceId = registration.deviceId;

    const seededUnits = await db.select().from(units).where(eq(units.tenantId, tenantId)).all();
    const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;
  });

  afterAll(async () => {
    await server.close();
    rmSync(testDatabaseDirectory, { recursive: true, force: true });
  });

  it('persists the document identity on a created purchase', async () => {
    const db = getDatabase();
    const { providerId, productId } = await seedCatalogFixture();
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const caller = appRouter.createCaller(
      freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId,
        userId,
        email: 'admin@localhost',
        role: 'admin',
        siteId,
        deviceId: testDeviceId,
        envelope,
      })
    );

    const created = await caller.purchases.create({
      providerId,
      items: [{ productId, unitId: baseUnitId, quantity: 3, costPerUnit: 10 }],
      notes: 'Delivered with remisión',
      documentType: 'remision',
      documentNumber: 'RM-0042',
    });

    const row = await db
      .select({ documentType: purchases.documentType, documentNumber: purchases.documentNumber })
      .from(purchases)
      .where(eq(purchases.id, created.id))
      .get();
    expect(row?.documentType).toBe('remision');
    expect(row?.documentNumber).toBe('RM-0042');

    // The receipt evidence includes the initial document identity.
    const identityAudit = db
      .select({ after: auditLogs.after })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceId, created.id),
          eq(auditLogs.action, 'purchase.document_updated')
        )
      )
      .get();
    expect(identityAudit?.after).toMatchObject({
      documentType: 'remision',
      documentNumber: 'RM-0042',
    });
  });

  it('records the initial document identity when receiving from an order', async () => {
    const db = getDatabase();
    const { providerId, productId } = await seedCatalogFixture();
    const orderItemId = nanoid();
    const now = new Date().toISOString();

    await db.insert(orders).values({
      id: 'order-remision-1',
      tenantId,
      orderNumber: 'PED-RM-1',
      providerId,
      siteId,
      status: 'submitted',
      subtotal: 20,
      total: 20,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(orderItems).values({
      id: orderItemId,
      orderId: 'order-remision-1',
      productId,
      quantity: 2,
      unitId: baseUnitId,
      unitEquivalence: 1,
      costPerUnit: 10,
      baseUnitCost: 10,
      total: 20,
    });

    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const caller = appRouter.createCaller(
      freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId,
        userId,
        email: 'admin@localhost',
        role: 'admin',
        siteId,
        deviceId: testDeviceId,
        envelope,
      })
    );

    const received = await caller.purchases.createFromOrder({
      orderId: 'order-remision-1',
      items: [{ orderItemId, quantity: 2 }],
      documentType: 'remision',
      documentNumber: 'RM-0099',
    });

    const identityAudit = db
      .select({ after: auditLogs.after })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceId, received.id),
          eq(auditLogs.action, 'purchase.document_updated')
        )
      )
      .get();
    expect(identityAudit?.after).toMatchObject({
      documentType: 'remision',
      documentNumber: 'RM-0099',
    });
  });

  it('sets and updates the document identity with an audit row', async () => {
    const purchaseId = await insertPurchaseRow();
    const caller = appRouter.createCaller(createTestContext('manager'));

    const first = await caller.purchases.setDocument({
      purchaseId,
      documentType: 'remision',
      documentNumber: 'RM-0017',
    });
    expect(first).toMatchObject({ documentType: 'remision', documentNumber: 'RM-0017' });

    const second = await caller.purchases.setDocument({
      purchaseId,
      documentNumber: 'RM-0017-B',
    });
    expect(second).toMatchObject({ documentType: 'remision', documentNumber: 'RM-0017-B' });

    const audit = getDatabase()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, purchaseId), eq(auditLogs.action, 'purchase.document_updated')))
      .all();
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('attaches the paper once, returns it with a verified hash, and rejects a second attach', async () => {
    const purchaseId = await insertPurchaseRow();
    const caller = appRouter.createCaller(createTestContext('manager'));
    const paper = Buffer.from('remision paper image bytes', 'utf8').toString('base64');

    const attached = await caller.purchases.attachDocument({
      purchaseId,
      fileName: 'remision.png',
      mimeType: 'image/png',
      documentBase64: paper,
    });
    expect(attached.sizeBytes).toBe(Buffer.from(paper, 'base64').length);

    await expect(
      caller.purchases.attachDocument({
        purchaseId,
        mimeType: 'image/png',
        documentBase64: paper,
      })
    ).rejects.toThrow(/already has an attached document/i);

    const fetched = await caller.purchases.getDocument({ purchaseId });
    expect(fetched.fileName).toBe('remision.png');
    expect(fetched.mimeType).toBe('image/png');
    expect(fetched.documentBase64).toBe(paper);

    const audit = getDatabase()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, purchaseId), eq(auditLogs.action, 'purchase.document_attached')))
      .all();
    expect(audit.length).toBe(1);
  });

  it('detects a tampered attachment at read time', async () => {
    const purchaseId = await insertPurchaseRow();
    const db = getDatabase();
    const caller = appRouter.createCaller(createTestContext('manager'));
    const paper = Buffer.from('original bytes', 'utf8').toString('base64');

    await caller.purchases.attachDocument({
      purchaseId,
      mimeType: 'image/jpeg',
      documentBase64: paper,
    });

    await db
      .update(purchaseDocuments)
      .set({ payloadBase64: Buffer.from('tampered bytes', 'utf8').toString('base64') })
      .where(eq(purchaseDocuments.purchaseId, purchaseId))
      .run();

    await expect(caller.purchases.getDocument({ purchaseId })).rejects.toThrow(
      /failed integrity verification/i
    );
  });

  it('rejects an empty payload and an unknown purchase', async () => {
    const purchaseId = await insertPurchaseRow();
    const caller = appRouter.createCaller(createTestContext('manager'));

    await expect(
      caller.purchases.attachDocument({
        purchaseId,
        mimeType: 'image/png',
        documentBase64: '==',
      })
    ).rejects.toThrow(/payload is empty/i);

    await expect(
      caller.purchases.getDocument({ purchaseId: 'purchase-that-does-not-exist' })
    ).rejects.toThrow(/Purchase not found/i);
  });
});
