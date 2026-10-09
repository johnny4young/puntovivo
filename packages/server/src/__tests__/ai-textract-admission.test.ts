import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const textractCall = vi.hoisted(() => vi.fn());
const priceConfig = vi.hoisted(() => vi.fn());
vi.mock('../services/ai/invoice/textract.js', async () => {
  const actual = await vi.importActual<typeof import('../services/ai/invoice/textract.js')>(
    '../services/ai/invoice/textract.js'
  );
  return {
    ...actual,
    extractInvoiceWithTextract: (...args: unknown[]) => textractCall(...args),
    resolveTextractPriceConfig: (...args: unknown[]) => priceConfig(...args),
  };
});

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  aiAuditLog,
  aiBudgetReservations,
  companies,
  invoiceUploads,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { reserveAiBudget } from '../services/ai/budget.js';
import type { Context } from '../trpc/context.js';

const INVOICE = {
  supplierName: 'Distribuidora Norte',
  supplierTaxId: '900123456-1',
  invoiceNumber: 'FAC-1',
  invoiceDate: null,
  currencyCode: 'COP',
  lines: [],
  subtotal: 100,
  taxAmount: 19,
  total: 119,
};

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let otherSiteId: string;
let uploadId: string;

function caller(site: string | null = siteId, signal?: AbortSignal) {
  const ctx: Context = {
    req: {} as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'textract@example.com', role: 'admin', tenantId },
    tenantId,
    siteId: site,
  };
  return appRouter.createCaller(ctx, signal ? { signal } : undefined);
}

