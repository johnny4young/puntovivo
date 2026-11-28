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
  syncOutbox,
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
        and(eq(auditLogs.resourceId, created.id), eq(auditLogs.action, 'purchase.document_updated'))
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
      .where(
        and(eq(auditLogs.resourceId, purchaseId), eq(auditLogs.action, 'purchase.document_updated'))
      )
      .all();
    expect(audit.length).toBeGreaterThanOrEqual(2);

    const updatedRow = getDatabase()
      .select({ syncStatus: purchases.syncStatus, syncVersion: purchases.syncVersion })
      .from(purchases)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, tenantId)))
      .get();
    expect(updatedRow?.syncStatus).toBe('pending');
    expect(updatedRow?.syncVersion).toBe(3);

    const outboxRows = getDatabase()
      .select({ operation: syncOutbox.operation, payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.entityType, 'purchases'),
          eq(syncOutbox.entityId, purchaseId)
        )
      )
      .all();
    expect(outboxRows.length).toBe(2);
    expect(outboxRows[1]?.operation).toBe('update');
    expect(outboxRows[1]?.payload).toMatchObject({
      id: purchaseId,
      documentType: 'remision',
      documentNumber: 'RM-0017-B',
    });
  });

  it('attaches the paper once as a BLOB, returns it with a verified hash, and rejects a second attach', async () => {
    const purchaseId = await insertPurchaseRow();
    const caller = appRouter.createCaller(createTestContext('manager'));
    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('remision paper image bytes', 'utf8'),
    ]);
    const paper = pngBytes.toString('base64');

    const attached = await caller.purchases.attachDocument({
      purchaseId,
      fileName: 'remision.png',
      mimeType: 'image/png',
      documentBase64: paper,
    });
    expect(attached.sizeBytes).toBe(pngBytes.length);

    const stored = getDatabase()
      .select({ payload: purchaseDocuments.payload })
      .from(purchaseDocuments)
      .where(
        and(eq(purchaseDocuments.tenantId, tenantId), eq(purchaseDocuments.purchaseId, purchaseId))
      )
      .get();
    expect(Buffer.isBuffer(stored?.payload)).toBe(true);
    expect(stored?.payload.equals(pngBytes)).toBe(true);

    await expect(
      caller.purchases.attachDocument({
        purchaseId,
        mimeType: 'image/png',
        documentBase64: paper,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const fetched = await caller.purchases.getDocument({ purchaseId });
    expect(fetched.fileName).toBe('remision.png');
    expect(fetched.mimeType).toBe('image/png');
    expect(fetched.documentBase64).toBe(paper);

    const audit = getDatabase()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceId, purchaseId),
          eq(auditLogs.action, 'purchase.document_attached')
        )
      )
      .all();
    expect(audit.length).toBe(1);
  });

  it('rejects files whose magic bytes disagree with the declared MIME type', async () => {
    const purchaseId = await insertPurchaseRow();
    const caller = appRouter.createCaller(createTestContext('manager'));
    const plainText = Buffer.from('not really a pdf or image', 'utf8').toString('base64');

    await expect(
      caller.purchases.attachDocument({
        purchaseId,
        fileName: 'spoofed.pdf',
        mimeType: 'application/pdf',
        documentBase64: plainText,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      caller.purchases.attachDocument({
        purchaseId,
        fileName: 'spoofed.webp',
        mimeType: 'image/webp',
        documentBase64: Buffer.from('RIFF1234AVI ', 'utf8').toString('base64'),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // Valid PDF magic header passes cleanly.
    const pdfBytes = Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8');
    await expect(
      caller.purchases.attachDocument({
        purchaseId,
        fileName: 'remision.pdf',
        mimeType: 'application/pdf',
        documentBase64: pdfBytes.toString('base64'),
      })
    ).resolves.toMatchObject({ sizeBytes: pdfBytes.length });
  });

  it('detects a tampered attachment at read time', async () => {
    const purchaseId = await insertPurchaseRow();
    const db = getDatabase();
    const caller = appRouter.createCaller(createTestContext('manager'));
    const jpegBytes = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('original bytes', 'utf8'),
    ]);

    await caller.purchases.attachDocument({
      purchaseId,
      mimeType: 'image/jpeg',
      documentBase64: jpegBytes.toString('base64'),
    });

    await db
      .update(purchaseDocuments)
      .set({ payload: Buffer.from('tampered bytes', 'utf8') })
      .where(
        and(eq(purchaseDocuments.tenantId, tenantId), eq(purchaseDocuments.purchaseId, purchaseId))
      )
      .run();

    await expect(caller.purchases.getDocument({ purchaseId })).rejects.toThrow(
      /failed integrity verification/i
    );
  });

  it('rejects cross-tenant document identity updates, reads, and attachments', async () => {
    const purchaseId = await insertPurchaseRow();
    const ownCaller = appRouter.createCaller(createTestContext('manager'));
    const webpBytes = Buffer.from('RIFF\x12\x00\x00\x00WEBPVP8 ', 'binary');

    await ownCaller.purchases.setDocument({
      purchaseId,
      documentType: 'remision',
      documentNumber: 'RM-OWN-1',
    });
    await ownCaller.purchases.attachDocument({
      purchaseId,
      fileName: 'remision.webp',
      mimeType: 'image/webp',
      documentBase64: webpBytes.toString('base64'),
    });

    const foreignCtx = {
      ...createTestContext('manager'),
      tenantId: `foreign-tenant-${nanoid(6)}`,
    };
    const foreignCaller = appRouter.createCaller(foreignCtx);

    await expect(
      foreignCaller.purchases.setDocument({
        purchaseId,
        documentType: 'invoice',
        documentNumber: 'INV-FOREIGN',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const untouched = getDatabase()
      .select({ documentType: purchases.documentType, documentNumber: purchases.documentNumber })
      .from(purchases)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, tenantId)))
      .get();
    expect(untouched).toEqual({ documentType: 'remision', documentNumber: 'RM-OWN-1' });

    await expect(foreignCaller.purchases.getDocument({ purchaseId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      foreignCaller.purchases.attachDocument({
        purchaseId,
        mimeType: 'image/webp',
        documentBase64: webpBytes.toString('base64'),
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects cashiers on every document procedure', async () => {
    const purchaseId = await insertPurchaseRow();
    const cashier = appRouter.createCaller(createTestContext('cashier'));
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await expect(
      cashier.purchases.setDocument({ purchaseId, documentType: 'invoice', documentNumber: 'X-1' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      cashier.purchases.attachDocument({
        purchaseId,
        mimeType: 'image/png',
        documentBase64: pngBytes.toString('base64'),
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(cashier.purchases.getDocument({ purchaseId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const stored = getDatabase()
      .select({ id: purchaseDocuments.id })
      .from(purchaseDocuments)
      .where(eq(purchaseDocuments.purchaseId, purchaseId))
      .get();
    expect(stored).toBeUndefined();
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
