/**
 * ENG-040a — Provider-invoice OCR (vision).
 *
 * Routes a base64-encoded invoice image through the tenant's configured
 * vision-capable AI provider and returns a structured invoice
 * projection. Reuses the existing `resolveAISettings` + budget
 * enforcement + `ai_audit_log` pipeline; this module is the vision
 * counterpart of `completeAI` in `client.ts`.
 *
 * Slice 1 (ENG-040a) shipped the pipeline + Zod output schema.
 * Line-to-product mapping shipped in slice 1b. The 10-receipt
 * accuracy benchmark + mobile/tablet camera capture ship in slice 1d
 * (ENG-040d) — see `scripts/benchmark-invoice-ocr.ts` and the
 * scoring helper in `./benchmark-scoring.ts`.
 *
 * @module services/ai/vision/invoice-ocr
 */
import {
  JSONParseError,
  NoObjectGeneratedError,
  TypeValidationError,
  generateObject,
} from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';

import type { DatabaseInstance } from '../../../db/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';

import { currentMonthSpend, recordCall } from '../auditLog.js';
import { toBillableTokenUsage } from '../client.js';
import { getProvider } from '../providers/registry.js';
import type { AIProvider } from '../providers/types.js';
import { resolveAISettings } from '../client.js';

/** Supported upload MIME types for invoice OCR. */
export const INVOICE_OCR_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type InvoiceOcrMimeType = (typeof INVOICE_OCR_MIME_TYPES)[number];

/**
 * 10 MB raw budget after base64 decode. Textract accepts larger PDFs,
 * but the product handoff caps OCR uploads at 10 MB before a provider
 * sees the document.
 */
export const INVOICE_OCR_MAX_BYTES = 10 * 1024 * 1024;

const InvoiceOcrLineSchema = z.object({
  description: z.string().describe('Line item description as printed on the invoice.'),
  quantity: z.number().nullable().describe('Quantity column. Null if absent.'),
  unitPrice: z.number().nullable().describe('Unit price column. Null if absent.'),
  totalLine: z.number().nullable().describe('Line total. Null if absent.'),
});
export type InvoiceOcrLine = z.infer<typeof InvoiceOcrLineSchema>;

export const InvoiceOcrSchema = z.object({
  supplierName: z.string().nullable().describe('Supplier or vendor name printed on the invoice.'),
  supplierTaxId: z.string().nullable().describe('Supplier tax id (NIT, RUT, RFC, etc).'),
  invoiceNumber: z.string().nullable().describe('Invoice number / consecutive.'),
  invoiceDate: z.string().nullable().describe('Invoice date in ISO yyyy-mm-dd format, when readable.'),
  currencyCode: z
    .string()
    .nullable()
    .describe('Three-letter currency code; null when the invoice does not state one explicitly.'),
  lines: z.array(InvoiceOcrLineSchema),
  subtotal: z.number().nullable(),
  taxAmount: z.number().nullable(),
  total: z.number().nullable(),
});
export type InvoiceOcr = z.infer<typeof InvoiceOcrSchema>;

const EXTRACT_PROMPT_SYSTEM =
  'You extract structured purchase-invoice data for a Latin American retail point of sale. ' +
  'Read the supplied invoice photograph carefully. Return every line item you can read with confidence. ' +
  'Latin American number formatting matters: COP, CLP, ARS, PYG and similar zero-decimal currencies ' +
  'print prices with a DOT (or space) as the thousand separator and no fractional part — "1.950" means ' +
  'one thousand nine hundred fifty pesos, NOT one point nine five. ' +
  'In MXN, PEN, and USD the dot is a decimal mark. When the currency printed on the ticket is COP/CLP/' +
  'ARS/PYG, treat every dot/comma inside numeric prices as a thousand separator and return the integer ' +
  'value of the price in the local minor unit. ' +
  'Preserve all output values as plain numbers (no thousand separators in the output, dot as decimal). ' +
  'Use null for any field you cannot read with confidence rather than guessing.';

const EXTRACT_PROMPT_USER =
  'Extract the supplier metadata and the full line-item list from this purchase invoice photo. ' +
  'Return the result strictly matching the provided JSON schema.';

export interface InvoiceOcrInvocationContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  userId: string | null;
}

export interface InvoiceOcrInput {
  /**
   * Raw base64-encoded image bytes WITHOUT the `data:image/...;base64,`
   * prefix. The tRPC schema strips the prefix client-side; the service
   * is strict about the payload shape so the byte-size budget check
   * stays predictable.
   */
  imageBase64: string;
  mimeType: InvoiceOcrMimeType;
}

export interface InvoiceOcrResult {
  invoice: InvoiceOcr;
  costUsd: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  provider: AIProvider['id'];
  model: string;
  auditLogId: string;
}

export type VisionProviderFactory = (id: AIProvider['id'] | null) => AIProvider;

// Vision-specific factory: returns the configured provider AS-IS so the
// downstream `visionModel` capability check can surface
// `AI_VISION_NOT_AVAILABLE` for stubs (Ollama today) instead of the
// generic `AI_PROVIDER_ERROR` that `defaultFactory` in client.ts emits.
const defaultVisionFactory: VisionProviderFactory = id => getProvider(id);

