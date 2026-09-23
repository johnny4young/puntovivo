/** Tenant-wide admission and audit settlement for the paid Textract OCR route. */
import type { DatabaseInstance } from '../../../db/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { reserveAiBudget, settleAiBudget } from '../budget.js';
import { assertSinglePagePdf } from './pdf-preflight.js';
import { extractInvoiceWithTextract, resolveTextractPriceConfig } from './textract.js';
import type { TextractInvoiceOcrInput } from './textract.js';

export interface TextractAdmissionContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  userId: string;
  abortSignal?: AbortSignal | undefined;
}

export async function extractInvoiceWithAdmission(
  ctx: TextractAdmissionContext,
  input: Pick<TextractInvoiceOcrInput, 'documentBase64' | 'mimeType'>
) {
  if (
    input.mimeType !== 'image/jpeg' &&
    input.mimeType !== 'image/png' &&
    input.mimeType !== 'application/pdf'
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VISION_NOT_AVAILABLE',
      message: 'Textract accepts JPEG, PNG, and single-page PDF invoices',
    });
  }
  const abortSignal = ctx.abortSignal
    ? AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000);
  abortSignal.throwIfAborted();
  if (input.mimeType === 'application/pdf') {
    await assertSinglePagePdf(input.documentBase64, abortSignal);
  }
  // A missing or stale regional page price blocks the paid request before it
  // occupies the tenant's budget reservation.
  const price = resolveTextractPriceConfig();
  abortSignal.throwIfAborted();
  const reservation = reserveAiBudget(ctx.db, ctx.tenantId, new Date(), {
    invoiceOcrSiteId: ctx.siteId,
    minimumKnownCostUsd: price.usdPerPage,
  });
  const startedAt = Date.now();
  const settle = (
    costUsd: number,
    costState: 'estimated' | 'unknown',
    errorCode: 'AI_PROVIDER_ERROR' | null,
    durationMs: number
  ) =>
    settleAiBudget(
      ctx.db,
      reservation,
      {
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        userId: ctx.userId,
        feature: 'invoiceOcr',
        providerId: 'textract',
        modelId: 'aws-textract-analyze-expense',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd,
        costState,
        durationMs,
        errorCode,
      },
      costState === 'unknown'
    );

  let result: Awaited<ReturnType<typeof extractInvoiceWithTextract>>;
  try {
    result = await extractInvoiceWithTextract({ ...input, ...price, abortSignal });
  } catch {
    // AWS may have billed before the response was lost or cancelled. A
    // missing response cannot be safely treated as a free retry.
    settle(0, 'unknown', 'AI_PROVIDER_ERROR', Date.now() - startedAt);
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'Textract invoice extraction failed; billing requires reconciliation',
    });
  }
  if (!Number.isFinite(result.costUsd) || result.costUsd <= 0) {
    settle(0, 'unknown', 'AI_PROVIDER_ERROR', result.durationMs);
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'Textract returned an unpriceable page count',
    });
  }
  const { id: auditLogId } = settle(result.costUsd, 'estimated', null, result.durationMs);
  return { result, auditLogId };
}
