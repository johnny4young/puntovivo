import type { TFunction } from 'i18next';
import serverErrorNamespaces from '../i18n/server-error-namespaces.json';

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
  'AUTH_STAFF_PIN_INVALID',
  'AUTH_REFRESH_INVALID',
  'AUTH_USER_NOT_FOUND',
  'AUTH_CURRENT_PASSWORD_INCORRECT',
  'AUTH_PASSWORD_POLICY',
  'EMPLOYEE_SHIFT_ALREADY_CLOCKED_IN',
  'EMPLOYEE_SHIFT_NOT_CLOCKED_IN',
  'EMPLOYEE_SHIFT_SITE_INACTIVE',
  'EMPLOYEE_SHIFT_PERSIST_FAILED',
  'EMPLOYEE_SHIFT_CASH_SESSION_OPEN',
  // explicit breaks and manager attendance detail.
  'EMPLOYEE_SHIFT_BREAK_ALREADY_ACTIVE',
  'EMPLOYEE_SHIFT_BREAK_NOT_ACTIVE',
  'EMPLOYEE_SHIFT_BREAK_ACTIVE',
  'EMPLOYEE_SHIFT_BREAK_PERSIST_FAILED',
  'EMPLOYEE_SHIFT_ATTENDANCE_RANGE_INVALID',
  'EMPLOYEE_SHIFT_ATTENDANCE_EMPLOYEE_NOT_FOUND',
  'EMPLOYEE_SHIFT_ATTENDANCE_SITE_NOT_FOUND',
  'EMPLOYEE_SHIFT_CORRECTION_NOT_FOUND',
  'EMPLOYEE_SHIFT_CORRECTION_ACTIVE',
  'EMPLOYEE_SHIFT_CORRECTION_WINDOW_INVALID',
  'EMPLOYEE_SHIFT_CORRECTION_BREAKS_INVALID',
  'EMPLOYEE_SHIFT_CORRECTION_PERSIST_FAILED',
  // manager-authored team schedules.
  'SCHEDULE_DATE_RANGE_INVALID',
  'SCHEDULE_WINDOW_INVALID',
  'SCHEDULE_EMPLOYEE_NOT_FOUND',
  'SCHEDULE_SITE_NOT_FOUND',
  'SCHEDULE_SHIFT_NOT_FOUND',
  'SCHEDULE_SHIFT_OVERLAP',
  'SCHEDULE_SHIFT_CANCELLED',
  'MANAGER_APPROVAL_NOT_FOUND',
  'MANAGER_APPROVAL_NOT_PENDING',
  'MANAGER_APPROVAL_EXPIRED',
  'MANAGER_APPROVAL_PIN_INVALID',
  'MANAGER_APPROVAL_SITE_REQUIRED',
  'MANAGER_APPROVAL_REQUIRED',
  'MANAGER_APPROVAL_MISMATCH',
  'MANAGER_APPROVAL_UNAVAILABLE',
  'LOSS_PREVENTION_ALERT_NOT_FOUND',
  'CASH_SESSION_REQUIRED',
  'CASH_SESSION_SITE_REQUIRED',
  'CASH_SESSION_ALREADY_OPEN_FOR_CASHIER',
  'CASH_SESSION_ALREADY_OPEN_FOR_REGISTER',
  'CASH_SESSION_SHIFT_SITE_MISMATCH',
  'CASH_SESSION_EMPLOYEE_BREAK_ACTIVE',
  'CASH_SESSION_OPENING_FLOAT_MISMATCH',
  'CASH_SESSION_OPENING_FLOAT_INVALID',
  'CASH_SESSION_COUNT_MISMATCH',
  'CASH_SESSION_COUNT_INVALID',
  'CASH_SESSION_NOT_FOUND',
  'CASH_SESSION_NOT_CLOSED',
  'CASH_SESSION_LOAD_FAILED',
  'DAY_CLOSE_FUTURE_DATE',
  'DAY_CLOSE_ALREADY_SIGNED',
  'DAY_CLOSE_NOT_READY',
  'DAY_CLOSE_SIGNOFF_INTEGRITY_FAILED',
  'CASH_MOVEMENT_INVALID_AMOUNT',
  'CASH_MOVEMENT_UNSUPPORTED_TYPE',
  'CASH_MOVEMENT_PERSIST_FAILED',
  // fraction policy errors.
  'PRODUCT_FRACTION_STEP_REQUIRED',
  'PRODUCT_FRACTION_MINIMUM_REQUIRED',
  'PRODUCT_FRACTION_MINIMUM_BELOW_STEP',
  'PRODUCT_FRACTION_MINIMUM_NOT_ALIGNED',
  'PRODUCT_LOT_TRACKING_REQUIRES_ZERO_STOCK',
  'PRODUCT_LOT_TRACKING_STOCK_MANAGED',
  'PRODUCT_LOT_TRACKING_REQUIRED',
  'PRODUCT_LOT_TRACKING_HAS_ACTIVE_LOTS',
  'PRODUCT_SERIAL_TRACKING_REQUIRES_ZERO_STOCK',
  'PRODUCT_SERIAL_TRACKING_STOCK_MANAGED',
  'PRODUCT_SERIAL_TRACKING_REQUIRED',
  'PRODUCT_SERIAL_TRACKING_HAS_SERIALS',
  'PRODUCT_SERIAL_PRODUCT_NOT_FOUND',
  'PRODUCT_SERIAL_TRACKING_CONFLICT',
  'PRODUCT_SERVICE_TRACKING_CONFLICT',
  'PRODUCT_SERVICE_REQUIRES_ZERO_STOCK',
  'PRODUCT_SERVICE_STOCK_NOT_TRACKED',
  'PRODUCT_SERIAL_UNIT_EQUIVALENCE_REQUIRED',
  'PRODUCT_SERIAL_DUPLICATE',
  'PRODUCT_SERIAL_QUANTITY_WHOLE_REQUIRED',
  'PRODUCT_SERIAL_SELECTION_REQUIRED',
  'PRODUCT_SERIAL_UNAVAILABLE',
  'PRODUCT_SERIAL_SALE_STATUS_INVALID',
  'PRODUCT_SERIAL_SELECTION_NOT_ALLOWED',
  'PRODUCT_SERIAL_VARIANT_PARENT_UNSUPPORTED',
  'PRODUCT_VARIANT_PARENT_REQUIRES_ZERO_STOCK',
  'PRODUCT_VARIANT_PARENT_NOT_FOUND',
  'PRODUCT_VARIANT_PARENT_HAS_HISTORY',
  'PRODUCT_VARIANT_MATRIX_EXISTS',
  'PRODUCT_VARIANT_SKU_CONFLICT',
  'PRODUCT_VARIANT_PARENT_NOT_SELLABLE',
  'INVENTORY_ADJUSTMENT_SITE_STOCK_INSUFFICIENT',
  'INVENTORY_MANUAL_MOVEMENT_TYPE_RESERVED',
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
  // variance reporting on `transfers.receive`.
  'TRANSFER_RECEIVED_EXCEEDS_SHIPPED',
  'TRANSFER_RECEIVE_LINE_MISMATCH',
  // quotations.
  'QUOTATION_NOT_FOUND',
  'QUOTATION_ITEMS_REQUIRED',
  'QUOTATION_PRODUCT_NOT_FOUND',
  'QUOTATION_CUSTOMER_NOT_FOUND',
  'QUOTATION_SITE_NOT_FOUND',
  'QUOTATION_QUANTITY_INVALID',
  'QUOTATION_INVALID_STATUS_TRANSITION',
  'QUOTATION_DELETE_NOT_DRAFT',
  'QUOTATION_SEQUENTIAL_MISSING',
  'QUOTATION_BASE_UNIT_MISSING',
  'QUOTATION_ALREADY_CONVERTED',
  'QUOTATION_NOT_ACCEPTED',
  'QUOTATION_EXPIRED',
  'QUOTATION_SITE_MISMATCH',
  'QUOTATION_UNIT_SNAPSHOT_MISSING',
  'QUOTATION_CONVERSION_MISMATCH',
  'PROVIDER_HAS_PAYABLE_HISTORY',
  'PROVIDER_PAYABLE_SITE_REQUIRED',
  'PROVIDER_PAYABLE_PROVIDER_NOT_FOUND',
  'PROVIDER_PAYABLE_DOCUMENT_DUPLICATE',
  'PROVIDER_PAYABLE_PURCHASE_MISMATCH',
  'PROVIDER_PAYABLE_PURCHASE_ALREADY_INVOICED',
  'PROVIDER_PAYABLE_PURCHASE_NOT_COMPLETED',
  'PROVIDER_PAYABLE_ALLOCATION_TOTAL_MISMATCH',
  'PROVIDER_PAYABLE_ALLOCATION_DUPLICATE',
  'PROVIDER_PAYABLE_INVOICE_NOT_FOUND',
  'PROVIDER_PAYABLE_ALLOCATION_EXCEEDS_OUTSTANDING',
  // Iter 2: receipt templates.
  'RECEIPT_TEMPLATE_NOT_FOUND',
  'RECEIPT_TEMPLATE_NAME_REQUIRED',
  'RECEIPT_TEMPLATE_LAST_FOR_KIND',
  'RECEIPT_TEMPLATE_NAME_DUPLICATE',
  'RECEIPT_TEMPLATE_PERSIST_FAILED',
  // Sales domain — added together with  +  while sweeping
  // sales.ts. Every entry here needs a matching translation in
  // errors.json under `server.<CODE>` in both locales, and the server
  // throw path must use throwServerError() (not raw new TRPCError) so
  // the errorCode flows through the tRPC error formatter into
  // `error.data.errorCode`.
  'SALE_NOT_FOUND',
  'DOCUMENT_SEQUENTIAL_CHANGED',
  'SALE_QUANTITY_NONPOSITIVE',
  'SALE_SEQUENTIAL_MISSING',
  'PURCHASE_SEQUENTIAL_MISSING',
  'ORDER_SEQUENTIAL_MISSING',
  'SALE_CUSTOMER_INVALID',
  'SALE_PRODUCT_INVALID',
  'SALE_UNIT_INVALID',
  'TAX_RATE_KIND_INVALID',
  'TAX_COMPONENTS_INVALID',
  'TAX_COMPONENTS_UNREPRESENTABLE',
  'SALE_INSUFFICIENT_STOCK',
  'LOT_QUANTITY_INVALID',
  'LOT_COST_INVALID',
  'LOT_PRODUCT_NOT_FOUND',
  'LOT_STOCK_INCONSISTENT',
  // ---  expiry radar ---
  'LOT_NOT_FOUND',
  'LOT_DISCOUNT_NOT_ELIGIBLE',
  'LOT_DISCOUNT_ALREADY_ACTIVE',
  'PRICE_SUGGESTION_NOT_FOUND',
  // ---  loyalty ---
  'LOYALTY_CUSTOMER_NOT_FOUND',
  'LOYALTY_INSUFFICIENT_POINTS',
  'SALE_DISCOUNT_EXCEEDS_TOTAL',
  'SALE_AMOUNT_RECEIVED_BELOW_TOTAL',
  'SALE_UPDATE_VOIDED_FORBIDDEN',
  'SALE_PAYMENT_STATUS_RETURN_MANAGED',
  'SALE_VOID_ALREADY_VOIDED',
  'SALE_VOID_REFUNDED_FORBIDDEN',
  'SALE_VOID_NOT_COMPLETED',
  'SALE_WITHOUT_ITEMS',
  'SALE_RETURN_VOIDED_FORBIDDEN',
  'SALE_RETURN_NOT_COMPLETED',
  'SALE_RETURN_ALREADY_REFUNDED',
  'SALE_RETURN_DUPLICATE',
  'SALE_RETURN_LINE_NOT_FOUND',
  'SALE_RETURN_LINE_DUPLICATE',
  'SALE_RETURN_QUANTITY_EXCEEDS_AVAILABLE',
  'SALE_RETURN_NOTHING_AVAILABLE',
  'SALE_RETURN_LOT_DUPLICATE',
  'SALE_RETURN_LOT_QUANTITY_EXCEEDS_AVAILABLE',
  'SALE_RETURN_LOT_ALLOCATION_MISMATCH',
  'SALE_RETURN_LOT_NOT_FOUND',
  'SALE_RETURN_LOT_CHANGED',
  'SALE_RETURN_LOT_TRACKING_CHANGED',
  'SALE_RETURN_SERIAL_QUANTITY_INVALID',
  'SALE_RETURN_SERIAL_SELECTION_MISMATCH',
  'SALE_RETURN_SERIAL_TRACKING_CHANGED',
  'SALE_RETURN_EXTERNAL_REFERENCE_REQUIRED',
  'SALE_RETURN_PAYMENT_ALLOCATION_MISMATCH',
  'SALE_RETURN_TAX_COMPONENT_MISMATCH',
  'SALE_RETURN_CUSTOMER_REQUIRED',
  'SALE_RETURN_SITE_REQUIRED',
  'SALE_RETURN_SITE_MISMATCH',
  'SALE_RETURN_CHANGED',
  'STORE_CREDIT_AMOUNT_INVALID',
  'STORE_CREDIT_BALANCE_CHANGED',
  'SALE_EXCHANGE_RETURN_NOT_FOUND',
  'SALE_EXCHANGE_ALREADY_LINKED',
  'SALE_EXCHANGE_CUSTOMER_MISMATCH',
  'SALE_REVERSAL_PRODUCT_MISSING',
  'SALE_DRAFT_REQUIRED',
  'SALE_NOT_SUSPENDED',
  'SALE_SUSPEND_OWNERSHIP_REQUIRED',
  'SALE_PRICE_TIER_MISMATCH',
  'SALE_REPRINT_DRAFT_FORBIDDEN',
  'SALE_REPRINT_ACTIVE_SESSION_REQUIRED',
  'SALE_COMPLETE_DRAFT_SUSPENDED',
  'SALE_CHANGE_TABLE_INVALID_STATUS',
  'SALE_SERVICE_CHARGE_DISABLED',
  'SALE_SERVICE_CHARGE_DRIFT',
  'SALE_SPLIT_INVALID_STATUS',
  'SALE_SPLIT_NO_ITEMS_SELECTED',
  'SALE_SPLIT_ITEMS_NOT_FOUND',
  // ---  sync resolve TOCTOU close-out ---
  'SYNC_LOCAL_RECORD_MISSING',
  'SYNC_REMOTE_APPLY_BLOCKED',
  // ---  multi-country fiscal packs ---
  'FISCAL_PACK_NOT_AVAILABLE',
  // ---  pack México fundación ---
  'FISCAL_RFC_INVALID',
  'FISCAL_REGIMEN_INVALID',
  // ---  pack Chile fundación ---
  'FISCAL_RUT_INVALID',
  // ---  pack Colombia config card ---
  'FISCAL_NIT_INVALID',
  'FISCAL_NUMBERING_RANGE_INVALID',
  // --- Fiscal document recovery ---
  'FISCAL_RETURN_SNAPSHOT_UNKNOWN',
  'FISCAL_DOCUMENT_NOT_FOUND',
  'FISCAL_TAX_TOTAL_MISMATCH',
  // ---  AI foundation ---
  'AI_DISABLED',
  'AI_BUDGET_EXCEEDED',
  'AI_PROVIDER_ERROR',
  'AI_COPILOT_SQL_REJECTED',
  'AI_COPILOT_QUERY_LIMIT_EXCEEDED',
  // ---  AI Wave 2 vision ---
  'AI_VISION_NOT_AVAILABLE',
  'AI_VISION_PARSE_FAILED',
  'AI_VISION_IMAGE_TOO_LARGE',
  // ---  slice 1 AI Wave 2 voice ---
  'AI_VOICE_NOT_AVAILABLE',
  'AI_VOICE_PARSE_FAILED',
  'AI_VOICE_AUDIO_TOO_LARGE',
  // ---  slice 3 voice cart commands ---
  'AI_VOICE_COMMAND_UNRECOGNIZED',
  // ---  device registry + command envelope ---
  'DEVICE_NOT_REGISTERED',
  // ---  Authority Node pairing + health ---
  'AUTHORITY_SITE_NOT_FOUND',
  'AUTHORITY_PAIRING_CODE_INVALID',
  'AUTHORITY_PAIRING_CODE_EXPIRED',
  'AUTHORITY_PAIRING_CODE_USED',
  'AUTHORITY_DEVICE_NOT_REVOKABLE',
  'DEVICE_PAIRING_CODE_ALLOCATION_EXHAUSTED',
  'MISSING_COMMAND_ENVELOPE',
  'IDEMPOTENCY_KEY_CONFLICT',
  'COMMAND_IN_PROGRESS',
  'COMMAND_DATABASE_BUSY',
  // ---  peripheral registry ---
  'PERIPHERAL_NOT_FOUND',
  'PERIPHERAL_DRIVER_INVALID',
  'PERIPHERAL_CONFIG_INVALID',
  'PERIPHERAL_ACTIVE_DUPLICATE',
  'HARDWARE_SALE_NOT_FOUND',
  'HARDWARE_NO_DRAWER_REGISTERED',
  'HARDWARE_TRANSPORT_FAILED',
  'HARDWARE_OUTBOX_NOT_FOUND',
  // ---  module activation kernel ---
  'MODULE_NOT_ACTIVATED',
  'MODULE_NOT_AVAILABLE',
  'MODULE_UNKNOWN',
  // ---  Chile DTE CAF ---
  'CAF_NOT_AVAILABLE',
  'CAF_EXHAUSTED',
  // ---  payment reconciliation matcher ---
  'PAYMENT_CREDENTIAL_UNKNOWN_FIELD',
  'PAYMENT_RECONCILIATION_NO_MATCH',
  'PAYMENT_RECONCILIATION_AMBIGUOUS',
  'PAYMENT_RECONCILIATION_AI_DEGRADED',
  // ---  Operations Center payment admin actions ---
  'PAYMENT_OUTBOX_NOT_FOUND',
  'PAYMENT_OUTBOX_NOT_RETRIABLE',
  // ---  sync contract v1 ---
  'SYNC_OUTBOX_NOT_FOUND',
  'SYNC_OUTBOX_DEAD_LETTER',
  // ---  restaurant table catalog ---
  'RESTAURANT_TABLE_NOT_FOUND',
  'RESTAURANT_TABLE_NAME_DUPLICATE',
  // --- kitchen display () ---
  'KDS_ORDER_NOT_FOUND',
  'KDS_ORDER_NOT_READY',
  // ---  credit sales ---
  'CREDIT_LIMIT_EXCEEDED',
  'CREDIT_SALE_CUSTOMER_REQUIRED',
  'CREDIT_OVERRIDE_FORBIDDEN',
  'CREDIT_SALE_FORBIDDEN',
  // ---  split-credit refund guard ---
  'REFUND_PARTIAL_CREDIT_NOT_SUPPORTED',
  // ---  per-site AI monthly quotas ---
  'AI_QUOTA_EXCEEDED',
  // ---  error wrapping cleanup ---
  'FISCAL_SEQUENTIAL_NOT_ADVANCED',
  'CREDIT_LEDGER_INVALID_AMOUNT',
  // ---  optimistic concurrency ---
  'STALE_VERSION',
] as const;

