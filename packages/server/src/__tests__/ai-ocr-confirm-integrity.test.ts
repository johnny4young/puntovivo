import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  aiAuditLog,
  auditLogs,
  companies,
  invoiceUploads,
  products,
  providers,
  purchases,
  sequentials,
  sites,
  syncOutbox,
  tenants,
  units,
  unitXProduct,
  users,
} from '../db/schema.js';
import { writeAuditLog } from '../services/audit-logs.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import type { ConfirmInvoiceDraftInput } from '../trpc/schemas/ai-vision.js';
import { confirmInvoiceDraftInput } from '../trpc/schemas/ai-vision.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let otherSiteId: string;
let userId: string;
let uploadId: string;
let extractAuditId: string;
let input: ConfirmInvoiceDraftInput;

function caller(site: string | null = siteId) {
  const ctx: Context = {
    req: {} as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'ocr-confirm@example.com', role: 'admin', tenantId },
    tenantId,
    siteId: site,
  };
  return appRouter.createCaller(ctx);
}

async function seed() {
  const db = getDatabase();
  const now = new Date().toISOString();
  tenantId = nanoid();
  siteId = nanoid();
  otherSiteId = nanoid();
  userId = nanoid();
  uploadId = nanoid();
  extractAuditId = nanoid();
  const companyId = nanoid();
  const providerId = nanoid();
  const productId = nanoid();
  const unitId = nanoid();
  await db.insert(tenants).values({
    id: tenantId,
    name: 'OCR confirmation tenant',
    slug: `ocr-confirm-${tenantId}`,
    settings: {
      ai: {
        enabled: true,
        monthlyBudgetUsd: 1,
        providerId: 'anthropic',
        modelId: null,
        features: { invoiceOcr: { enabled: true, provider: 'textract' } },
      },
    },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `ocr-${userId}@example.com`,
    passwordHash: 'test-hash',
    name: 'OCR confirm admin',
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: 'OCR company',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values([
    { id: siteId, tenantId, companyId, name: 'A', isActive: true, createdAt: now, updatedAt: now },
    {
      id: otherSiteId,
      tenantId,
      companyId,
      name: 'B',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(providers).values({
    id: providerId,
    tenantId,
    name: 'Supplier',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(units).values({
    id: unitId,
    tenantId,
    name: 'Unit',
    abbreviation: 'u',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: 'Rice',
    sku: `RICE-${productId}`,
    cost: 100,
    price: 120,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(unitXProduct).values({
    id: nanoid(),
    productId,
    unitId,
    equivalence: 1,
    price: 120,
    isBase: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sequentials).values({
    id: nanoid(),
    tenantId,
    siteId,
    documentType: 'purchase',
    prefix: `OCR-${tenantId.slice(0, 4)}-`,
    currentValue: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(invoiceUploads).values({
    id: uploadId,
    tenantId,
    siteId,
    userId,
    fileName: 'invoice.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    payloadBase64: 'aGVsbG8=',
    payloadHash: `hash-${uploadId}`,
    createdAt: now,
  });
  await db.insert(aiAuditLog).values({
    id: extractAuditId,
    tenantId,
    siteId,
    userId,
    feature: 'invoiceOcr',
    providerId: 'textract',
    modelId: 'aws-textract-analyze-expense',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0.01,
    costState: 'estimated',
    durationMs: 1,
    errorCode: null,
    createdAt: now,
  });
  db.transaction(tx =>
    writeAuditLog({
      tx,
      tenantId,
      actorId: userId,
      action: 'ai.invoice_ocr.extract',
      resourceType: 'ai_feature',
      resourceId: uploadId,
      metadata: { aiAuditLogId: extractAuditId, payloadHash: `hash-${uploadId}` },
    })
  );
  input = {
    uploadId,
    extractAuditId,
    providerId,
    supplier: { name: 'Supplier', nit: '900123456-1' },
    invoiceNumber: 'INV-1',
    totals: { subtotal: 100, iva: 19, total: 119, linesSum: 119 },
    lines: [
      {
        description: 'Rice',
        quantity: 1,
        unitPrice: 100,
        netCostConfirmed: true,
        matchedProductId: productId,
        unitId,
      },
    ],
  };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});
afterAll(async () => {
  await server.close();
});
beforeEach(seed);

describe('invoice OCR confirmation integrity', () => {
  it('rejects an invented extract audit before creating a purchase', async () => {
    await expect(
      caller().ai.invoiceOcr.confirm({ ...input, extractAuditId: nanoid() })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await getDatabase().select().from(purchases).where(eq(purchases.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('rejects an extraction linked to another upload or site', async () => {
    const db = getDatabase();
    const secondUploadId = nanoid();
    await db.insert(invoiceUploads).values({
      id: secondUploadId,
      tenantId,
      siteId,
      userId,
      mimeType: 'image/png',
      sizeBytes: 10,
      payloadBase64: 'aGVsbG8=',
      payloadHash: `hash-${secondUploadId}`,
      createdAt: new Date().toISOString(),
    });
    await expect(
      caller().ai.invoiceOcr.confirm({ ...input, uploadId: secondUploadId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await db
      .update(aiAuditLog)
      .set({ siteId: otherSiteId })
      .where(eq(aiAuditLog.id, extractAuditId));
    await expect(caller().ai.invoiceOcr.confirm(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('does not accept an extraction or upload owned by another tenant', async () => {
    const db = getDatabase();
    const foreignTenantId = nanoid();
    const foreignSiteId = nanoid();
    const foreignUserId = nanoid();
    const foreignCompanyId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Other OCR tenant',
      slug: `ocr-other-${foreignTenantId}`,
      settings: {
        ai: {
          enabled: true,
          monthlyBudgetUsd: 1,
          providerId: 'anthropic',
          modelId: null,
          features: { invoiceOcr: { enabled: true, provider: 'textract' } },
        },
      },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: foreignUserId,
      tenantId: foreignTenantId,
      email: `ocr-foreign-${foreignUserId}@example.com`,
      passwordHash: 'test-hash',
      name: 'Foreign admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: foreignCompanyId,
      tenantId: foreignTenantId,
      name: 'Other OCR company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: foreignSiteId,
      tenantId: foreignTenantId,
      companyId: foreignCompanyId,
      name: 'Other OCR site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignContext: Context = {
      req: {} as Context['req'],
      res: {} as Context['res'],
      db,
      user: {
        id: foreignUserId,
        email: `ocr-foreign-${foreignUserId}@example.com`,
        role: 'admin',
        tenantId: foreignTenantId,
      },
      tenantId: foreignTenantId,
      siteId: foreignSiteId,
    };
    await expect(
      appRouter.createCaller(foreignContext).ai.invoiceOcr.confirm(input)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await db.select().from(purchases).where(eq(purchases.tenantId, foreignTenantId))
    ).toHaveLength(0);
  });

  it('fails closed on a redacted extraction link but replays a committed purchase', async () => {
    const db = getDatabase();
    const extractRow = db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'ai.invoice_ocr.extract')))
      .get();
    await db.update(auditLogs).set({ metadata: null }).where(eq(auditLogs.id, extractRow!.id));
    await expect(caller().ai.invoiceOcr.confirm(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await db
      .update(auditLogs)
      .set({
        metadata: { aiAuditLogId: extractAuditId, payloadHash: `hash-${uploadId}` },
      })
      .where(eq(auditLogs.id, extractRow!.id));
    const first = await caller().ai.invoiceOcr.confirm(input);
    await db.update(auditLogs).set({ metadata: null }).where(eq(auditLogs.id, extractRow!.id));
    const retry = await caller().ai.invoiceOcr.confirm(input);
    expect(retry.purchase.id).toBe(first.purchase.id);
  });

  it('returns the first purchase on identical retry without another outbox, audit or number', async () => {
    const first = await caller().ai.invoiceOcr.confirm(input);
    const second = await caller().ai.invoiceOcr.confirm(input);
    expect(second.purchase.id).toBe(first.purchase.id);
    const db = getDatabase();
    expect(await db.select().from(purchases).where(eq(purchases.tenantId, tenantId))).toHaveLength(
      1
    );
    expect(
      await db
        .select()
        .from(syncOutbox)
        .where(and(eq(syncOutbox.tenantId, tenantId), eq(syncOutbox.entityType, 'purchases')))
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'ai.invoice_ocr.confirm'))
        )
    ).toHaveLength(1);
    const sequential = await db
      .select({ currentValue: sequentials.currentValue })
      .from(sequentials)
      .where(and(eq(sequentials.tenantId, tenantId), eq(sequentials.siteId, siteId)))
      .get();
    expect(sequential?.currentValue).toBe(1);
  });

  it('rejects a changed payload on the same extraction id', async () => {
    await caller().ai.invoiceOcr.confirm(input);
    await expect(
      caller().ai.invoiceOcr.confirm({ ...input, invoiceNumber: 'INV-CHANGED' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects reviewed totals that do not match persisted purchase lines', async () => {
    await expect(
      caller().ai.invoiceOcr.confirm({
        ...input,
        lines: [{ ...input.lines[0]!, unitPrice: 1 }],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller().ai.invoiceOcr.confirm({
        ...input,
        totals: { ...input.totals, iva: 0 },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      await getDatabase().select().from(purchases).where(eq(purchases.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('fails closed when Textract unit price may include tax rather than net line cost', async () => {
    await expect(
      caller().ai.invoiceOcr.confirm({
        ...input,
        lines: [{ ...input.lines[0]!, unitPrice: 119 }],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      await getDatabase().select().from(purchases).where(eq(purchases.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('requires an explicit net-cost review for every invoice line', () => {
    expect(
      confirmInvoiceDraftInput.safeParse({
        ...input,
        lines: input.lines.map(({ netCostConfirmed: _reviewed, ...line }) => line),
      }).success
    ).toBe(false);
    expect(
      confirmInvoiceDraftInput.safeParse({
        ...input,
        lines: input.lines.map(line => ({ ...line, netCostConfirmed: false })),
      }).success
    ).toBe(false);
  });

  it('persists an operator-corrected net cost for a gross-price extraction', async () => {
    const reviewed = {
      ...input,
      lines: input.lines.map(line => ({ ...line, unitPrice: 100, netCostConfirmed: true })),
    };
    const first = await caller().ai.invoiceOcr.confirm(reviewed);
    const retry = await caller().ai.invoiceOcr.confirm(reviewed);
    expect(retry.purchase.id).toBe(first.purchase.id);
    expect(first.purchase.subtotal).toBe(100);
    expect(first.purchase.total).toBe(100);
    const purchaseAudit = await getDatabase()
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'ai.invoice_ocr.confirm')))
      .get();
    expect(purchaseAudit?.metadata).toMatchObject({
      netCostReviewed: true,
      subtotal: 100,
      total: 119,
    });
  });

  it('rejects a failed extraction even when its upload link exists', async () => {
    const db = getDatabase();
    await db
      .update(aiAuditLog)
      .set({ errorCode: 'AI_PROVIDER_ERROR' })
      .where(eq(aiAuditLog.id, extractAuditId));
    await expect(caller().ai.invoiceOcr.confirm(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await db.select().from(purchases).where(eq(purchases.tenantId, tenantId))).toHaveLength(
      0
    );
  });

  it('replays an identical committed confirmation after the feature is disabled', async () => {
    const first = await caller().ai.invoiceOcr.confirm(input);
    const db = getDatabase();
    const tenant = db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    await db
      .update(tenants)
      .set({
        settings: { ...tenant!.settings, ai: { ...tenant!.settings.ai, enabled: false } },
      })
      .where(eq(tenants.id, tenantId));
    const retry = await caller().ai.invoiceOcr.confirm(input);
    expect(retry.purchase.id).toBe(first.purchase.id);
    expect(await db.select().from(purchases).where(eq(purchases.tenantId, tenantId))).toHaveLength(
      1
    );
  });

  it('rolls back the outbox, purchase and number if confirm audit append fails', async () => {
    const db = getDatabase();
    db.$client.exec(
      `CREATE TRIGGER fail_ocr_confirm_audit BEFORE INSERT ON audit_logs WHEN NEW.tenant_id = '${tenantId}' AND NEW.action = 'ai.invoice_ocr.confirm' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`
    );
    try {
      await expect(caller().ai.invoiceOcr.confirm(input)).rejects.toThrow();
      expect(
        await db.select().from(purchases).where(eq(purchases.tenantId, tenantId))
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(syncOutbox)
          .where(and(eq(syncOutbox.tenantId, tenantId), eq(syncOutbox.entityType, 'purchases')))
      ).toHaveLength(0);
      const sequential = await db
        .select({ currentValue: sequentials.currentValue })
        .from(sequentials)
        .where(and(eq(sequentials.tenantId, tenantId), eq(sequentials.siteId, siteId)))
        .get();
      expect(sequential?.currentValue).toBe(0);
    } finally {
      db.$client.exec('DROP TRIGGER fail_ocr_confirm_audit');
    }
    const retry = await caller().ai.invoiceOcr.confirm(input);
    expect(retry.purchase.status).toBe('draft');
    expect(await db.select().from(purchases).where(eq(purchases.tenantId, tenantId))).toHaveLength(
      1
    );
  });

  it('rolls back purchase and number if sync enqueue fails', async () => {
    const db = getDatabase();
    db.$client.exec(
      `CREATE TRIGGER fail_ocr_sync BEFORE INSERT ON sync_outbox WHEN NEW.tenant_id = '${tenantId}' AND NEW.entity_type = 'purchases' BEGIN SELECT RAISE(ABORT, 'sync unavailable'); END`
    );
    try {
      await expect(caller().ai.invoiceOcr.confirm(input)).rejects.toThrow();
      expect(
        await db.select().from(purchases).where(eq(purchases.tenantId, tenantId))
      ).toHaveLength(0);
      const sequential = await db
        .select({ currentValue: sequentials.currentValue })
        .from(sequentials)
        .where(and(eq(sequentials.tenantId, tenantId), eq(sequentials.siteId, siteId)))
        .get();
      expect(sequential?.currentValue).toBe(0);
      expect(
        await db
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'ai.invoice_ocr.confirm'))
          )
      ).toHaveLength(0);
    } finally {
      db.$client.exec('DROP TRIGGER fail_ocr_sync');
    }
  });
});
