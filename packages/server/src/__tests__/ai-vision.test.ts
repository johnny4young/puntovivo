/**
 * Service-level tests for `extractInvoiceFromImage`.
 *
 * Drives the OCR pipeline against an in-memory database with a stub
 * AIProvider so no real vision call is made. Verifies gating
 * (`AI_DISABLED`, `AI_BUDGET_EXCEEDED`, `AI_PROVIDER_ERROR`,
 * `AI_VISION_NOT_AVAILABLE`, `AI_VISION_IMAGE_TOO_LARGE`,
 * `AI_VISION_PARSE_FAILED`) plus the audit-log row shape on success.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import type { LanguageModelV4 } from '@ai-sdk/provider';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { aiAuditLog, tenants } from '../db/schema.js';
import { ServerErrorWithCode, type ServerErrorCode } from '../lib/errorCodes.js';
import {
  INVOICE_OCR_MAX_BYTES,
  extractInvoiceFromImage,
  type InvoiceOcr,
} from '../services/ai/vision/index.js';
import type { AIProvider, ProviderPricing } from '../services/ai/providers/types.js';

async function expectErrorCode(
  promise: Promise<unknown>,
  expectedCode: ServerErrorCode
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TRPCError);
  const cause = (caught as TRPCError).cause;
  expect(cause).toBeInstanceOf(ServerErrorWithCode);
  expect((cause as ServerErrorWithCode).errorCode).toBe(expectedCode);
}

let server: PuntovivoServer;

const generateObjectMock = vi.fn();

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
  };
});

const PRICING: ProviderPricing = {
  models: {
    'test-vision-model': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1 },
  },
  calculateCostUsd: (_modelId: string, usage) =>
    usage.inputTokens / 1_000_000 + (usage.outputTokens * 5) / 1_000_000,
};

function buildStubProvider(overrides?: Partial<AIProvider>): AIProvider {
  return {
    id: 'anthropic',
    defaultModelId: 'test-vision-model',
    pricing: PRICING,
    isConfigured: () => true,
    languageModel: () => ({}) as LanguageModelV4,
    visionModel: () => ({}) as LanguageModelV4,
    cacheControlForSystemPrompt: () => undefined,
    ...overrides,
  };
}

const SAMPLE_INVOICE: InvoiceOcr = {
  supplierName: 'Distribuidora Norte',
  supplierTaxId: '900123456-1',
  invoiceNumber: 'FAC-0001',
  invoiceDate: '2026-05-09',
  currencyCode: 'COP',
  lines: [
    { description: 'Coca Cola 1.5L', quantity: 12, unitPrice: 4500, totalLine: 54000 },
    { description: 'Pan tajado x500g', quantity: 4, unitPrice: 3000, totalLine: 12000 },
  ],
  subtotal: 66000,
  taxAmount: 12540,
  total: 78540,
};

async function enableAI(
  tenantId: string,
  opts?: { budgetUsd?: number; spentUsd?: number }
): Promise<void> {
  const db = getDatabase();
  await db
    .update(tenants)
    .set({
      settings: {
        ai: {
          enabled: true,
          monthlyBudgetUsd: opts?.budgetUsd ?? 100,
          providerId: 'anthropic',
          modelId: null,
        },
      },
    })
    .where(eq(tenants.id, tenantId));
  if (opts?.spentUsd && opts.spentUsd > 0) {
    await db.insert(aiAuditLog).values({
      id: `seed-${tenantId}`,
      tenantId,
      siteId: null,
      userId: null,
      feature: 'completeTest',
      providerId: 'anthropic',
      modelId: 'test-vision-model',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: opts.spentUsd,
      durationMs: 100,
      errorCode: null,
      createdAt: new Date().toISOString(),
    });
  }
}

async function seedTenant(suffix: string): Promise<string> {
  const db = getDatabase();
  const id = `ocr-tenant-${suffix}`;
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id,
    name: `OCR Tenant ${suffix}`,
    slug: `ocr-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  generateObjectMock.mockReset();
});

describe('extractInvoiceFromImage', () => {
  it('returns the parsed invoice and writes an audit-log row on success', async () => {
    const tenantId = await seedTenant('happy');
    await enableAI(tenantId);

    generateObjectMock.mockResolvedValue({
      object: SAMPLE_INVOICE,
      usage: {
        inputTokens: 1200,
        outputTokens: 300,
        inputTokenDetails: { noCacheTokens: 1200, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    });

    const result = await extractInvoiceFromImage(
      { db: getDatabase(), tenantId, siteId: null, userId: null },
      { imageBase64: 'aGVsbG8=', mimeType: 'image/png' },
      () => buildStubProvider()
    );

    expect(result.invoice.supplierName).toBe('Distribuidora Norte');
    expect(result.invoice.lines).toHaveLength(2);
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('test-vision-model');
    expect(result.costUsd).toBeGreaterThan(0);
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.any(String),
        messages: [
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'file',
                data: 'aGVsbG8=',
                mediaType: 'image/png',
              }),
            ]),
          }),
        ],
      })
    );

    const auditRow = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.id, result.auditLogId))
      .get();
    expect(auditRow).toMatchObject({
      tenantId,
      feature: 'invoiceOcr',
      providerId: 'anthropic',
      modelId: 'test-vision-model',
      inputTokens: 1200,
      outputTokens: 300,
      errorCode: null,
    });
    expect(auditRow?.userId).toBeNull();
  });

  it('rejects an empty image with AI_VISION_IMAGE_TOO_LARGE', async () => {
    const tenantId = await seedTenant('empty');
    await enableAI(tenantId);
    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: '', mimeType: 'image/png' },
        () => buildStubProvider()
      ),
      'AI_VISION_IMAGE_TOO_LARGE'
    );
  });

  it('rejects an oversize image with AI_VISION_IMAGE_TOO_LARGE', async () => {
    const tenantId = await seedTenant('big');
    await enableAI(tenantId);
    // base64 inflates by 4/3, so producing a payload that decodes to
    // > 5 MB only needs ~6.7 MB of base64 chars. Use repeated 'A's so
    // the decoded length is well over the cap.
    const huge = 'A'.repeat(Math.ceil((INVOICE_OCR_MAX_BYTES + 4096) * (4 / 3)));
    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: huge, mimeType: 'image/jpeg' },
        () => buildStubProvider()
      ),
      'AI_VISION_IMAGE_TOO_LARGE'
    );
  });

  it('rejects when AI is disabled for the tenant', async () => {
    const tenantId = await seedTenant('disabled');
    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: 'aGVsbG8=', mimeType: 'image/png' },
        () => buildStubProvider()
      ),
      'AI_DISABLED'
    );
  });

  it('rejects when the provider is not configured', async () => {
    const tenantId = await seedTenant('not-configured');
    await enableAI(tenantId);
    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: 'aGVsbG8=', mimeType: 'image/png' },
        () => buildStubProvider({ isConfigured: () => false })
      ),
      'AI_PROVIDER_ERROR'
    );
  });

  it('rejects with AI_VISION_NOT_AVAILABLE when the provider has no visionModel', async () => {
    const tenantId = await seedTenant('no-vision');
    await enableAI(tenantId);
    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: 'aGVsbG8=', mimeType: 'image/png' },
        () => buildStubProvider({ visionModel: undefined })
      ),
      'AI_VISION_NOT_AVAILABLE'
    );
  });

  it('rejects with AI_BUDGET_EXCEEDED when monthly budget is zero', async () => {
    const tenantId = await seedTenant('budget-zero');
    await enableAI(tenantId, { budgetUsd: 0 });
    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: 'aGVsbG8=', mimeType: 'image/png' },
        () => buildStubProvider()
      ),
      'AI_BUDGET_EXCEEDED'
    );
  });

  it('rejects with AI_BUDGET_EXCEEDED when current spend has consumed the budget', async () => {
    const tenantId = await seedTenant('budget-spent');
    await enableAI(tenantId, { budgetUsd: 1, spentUsd: 2 });
    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: 'aGVsbG8=', mimeType: 'image/png' },
        () => buildStubProvider()
      ),
      'AI_BUDGET_EXCEEDED'
    );
  });

  it('persists a failed-call audit row and surfaces AI_VISION_PARSE_FAILED for schema errors', async () => {
    const tenantId = await seedTenant('parse-fail');
    await enableAI(tenantId);
    // Simulate an `ai` SDK NoObjectGeneratedError by matching its
    // `.message` shape; the service-side classifier looks for the
    // phrase exactly so a future SDK upgrade that renames the class
    // continues to route correctly.
    generateObjectMock.mockRejectedValue(new Error('No object generated by the model.'));

    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: 'aGVsbG8=', mimeType: 'image/png' },
        () => buildStubProvider()
      ),
      'AI_VISION_PARSE_FAILED'
    );

    const rows = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId));
    const failure = rows.find(row => row.errorCode === 'AI_VISION_PARSE_FAILED');
    expect(failure).toBeDefined();
    expect(failure?.feature).toBe('invoiceOcr');
    expect(failure?.costUsd).toBe(0);
  });

  it('classifies a ZodError as AI_VISION_PARSE_FAILED via the SDK-class branch', async () => {
    const tenantId = await seedTenant('parse-fail-zod');
    await enableAI(tenantId);
    const zodErr = new (await import('zod')).z.ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['lines', 0, 'description'],
        message: 'Required',
        input: undefined,
      } as never,
    ]);
    generateObjectMock.mockRejectedValue(zodErr);

    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: 'aGVsbG8=', mimeType: 'image/png' },
        () => buildStubProvider()
      ),
      'AI_VISION_PARSE_FAILED'
    );
  });

  it('does NOT misclassify a provider transport error whose message contains "validation"', async () => {
    // Regression: prior version used a substring heuristic that
    // matched "validation" / "parse" / "schema" / "object" in error
    // messages, including provider HTTP 4xx bodies. Verify a plausible
    // provider error stays AI_PROVIDER_ERROR.
    const tenantId = await seedTenant('false-positive-validation');
    await enableAI(tenantId);
    generateObjectMock.mockRejectedValue(
      new Error('OpenAI API error: Request body validation failed (401)')
    );

    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: 'aGVsbG8=', mimeType: 'image/png' },
        () => buildStubProvider()
      ),
      'AI_PROVIDER_ERROR'
    );
  });

  it('persists a failed-call audit row and surfaces AI_PROVIDER_ERROR for transport errors', async () => {
    const tenantId = await seedTenant('provider-fail');
    await enableAI(tenantId);
    generateObjectMock.mockRejectedValue(new Error('upstream 502 bad gateway'));

    await expectErrorCode(
      extractInvoiceFromImage(
        { db: getDatabase(), tenantId, siteId: null, userId: null },
        { imageBase64: 'aGVsbG8=', mimeType: 'image/png' },
        () => buildStubProvider()
      ),
      'AI_PROVIDER_ERROR'
    );

    const rows = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId));
    const failure = rows.find(row => row.errorCode === 'AI_PROVIDER_ERROR');
    expect(failure).toBeDefined();
  });
});