function decodedByteLength(base64: string): number {
  // RFC 4648 base64 inflates input by 4/3. Strip padding to compute the
  // raw byte count without allocating a Buffer.
  const stripped = base64.replace(/=+$/, '').length;
  return Math.floor((stripped * 3) / 4);
}

/**
 * Run an invoice OCR pass against the tenant's configured vision
 * provider. Throws via `throwServerError` for every gating failure
 * (`AI_DISABLED`, `AI_BUDGET_EXCEEDED`, `AI_PROVIDER_ERROR`,
 * `AI_VISION_NOT_AVAILABLE`, `AI_VISION_IMAGE_TOO_LARGE`,
 * `AI_VISION_PARSE_FAILED`); successful calls return the structured
 * invoice plus the audit-log row id.
 */
export async function extractInvoiceFromImage(
  ctx: InvoiceOcrInvocationContext,
  input: InvoiceOcrInput,
  factory: VisionProviderFactory = defaultVisionFactory
): Promise<InvoiceOcrResult> {
  if (input.imageBase64.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VISION_IMAGE_TOO_LARGE',
      message: 'Invoice image payload is empty',
    });
  }

  const rawBytes = decodedByteLength(input.imageBase64);
  if (rawBytes > INVOICE_OCR_MAX_BYTES) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VISION_IMAGE_TOO_LARGE',
      message: `Invoice image exceeds the ${INVOICE_OCR_MAX_BYTES / (1024 * 1024)} MB limit`,
      details: { rawBytes, limitBytes: INVOICE_OCR_MAX_BYTES },
    });
  }

  const settings = await resolveAISettings(ctx.db, ctx.tenantId);
  if (!settings.enabled) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_DISABLED',
      message: 'AI features are disabled for this tenant',
    });
  }

  // Capability check FIRST so an Ollama (or other stub) tenant gets
  // the documented AI_VISION_NOT_AVAILABLE rather than a generic
  // configured-or-not signal.
  const provider = factory(settings.providerId);
  if (typeof provider.visionModel !== 'function') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VISION_NOT_AVAILABLE',
      message: `Provider ${provider.id} does not support vision input`,
    });
  }

  if (!provider.isConfigured()) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_PROVIDER_ERROR',
      message: `Provider ${provider.id} is not configured (set the API key env var)`,
    });
  }

  if (settings.monthlyBudgetUsd <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_BUDGET_EXCEEDED',
      message: 'AI monthly budget is zero',
    });
  }

  const spent = await currentMonthSpend(ctx.db, ctx.tenantId);
  if (spent >= settings.monthlyBudgetUsd) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_BUDGET_EXCEEDED',
      message: `AI monthly budget exhausted ($${spent.toFixed(4)} of $${settings.monthlyBudgetUsd.toFixed(2)})`,
    });
  }

  const modelId = settings.modelId ?? provider.defaultModelId;
  const startedAt = Date.now();
  const providerOptions = provider.cacheControlForSystemPrompt();

  try {
    const result = await generateObject({
      model: provider.visionModel(modelId),
      system: EXTRACT_PROMPT_SYSTEM,
      schema: InvoiceOcrSchema,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: EXTRACT_PROMPT_USER },
            {
              type: 'image',
              image: input.imageBase64,
              mediaType: input.mimeType,
            },
          ],
        },
      ],
      ...(providerOptions !== undefined
        ? { providerOptions: providerOptions as ProviderOptions }
        : {}),
    });

    const billable = toBillableTokenUsage(result.usage);
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    const cacheReadTokens = result.usage.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWriteTokens = result.usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    const costUsd = provider.pricing.calculateCostUsd(modelId, billable);
    const durationMs = Date.now() - startedAt;

    const { id: auditLogId } = await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: 'invoiceOcr',
      providerId: provider.id,
      modelId,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
      durationMs,
      errorCode: null,
    });

    return {
      invoice: result.object,
      costUsd,
      durationMs,
      inputTokens,
      outputTokens,
      provider: provider.id,
      model: modelId,
      auditLogId,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : 'Vision provider call failed';
    // Identify schema-validation failures by SDK error class rather
    // than substring matching, which would misclassify provider HTTP
    // 4xx bodies containing the words "validation" / "parse" / etc as
    // parse failures and tell the operator to retake the photo when
    // the real cause is an API-key issue. NoObjectGeneratedError +
    // TypeValidationError + JSONParseError cover the three SDK paths
    // that surface a malformed model response; ZodError covers Zod
    // refinements run inside the schema.
    const isSchemaFailure =
      NoObjectGeneratedError.isInstance(error) ||
      error instanceof TypeValidationError ||
      error instanceof JSONParseError ||
      error instanceof z.ZodError ||
      // Fallback for SDK versions that surface a schema failure as a
      // plain Error wrapping one of the above by toString. Narrow to
      // exact phrasings so transport errors do not get misclassified.
      (error instanceof Error &&
        /No object generated/i.test(error.message));

    const errorCode = isSchemaFailure
      ? 'AI_VISION_PARSE_FAILED'
      : 'AI_PROVIDER_ERROR';

    await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: 'invoiceOcr',
      providerId: provider.id,
      modelId,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      durationMs,
      errorCode,
    });

    throwServerError({
      trpcCode: isSchemaFailure ? 'BAD_REQUEST' : 'BAD_GATEWAY',
      errorCode,
      message,
      details: { cause: String(error) },
    });
  }
}
