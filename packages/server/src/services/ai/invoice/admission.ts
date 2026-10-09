/** Tenant-wide admission and audit settlement for the paid Textract OCR route. */
import type { DatabaseInstance } from '../../../db/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { reserveAiBudget } from '../budget.js';
import { settleCompletion } from '../client.js';
import { logProviderFailure } from '../provider-error.js';
import { NOT_BILLED_STATUSES, isDefinitiveProviderRejection } from '../provider-rejection.js';
import { extractInvoiceWithTextract, resolveTextractPriceConfig } from './textract.js';
import type { TextractInvoiceOcrInput } from './textract.js';
import { TEXTRACT_INVOICE_MIME_TYPES } from '../vision/invoice-ocr.js';

/**
 * AWS Textract exceptions that reject a request before any page is analyzed.
 * AWS bills only analyzed pages, so these release the admission hold. The
 * name alone is decisive: the SDK models `ThrottlingException` as a server
 * fault, yet a throttled request is never analyzed or billed.
 * `CredentialsProviderError` is raised locally before any request is signed.
 */
const TEXTRACT_NOT_BILLED_ERRORS = new Set([
  'ThrottlingException',
  'ProvisionedThroughputExceededException',
  'AccessDeniedException',
  'UnsupportedDocumentException',
  'BadDocumentException',
  'DocumentTooLargeException',
  'InvalidParameterException',
  'CredentialsProviderError',
]);

/** True when the Textract failure proves no page was analyzed or billed. */
export function isTextractRequestRejected(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const record = error as {
      name?: unknown;
      $fault?: unknown;
      $metadata?: { httpStatusCode?: unknown };
    };
    if (typeof record.name === 'string' && TEXTRACT_NOT_BILLED_ERRORS.has(record.name)) {
      return true;
    }
    // Unmodeled AWS client rejections (UnrecognizedClientException,
    // ExpiredTokenException, InvalidSignatureException, ...) carry the HTTP
    // status in $metadata rather than the statusCode the shared check reads.
    const status = record.$metadata?.httpStatusCode;
    if (record.$fault === 'client' && typeof status === 'number') {
      return NOT_BILLED_STATUSES.has(status);
    }
  }
  // A connection that was never established sent no document.
  return isDefinitiveProviderRejection(error);
}

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
  if (!(TEXTRACT_INVOICE_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VISION_NOT_AVAILABLE',
      message: 'Textract accepts JPEG, PNG, and single-page PDF invoices',
    });
  }
  // A missing or stale regional page price blocks the paid request before it
  // occupies the tenant's budget reservation.
  const price = resolveTextractPriceConfig();
  // The client signal is admission-only: it stops work before the budget is
  // reserved, but a dispatched Textract call runs to its own deadline and
  // settles its known page cost instead of becoming an unknown liability.
  ctx.abortSignal?.throwIfAborted();
  const reservation = reserveAiBudget(ctx.db, ctx.tenantId, new Date(), {
    invoiceOcrSiteId: ctx.siteId,
    minimumKnownCostUsd: price.usdPerPage,
  });
  const startedAt = Date.now();
  const settle = (
    costUsd: number,
    costState: 'estimated' | 'unknown' | 'not_incurred',
    errorCode: 'AI_PROVIDER_ERROR' | null,
    durationMs: number
  ) =>
    // Shared wrapper: a failed settlement is sanitized and logged, never a raw
    // persistence diagnostic, and the hold is kept for orphan recovery.
    settleCompletion(
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
    result = await extractInvoiceWithTextract({
      ...input,
      ...price,
      abortSignal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    logProviderFailure(error, {
      tenantId: ctx.tenantId,
      feature: 'invoiceOcr',
      providerId: 'textract',
      modelId: 'aws-textract-analyze-expense',
      errorCode: 'AI_PROVIDER_ERROR',
    });
    if (isTextractRequestRejected(error)) {
      // AWS rejected the request before analyzing a page: nothing was billed.
      settle(0, 'not_incurred', 'AI_PROVIDER_ERROR', Date.now() - startedAt);
      throwServerError({
        trpcCode: 'BAD_GATEWAY',
        errorCode: 'AI_PROVIDER_ERROR',
        message: 'Textract rejected the invoice request',
      });
    }
    // AWS may have billed before the response was lost or timed out. A
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