export type KnownServerErrorCode = (typeof KNOWN_SERVER_ERROR_CODES)[number];

const KNOWN_SET: ReadonlySet<string> = new Set(KNOWN_SERVER_ERROR_CODES);

/**
 * Domain copy that is irrelevant before entering its route is kept outside
 * bootstrap chrome. Quotation/payables and return/store-credit errors load
 * with their owning surfaces, while stable server codes still resolve through
 * this one translation boundary.
 */
function serverErrorTranslationKeys(code: KnownServerErrorCode): readonly string[] {
  const route = serverErrorNamespaces.routes.find(candidate =>
    candidate.prefixes.some(prefix => code.startsWith(prefix))
  );
  const primaryNamespace = route?.namespace ?? serverErrorNamespaces.defaultNamespace;

  if (primaryNamespace === serverErrorNamespaces.defaultNamespace) {
    return [`${primaryNamespace}:server.${code}`] as const;
  }

  // Keep a bootstrap fallback during rolling upgrades where the renderer and
  // locale chunks can momentarily come from different cached app versions.
  return [
    `${primaryNamespace}:server.${code}`,
    `${serverErrorNamespaces.defaultNamespace}:server.${code}`,
  ] as const;
}
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

/**
 * The structured values the server attaches beside the error code, under
 * `data.errorDetails`.
 *
 * Three server codes carry copy with placeholders — the product name, the
 * available quantity and the requested one. Without these the translation
 * renders the raw `{{productName}}` template at the counter, which is what
 * this exists to prevent. The candidate shapes mirror `extractServerErrorCode`
 * so both survive the same tRPC client and serialization variations.
 */