async function seed() {
  const db = getDatabase();
  const now = new Date().toISOString();
  tenantId = nanoid();
  userId = nanoid();
  siteId = nanoid();
  otherSiteId = nanoid();
  uploadId = nanoid();
  const companyId = nanoid();
  await db.insert(tenants).values({
    id: tenantId,
    name: 'Textract tenant',
    slug: `textract-${tenantId}`,
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
    email: `textract-${userId}@example.com`,
    passwordHash: 'test-hash',
    name: 'Textract admin',
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(companies)
    .values({ id: companyId, tenantId, name: 'Main', createdAt: now, updatedAt: now });
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
  await db.insert(invoiceUploads).values({
    id: uploadId,
    tenantId,
    siteId,
    userId,
    fileName: 'invoice.png',
    mimeType: 'image/png',
    sizeBytes: 5,
    payloadBase64: 'aGVsbG8=',
    payloadHash: 'fixture-hash',
    createdAt: now,
  });
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  textractCall.mockReset();
  priceConfig.mockReset();
  priceConfig.mockReturnValue({ region: 'us-east-1', usdPerPage: 0.01 });
  textractCall.mockResolvedValue({
    invoice: INVOICE,
    costUsd: 0.01,
    durationMs: 12,
    provider: 'textract',
    model: 'aws-textract-analyze-expense',
  });
  await seed();
});

describe('active Textract invoice admission', () => {
  it('does not create an invoice upload without an active site', async () => {
    await expect(
      caller(null).upload.uploadInvoice({
        imageBase64: 'aGVsbG8=',
        mimeType: 'image/png',
        fileName: 'invoice.png',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      await getDatabase().select().from(invoiceUploads).where(eq(invoiceUploads.tenantId, tenantId))
    ).toHaveLength(1);
  });

  it('rejects WebP before upload or paid Textract dispatch', async () => {
    await expect(
      caller().upload.uploadInvoice({
        imageBase64: 'aGVsbG8=',
        // @ts-expect-error Intentional unsupported Textract MIME input.
        mimeType: 'image/webp',
        fileName: 'invoice.webp',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await getDatabase()
      .update(invoiceUploads)
      .set({ mimeType: 'image/webp' })
      .where(eq(invoiceUploads.id, uploadId));
    await expect(caller().ai.invoiceOcr.extract({ uploadId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(textractCall).not.toHaveBeenCalled();
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('requires a site and a same-site upload before any paid call', async () => {
    await expect(caller(null).ai.invoiceOcr.extract({ uploadId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller(otherSiteId).ai.invoiceOcr.extract({ uploadId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(textractCall).not.toHaveBeenCalled();
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('does not confirm a draft against an upload from another site', async () => {
    const input = {
      uploadId,
      extractAuditId: 'extract-audit',
      providerId: 'supplier-id',
      supplier: { name: 'Proveedor', nit: null },
      invoiceNumber: null,
      totals: { subtotal: 100, iva: 19, total: 119, linesSum: 119 },
      lines: [
        {
          description: 'Artículo',
          quantity: 1,
          unitPrice: 100,
          matchedProductId: 'product-id',
          unitId: 'unit-id',
        },
      ],
    };
    await expect(caller(otherSiteId).ai.invoiceOcr.confirm(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(caller(null).ai.invoiceOcr.confirm(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('does not reserve or dispatch when regional pricing is unavailable', async () => {
    priceConfig.mockImplementationOnce(() => {
      throw new Error('regional price missing');
    });
    await expect(caller().ai.invoiceOcr.extract({ uploadId })).rejects.toThrow();
    expect(textractCall).not.toHaveBeenCalled();
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
    expect(
      await getDatabase().select().from(aiAuditLog).where(eq(aiAuditLog.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('does not reserve or dispatch after the HTTP response was already lost', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      caller(siteId, controller.signal).ai.invoiceOcr.extract({ uploadId })
    ).rejects.toMatchObject({ code: 'CLIENT_CLOSED_REQUEST' });
    expect(textractCall).not.toHaveBeenCalled();
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('serializes concurrent provider calls and settles a priced audit row', async () => {
    let finish!: (value: unknown) => void;
    textractCall.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const first = caller().ai.invoiceOcr.extract({ uploadId });
    await vi.waitFor(() => expect(textractCall).toHaveBeenCalledTimes(1));
    await expect(caller().ai.invoiceOcr.extract({ uploadId })).rejects.toMatchObject({
      cause: { errorCode: 'AI_BUDGET_BUSY' },
    });
    finish({
      invoice: INVOICE,
      costUsd: 0.01,
      durationMs: 12,
      provider: 'textract',
      model: 'aws-textract-analyze-expense',
    });
    await expect(first).resolves.toMatchObject({ meta: { costUsd: 0.01 } });
    expect(
      await getDatabase().select().from(aiAuditLog).where(eq(aiAuditLog.tenantId, tenantId))
    ).toMatchObject([{ costUsd: 0.01, costState: 'estimated', errorCode: null, siteId }]);
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('holds unknown liability after provider failure and blocks a free retry', async () => {
    textractCall.mockRejectedValueOnce(new Error('AWS connection reset'));
    await expect(caller().ai.invoiceOcr.extract({ uploadId })).rejects.toMatchObject({
      cause: { errorCode: 'AI_PROVIDER_ERROR' },
    });
    await expect(caller().ai.invoiceOcr.extract({ uploadId })).rejects.toMatchObject({
      cause: { errorCode: 'AI_BUDGET_EXCEEDED' },
    });
    expect(textractCall).toHaveBeenCalledTimes(1);
    expect(
      await getDatabase().select().from(aiAuditLog).where(eq(aiAuditLog.tenantId, tenantId))
    ).toMatchObject([{ costState: 'unknown', errorCode: 'AI_PROVIDER_ERROR' }]);
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toMatchObject([{ state: 'unknown' }]);
  });

  it('does not expose raw provider failure text in the tRPC error', async () => {
    const sensitive = 'invoice tax ID 900123456-1';
    textractCall.mockRejectedValueOnce(new Error(sensitive));
    const error = await caller()
      .ai.invoiceOcr.extract({ uploadId })
      .then(
        () => null,
        cause => cause as Error & { cause?: { details?: unknown } }
      );
    expect(error?.cause?.details).toBeUndefined();
    expect(error?.message).not.toContain(sensitive);
  });

  it('blocks Textract when the known one-page cost exceeds remaining budget', async () => {
    await getDatabase()
      .update(tenants)
      .set({
        settings: {
          ai: {
            enabled: true,
            monthlyBudgetUsd: 0.005,
            providerId: 'anthropic',
            modelId: null,
            features: { invoiceOcr: { enabled: true, provider: 'textract' } },
          },
        },
      })
      .where(eq(tenants.id, tenantId));
    await expect(caller().ai.invoiceOcr.extract({ uploadId })).rejects.toMatchObject({
      cause: { errorCode: 'AI_BUDGET_EXCEEDED' },
    });
    expect(textractCall).not.toHaveBeenCalled();
  });

  it('rechecks the invoice OCR feature toggle inside budget admission', async () => {
    await getDatabase()
      .update(tenants)
      .set({
        settings: {
          ai: {
            enabled: true,
            monthlyBudgetUsd: 1,
            providerId: 'anthropic',
            modelId: null,
            features: { invoiceOcr: { enabled: false, provider: 'textract' } },
          },
        },
      })
      .where(eq(tenants.id, tenantId));
    expect(() =>
      reserveAiBudget(getDatabase(), tenantId, new Date(), {
        invoiceOcrSiteId: siteId,
        minimumKnownCostUsd: 0.01,
      })
    ).toThrow();
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('rechecks the selected Textract provider inside budget admission', async () => {
    priceConfig.mockImplementationOnce(() => {
      getDatabase()
        .update(tenants)
        .set({
          settings: {
            ai: {
              enabled: true,
              monthlyBudgetUsd: 1,
              providerId: 'anthropic',
              modelId: null,
              features: { invoiceOcr: { enabled: true, provider: 'docai' } },
            },
          },
        })
        .where(eq(tenants.id, tenantId))
        .run();
      return { region: 'us-east-1', usdPerPage: 0.01 };
    });
    await expect(caller().ai.invoiceOcr.extract({ uploadId })).rejects.toMatchObject({
      cause: { errorCode: 'AI_PROVIDER_ERROR' },
    });
    expect(textractCall).not.toHaveBeenCalled();
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('rechecks the 200-call site quota and site ownership inside the budget writer', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    // Site ownership is rechecked under the writer lock with a coded error.
    let foreignSiteError: unknown;
    try {
      reserveAiBudget(db, tenantId, new Date(), { invoiceOcrSiteId: 'foreign-site' });
    } catch (error) {
      foreignSiteError = error;
    }
    expect(foreignSiteError).toMatchObject({
      code: 'NOT_FOUND',
      cause: { errorCode: 'AI_INVOICE_OCR_SITE_NOT_FOUND' },
    });
    await db.insert(aiAuditLog).values(
      Array.from({ length: 200 }, () => ({
        id: nanoid(),
        tenantId,
        siteId,
        userId,
        feature: 'invoiceOcr' as const,
        providerId: 'textract',
        modelId: 'aws-textract-analyze-expense',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.01,
        costState: 'estimated' as const,
        durationMs: 1,
        errorCode: null,
        createdAt: now,
      }))
    );
    expect(() => reserveAiBudget(db, tenantId, new Date(), { invoiceOcrSiteId: siteId })).toThrow();
    expect(() =>
      reserveAiBudget(db, tenantId, new Date(), { invoiceOcrSiteId: 'foreign-site' })
    ).toThrow();
    expect(
      await db
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
    expect(textractCall).not.toHaveBeenCalled();
  });

  it('lets a dispatched Textract call finish and settle its pages after a disconnect', async () => {
    const controller = new AbortController();
    let finish!: () => void;
    textractCall.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = () =>
            resolve({
              invoice: INVOICE,
              costUsd: 0.01,
              durationMs: 12,
              provider: 'textract',
              model: 'aws-textract-analyze-expense',
            });
        })
    );
    const pending = caller(siteId, controller.signal).ai.invoiceOcr.extract({ uploadId });
    await vi.waitFor(() => expect(textractCall).toHaveBeenCalledTimes(1));
    const input = textractCall.mock.calls[0]?.[0] as { abortSignal?: AbortSignal };
    controller.abort();
    // The client close is admission-only: the paid call is not abandoned.
    expect(input.abortSignal?.aborted).toBe(false);
    finish();
    await expect(pending).resolves.toMatchObject({ meta: { costUsd: 0.01 } });
    expect(
      await getDatabase().select().from(aiAuditLog).where(eq(aiAuditLog.tenantId, tenantId))
    ).toMatchObject([{ costState: 'estimated', costUsd: 0.01 }]);
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it.each([
    // The Textract SDK models throttling as a server fault; it is still never billed.
    { name: 'ThrottlingException', fault: 'server', status: 400 },
    { name: 'AccessDeniedException', fault: 'client', status: 400 },
    { name: 'UnsupportedDocumentException', fault: 'client', status: 400 },
    { name: 'InvalidParameterException', fault: 'client', status: 400 },
    // Unmodeled AWS credential rejections only expose $metadata.httpStatusCode.
    { name: 'UnrecognizedClientException', fault: 'client', status: 400 },
    { name: 'ExpiredTokenException', fault: 'client', status: 400 },
    // No credentials: the SDK fails before signing or sending a request.
    { name: 'CredentialsProviderError', fault: undefined, status: undefined },
  ])(
    'releases the hold when AWS answers $name (no page analyzed)',
    async ({ name, fault, status }) => {
      textractCall.mockRejectedValueOnce(
        Object.assign(new Error(`${name}: rejected`), {
          name,
          ...(fault ? { $fault: fault } : {}),
          ...(status ? { $metadata: { httpStatusCode: status } } : {}),
        })
      );
      await expect(caller().ai.invoiceOcr.extract({ uploadId })).rejects.toMatchObject({
        cause: { errorCode: 'AI_PROVIDER_ERROR' },
      });
      expect(
        await getDatabase().select().from(aiAuditLog).where(eq(aiAuditLog.tenantId, tenantId))
      ).toMatchObject([{ costState: 'not_incurred', costUsd: 0, errorCode: 'AI_PROVIDER_ERROR' }]);
      expect(
        await getDatabase()
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.tenantId, tenantId))
      ).toHaveLength(0);
      // The released admission serves the next invoice.
      await expect(caller().ai.invoiceOcr.extract({ uploadId })).resolves.toBeDefined();
    }
  );

  it('keeps an AWS server fault as an unknown liability', async () => {
    textractCall.mockRejectedValueOnce(
      Object.assign(new Error('InternalServerError'), {
        name: 'InternalServerError',
        $fault: 'server',
        $metadata: { httpStatusCode: 500 },
      })
    );
    await expect(caller().ai.invoiceOcr.extract({ uploadId })).rejects.toMatchObject({
      cause: { errorCode: 'AI_PROVIDER_ERROR' },
    });
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toMatchObject([{ state: 'unknown' }]);
  });
});
