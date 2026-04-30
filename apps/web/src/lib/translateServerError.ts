import type { TFunction } from 'i18next';

/**
 * The set of stable, machine-readable error codes the server attaches to
 * tRPC errors via `throwServerError`. Kept in sync with
 * `packages/server/src/lib/errorCodes.ts` — this list is intentionally
 * duplicated rather than imported so the web build stays decoupled from the
 * server package's runtime entry point.
 */
export const KNOWN_SERVER_ERROR_CODES = [
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_USER_DISABLED',
  'AUTH_TENANT_DISABLED',
  'AUTH_RATE_LIMIT_EXCEEDED',
  'AUTH_REFRESH_INVALID',
  'AUTH_USER_NOT_FOUND',
  'AUTH_CURRENT_PASSWORD_INCORRECT',
  'AUTH_PASSWORD_POLICY',
  'CASH_SESSION_REQUIRED',
  'CASH_SESSION_SITE_REQUIRED',
  'CASH_SESSION_ALREADY_OPEN_FOR_CASHIER',
  'CASH_SESSION_ALREADY_OPEN_FOR_REGISTER',
  'CASH_SESSION_OPENING_FLOAT_MISMATCH',
  'CASH_SESSION_OPENING_FLOAT_INVALID',
  'CASH_SESSION_COUNT_MISMATCH',
  'CASH_SESSION_COUNT_INVALID',
  // Phase 1 DB-050: fraction policy errors.
  'PRODUCT_FRACTION_STEP_REQUIRED',
  'PRODUCT_FRACTION_MINIMUM_REQUIRED',
  'PRODUCT_FRACTION_MINIMUM_BELOW_STEP',
  'PRODUCT_FRACTION_MINIMUM_NOT_ALIGNED',
  'SALE_QUANTITY_NOT_WHOLE',
  'SALE_QUANTITY_BELOW_MINIMUM',
  'SALE_QUANTITY_NOT_ALIGNED',
  'SALE_FRACTION_POLICY_MISSING',
  'SALE_QUANTITY_INVALID',
  'SALE_PAYMENTS_SUM_MISMATCH',
  'TRANSFER_SITES_IDENTICAL',
  'TRANSFER_SITE_NOT_FOUND',
  'TRANSFER_PRODUCT_NOT_FOUND',
  'TRANSFER_QUANTITY_INVALID',
  'TRANSFER_ITEMS_REQUIRED',
  'TRANSFER_INSUFFICIENT_STOCK',
  'TRANSFER_NOT_FOUND',
  'TRANSFER_ALREADY_VOID',
  'TRANSFER_VOID_INSUFFICIENT_STOCK',
  'TRANSFER_NOT_IN_TRANSIT',
  // Phase 2 UI-103: variance reporting on `transfers.receive`.
  'TRANSFER_RECEIVED_EXCEEDS_SHIPPED',
  'TRANSFER_RECEIVE_LINE_MISMATCH',
  // Phase 5 / Tier-2 #6: quotations.
  'QUOTATION_NOT_FOUND',
  'QUOTATION_ITEMS_REQUIRED',
  'QUOTATION_PRODUCT_NOT_FOUND',
  'QUOTATION_CUSTOMER_NOT_FOUND',
  'QUOTATION_SITE_NOT_FOUND',
  'QUOTATION_QUANTITY_INVALID',
  'QUOTATION_INVALID_STATUS_TRANSITION',
  'QUOTATION_DELETE_NOT_DRAFT',
  'QUOTATION_SEQUENTIAL_MISSING',
  // Iter 2: receipt templates.
  'RECEIPT_TEMPLATE_NOT_FOUND',
  'RECEIPT_TEMPLATE_NAME_REQUIRED',
  'RECEIPT_TEMPLATE_LAST_FOR_KIND',
  'RECEIPT_TEMPLATE_NAME_DUPLICATE',
  // Sales domain — added together with ENG-018 + ENG-019 while sweeping
  // sales.ts. Every entry here needs a matching translation in
  // errors.json under `server.<CODE>` in both locales, and the server
  // throw path must use throwServerError() (not raw new TRPCError) so
  // the errorCode flows through the tRPC error formatter into
  // `error.data.errorCode`.
  'SALE_NOT_FOUND',
  'SALE_QUANTITY_NONPOSITIVE',
  'SALE_SEQUENTIAL_MISSING',
  'SALE_CUSTOMER_INVALID',
  'SALE_PRODUCT_INVALID',
  'SALE_UNIT_INVALID',
  'SALE_INSUFFICIENT_STOCK',
  'SALE_DISCOUNT_EXCEEDS_TOTAL',
  'SALE_AMOUNT_RECEIVED_BELOW_TOTAL',
  'SALE_UPDATE_VOIDED_FORBIDDEN',
  'SALE_VOID_ALREADY_VOIDED',
  'SALE_VOID_REFUNDED_FORBIDDEN',
  'SALE_VOID_NOT_COMPLETED',
  'SALE_WITHOUT_ITEMS',
  'SALE_RETURN_VOIDED_FORBIDDEN',
  'SALE_RETURN_NOT_COMPLETED',
  'SALE_RETURN_ALREADY_REFUNDED',
  'SALE_RETURN_DUPLICATE',
  'SALE_REVERSAL_PRODUCT_MISSING',
  'SALE_DRAFT_REQUIRED',
  'SALE_NOT_SUSPENDED',
  'SALE_SUSPEND_OWNERSHIP_REQUIRED',
  'SALE_REPRINT_DRAFT_FORBIDDEN',
  'SALE_REPRINT_ACTIVE_SESSION_REQUIRED',
  'SALE_COMPLETE_DRAFT_SUSPENDED',
  // --- ENG-042 sync resolve TOCTOU close-out ---
  'SYNC_LOCAL_RECORD_MISSING',
  // --- ENG-030 AI foundation ---
  'AI_DISABLED',
  'AI_BUDGET_EXCEEDED',
  'AI_PROVIDER_ERROR',
] as const;