/** True when interpolation left a `{{var}}` behind. */
function hasPlaceholder(value: string): boolean {
  return /\{\{\s*\w+\s*\}\}/.test(value);
}

export function extractServerErrorDetails(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const candidates: unknown[] = [];
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === 'object') {
    candidates.push((data as { errorDetails?: unknown }).errorDetails);
  }
  const shape = (error as { shape?: { data?: { errorDetails?: unknown } } }).shape;
  if (shape?.data) {
    candidates.push(shape.data.errorDetails);
  }
  candidates.push((error as { errorDetails?: unknown }).errorDetails);

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return undefined;
}

function collectErrorMessages(error: unknown, messages: string[] = []): string[] {
  if (!error || typeof error !== 'object') {
    return messages;
  }

  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
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
 * tRPC marks unexpected server faults with INTERNAL_SERVER_ERROR. Those
 * messages may contain SQLite SQL, table names, file paths, or stack details,
 * so only a stable translated errorCode is allowed to escape that boundary.
 */
function isInternalTransportError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const directCode = (error as { data?: { code?: unknown } }).data?.code;
  const shapedCode = (error as { shape?: { data?: { code?: unknown } } }).shape?.data?.code;
  return directCode === 'INTERNAL_SERVER_ERROR' || shapedCode === 'INTERNAL_SERVER_ERROR';
}

/**
 * A tRPC input-validation failure surfaces the raw Zod issues array as the
 * error message (a JSON-encoded `[{ code, path, message, ... }]`). Rendering
 * that verbatim to a non-technical operator is gibberish, so detect the shape
 * and let the caller swap in a localized "check the fields" message.
 *
 * Matches BOTH signals so a legitimate human message that merely begins with
 * "[" is never misclassified:
 * - the tRPC error data carries `code: 'BAD_REQUEST'`, AND/OR
 * - the message parses as a JSON array whose entries look like Zod issues
 * (objects carrying a `code` and a `path`).
 */
export function isZodValidationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const data = (error as { data?: { code?: unknown; zodError?: unknown } }).data;

  // Strongest signal first: the server's errorFormatter attaches the
  // flattened ZodError as `data.zodError` on every Zod-caused BAD_REQUEST
  // (packages/server/src/trpc/init.ts). This survives any future change to
  // how tRPC serializes the cause into `message`.
  if (data && typeof data === 'object' && data.zodError != null) {
    return true;
  }

  const isBadRequest = !!data && typeof data === 'object' && data.code === 'BAD_REQUEST';

  for (const message of collectErrorMessages(error)) {
    const trimmed = message.trim();
    if (!trimmed.startsWith('[')) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every(
          issue => !!issue && typeof issue === 'object' && 'code' in issue && 'path' in issue
        )
      ) {
        return true;
      }
    } catch {
      // Not JSON — a normal message that happens to start with "[".
    }
  }

  // The data shape alone is enough when the message was already consumed
  // (e.g. an empty-message BAD_REQUEST from a downstream formatter).
  return isBadRequest && collectErrorMessages(error).length === 0;
}