export type KnownServerErrorCode = (typeof KNOWN_SERVER_ERROR_CODES)[number];

const KNOWN_SET: ReadonlySet<string> = new Set(KNOWN_SERVER_ERROR_CODES);
const NETWORK_ERROR_MESSAGES = new Set([
  'failed to fetch',
  'fetch failed',
  'load failed',
  'networkerror when attempting to fetch resource.',
]);

/**
 * Best-effort extraction of the `errorCode` field that tRPC's error formatter
 * surfaces under `error.data.errorCode`. Walks both the error itself and the
 * common shapes that tRPC client errors take in different runtime contexts.
 */
export function extractServerErrorCode(error: unknown): KnownServerErrorCode | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidates: unknown[] = [];
  // tRPC v10/v11 client error: { data: { errorCode } }
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === 'object') {
    candidates.push((data as { errorCode?: unknown }).errorCode);
  }
  // Some serialized shapes: { shape: { data: { errorCode } } }
  const shape = (error as { shape?: { data?: { errorCode?: unknown } } }).shape;
  if (shape?.data) {
    candidates.push(shape.data.errorCode);
  }
  // Direct field (helpful for tests that build mock errors)
  candidates.push((error as { errorCode?: unknown }).errorCode);

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && KNOWN_SET.has(candidate)) {
      return candidate as KnownServerErrorCode;
    }
  }
  return null;
}

function collectErrorMessages(error: unknown, messages: string[] = []): string[] {
  if (!error || typeof error !== 'object') {
    return messages;
  }

  if (
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    messages.push((error as { message: string }).message);
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause && cause !== error) {
    collectErrorMessages(cause, messages);
  }

  return messages;
}

export function isNetworkConnectivityError(error: unknown): boolean {
  return collectErrorMessages(error).some(message => {
    const normalized = message.trim().toLowerCase();
    return (
      NETWORK_ERROR_MESSAGES.has(normalized) ||
      normalized.includes('failed to fetch') ||
      normalized.includes('fetch failed')
    );
  });
}

/**
 * Translate a server error into a localized user-facing message.
 *
 * Resolution order:
 *   1. Stable `errorCode` → `errors:server.<CODE>` translation key
 *   2. The server's English `message` field (if present and non-empty)
 *   3. The supplied fallback (typically `t('errors:server.unknown')`)
 *
 * This guarantees every error reaches the user in the active locale when the
 * server has been converted to the code-based pattern, while still showing
 * the English server message for endpoints that have not been migrated yet.
 *
 * @param error - The tRPC client error (or any error-shaped object)
 * @param t - The i18next translation function (must be bound to a namespace
 *   list that includes `errors`, e.g. `useTranslation(['errors', ...])`)
 * @param fallback - Last-resort message when neither code nor message is available
 */
export function translateServerError(
  error: unknown,
  t: TFunction,
  fallback: string
): string {
  const code = extractServerErrorCode(error);
  if (code) {
    // Force-resolve from the `errors` namespace regardless of the caller's
    // default namespace.
    const translationKey = `errors:server.${code}`;
    const translated = t(translationKey);
    if (typeof translated === 'string' && translated !== translationKey) {
      return translated;
    }
  }

  if (isNetworkConnectivityError(error)) {
    const translationKey = 'errors:server.networkUnavailable';
    const translated = t(translationKey);
    if (typeof translated === 'string' && translated !== translationKey) {
      return translated;
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string' &&
    (error as { message: string }).message.trim().length > 0
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
}