export type DesktopIpcSessionErrorCode = 'SESSION_NOT_REGISTERED' | 'SESSION_ROLE_FORBIDDEN';

/** Extract only our exact preload error or Electron's legacy wrapper, never quoted data. */
export function extractDesktopIpcSessionErrorCode(
  error: unknown
): DesktopIpcSessionErrorCode | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'SESSION_NOT_REGISTERED' || error.message === 'SESSION_ROLE_FORBIDDEN') {
    return error.message;
  }
  const match =
    /^Error invoking remote method '[^']+': Error: (SESSION_NOT_REGISTERED|SESSION_ROLE_FORBIDDEN)(?:$|\s)/.exec(
      error.message
    );
  return (match?.[1] as DesktopIpcSessionErrorCode | undefined) ?? null;
}

/**
 * Translate a server error into a localized user-facing message.
 *
 * Resolution order:
 * 1. Stable `errorCode` → its route-scoped or bootstrap translation key
 * 2. The server's English `message` field (if present and non-empty)
 * 3. The supplied fallback (typically `t('errors:server.unknown')`)
 *
 * This guarantees every error reaches the user in the active locale when the
 * server has been converted to the code-based pattern, while still showing
 * the English server message for endpoints that have not been migrated yet.
 *
 * @param error - The tRPC client error (or any error-shaped object)
 * @param t - The i18next translation function (must be bound to a namespace
 * list that includes `errors`, e.g. `useTranslation(['errors', ...])`)
 * @param fallback - Last-resort message when neither code nor message is available
 */
export function translateServerError(error: unknown, t: TFunction, fallback: string): string {
  const code = extractServerErrorCode(error);
  if (code) {
    // Force-resolve from the `errors` namespace regardless of the caller's
    // default namespace, and hand i18next the server's structured details so
    // copy carrying placeholders renders values instead of the raw template.
    // A command already owned by another request and a transient SQLite writer
    // lock deliberately carry the same safe operator action, while retaining
    // distinct keys so the canonical server-code/i18n parity remains exact.
    for (const translationKey of serverErrorTranslationKeys(code)) {
      const translated = t(translationKey, extractServerErrorDetails(error) ?? {});
      // An unresolved placeholder means the server omitted a value the copy
      // needs. Showing "{{productName}}" to a cashier is worse than falling
      // through to the server's English sentence, so treat it as untranslated.
      if (
        typeof translated === 'string' &&
        translated !== translationKey &&
        !hasPlaceholder(translated)
      ) {
        return translated;
      }
    }
  }

  if (isNetworkConnectivityError(error)) {
    const translationKey = 'errors:server.networkUnavailable';
    const translated = t(translationKey);
    if (typeof translated === 'string' && translated !== translationKey) {
      return translated;
    }
  }

  // Never leak a raw Zod issues array to the operator: a BAD_REQUEST whose
  // message is the stringified `[{ code, path, ... }]` becomes a single
  // localized "check the fields" line instead of developer JSON.
  if (isZodValidationError(error)) {
    const translationKey = 'errors:server.validationFailed';
    const translated = t(translationKey);
    if (typeof translated === 'string' && translated !== translationKey) {
      return translated;
    }
  }

  // Current preload reconstructs expected session rejections from the bounded
  // main/preload envelope as an exact code-only Error. Keep parsing the legacy
  // Electron invoke wrapper for compatibility, but never accept a message that
  // merely QUOTES the token. A missing session is fixed by signing in again; a
  // role rejection is not.
  const desktopSessionErrorCode = extractDesktopIpcSessionErrorCode(error);
  if (desktopSessionErrorCode) {
    const translationKey =
      desktopSessionErrorCode === 'SESSION_NOT_REGISTERED'
        ? 'errors:server.desktopSessionRequired'
        : 'errors:server.desktopRoleForbidden';
    const translated = t(translationKey);
    if (typeof translated === 'string' && translated !== translationKey) {
      return translated;
    }
  }

  // Expected domain failures must carry a stable errorCode and have already
  // returned above. Never render an unclassified INTERNAL_SERVER_ERROR: its
  // message is diagnostic evidence for logs, not operator-facing copy.
  if (isInternalTransportError(error)) {
    return fallback;
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
