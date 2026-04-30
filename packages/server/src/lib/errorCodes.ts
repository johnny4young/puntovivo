/**
 * Stable, machine-readable error codes that the server attaches to TRPCError
 * instances. The client maps these codes to localized messages so user-facing
 * error text never has to be kept in sync between the server and translation
 * files.
 *
 * Add new codes here as new domains are converted. Keep codes
 * SCREAMING_SNAKE_CASE and grouped by domain prefix.
 */
import { TRPCError, type TRPC_ERROR_CODE_KEY } from '@trpc/server';

export const SERVER_ERROR_CODES = {
  // --- auth domain ---
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_USER_DISABLED: 'AUTH_USER_DISABLED',
  AUTH_TENANT_DISABLED: 'AUTH_TENANT_DISABLED',
  AUTH_REFRESH_INVALID: 'AUTH_REFRESH_INVALID',
  AUTH_USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',
  AUTH_CURRENT_PASSWORD_INCORRECT: 'AUTH_CURRENT_PASSWORD_INCORRECT',
  AUTH_PASSWORD_POLICY: 'AUTH_PASSWORD_POLICY',
  /**
   * ENG-008 — the `auth.login` procedure refused the attempt because the
   * per-IP or per-username rate-limit bucket is saturated. `details` carries
   * `{ kind: 'ip' | 'username', key, max, secondsUntilReset }` so the
   * frontend can render a precise retry-after message.
   */
  AUTH_RATE_LIMIT_EXCEEDED: 'AUTH_RATE_LIMIT_EXCEEDED',

  // --- cash sessions domain (Phase 1 DB-051 / API-051 / API-055) ---
  CASH_SESSION_REQUIRED: 'CASH_SESSION_REQUIRED',
  CASH_SESSION_SITE_REQUIRED: 'CASH_SESSION_SITE_REQUIRED',
  CASH_SESSION_ALREADY_OPEN_FOR_CASHIER: 'CASH_SESSION_ALREADY_OPEN_FOR_CASHIER',
  CASH_SESSION_ALREADY_OPEN_FOR_REGISTER: 'CASH_SESSION_ALREADY_OPEN_FOR_REGISTER',
  CASH_SESSION_OPENING_FLOAT_MISMATCH: 'CASH_SESSION_OPENING_FLOAT_MISMATCH',
  CASH_SESSION_OPENING_FLOAT_INVALID: 'CASH_SESSION_OPENING_FLOAT_INVALID',
  CASH_SESSION_COUNT_MISMATCH: 'CASH_SESSION_COUNT_MISMATCH',
  CASH_SESSION_COUNT_INVALID: 'CASH_SESSION_COUNT_INVALID',

  // --- fraction policy domain (Phase 1 DB-050) ---
  /** Admin config: sellByFraction=true but fractionStep is missing / ≤ 0. */
  PRODUCT_FRACTION_STEP_REQUIRED: 'PRODUCT_FRACTION_STEP_REQUIRED',
  /** Admin config: sellByFraction=true but fractionMinimum is missing / ≤ 0. */
  PRODUCT_FRACTION_MINIMUM_REQUIRED: 'PRODUCT_FRACTION_MINIMUM_REQUIRED',
  /** Admin config: fractionMinimum < fractionStep. */
  PRODUCT_FRACTION_MINIMUM_BELOW_STEP: 'PRODUCT_FRACTION_MINIMUM_BELOW_STEP',
  /** Admin config: fractionMinimum is not a multiple of fractionStep. */
  PRODUCT_FRACTION_MINIMUM_NOT_ALIGNED: 'PRODUCT_FRACTION_MINIMUM_NOT_ALIGNED',
  /** Sale path: quantity must be a whole number for this product. */
  SALE_QUANTITY_NOT_WHOLE: 'SALE_QUANTITY_NOT_WHOLE',
  /** Sale path: quantity is below the configured minimum. */
  SALE_QUANTITY_BELOW_MINIMUM: 'SALE_QUANTITY_BELOW_MINIMUM',
  /** Sale path: quantity does not match the configured step. */
  SALE_QUANTITY_NOT_ALIGNED: 'SALE_QUANTITY_NOT_ALIGNED',
  /** Sale path: sellByFraction=true but the policy columns are null. */
  SALE_FRACTION_POLICY_MISSING: 'SALE_FRACTION_POLICY_MISSING',
  /** Sale path: quantity is zero / negative / non-finite. */
  SALE_QUANTITY_INVALID: 'SALE_QUANTITY_INVALID',
  /** Split-payment input: Σ(payments.amount) does not match the sale total. */
  SALE_PAYMENTS_SUM_MISMATCH: 'SALE_PAYMENTS_SUM_MISMATCH',

  // --- inventory transfers domain (Phase 2 DB-102 / API-102) ---
  TRANSFER_SITES_IDENTICAL: 'TRANSFER_SITES_IDENTICAL',
  TRANSFER_SITE_NOT_FOUND: 'TRANSFER_SITE_NOT_FOUND',
  TRANSFER_PRODUCT_NOT_FOUND: 'TRANSFER_PRODUCT_NOT_FOUND',
  TRANSFER_QUANTITY_INVALID: 'TRANSFER_QUANTITY_INVALID',
  TRANSFER_ITEMS_REQUIRED: 'TRANSFER_ITEMS_REQUIRED',
  TRANSFER_INSUFFICIENT_STOCK: 'TRANSFER_INSUFFICIENT_STOCK',
  /** Void target: transfer id does not exist for the current tenant. */
  TRANSFER_NOT_FOUND: 'TRANSFER_NOT_FOUND',
  /** Void target is already in the `void` status — double-void is rejected. */
  TRANSFER_ALREADY_VOID: 'TRANSFER_ALREADY_VOID',
  /**
   * Void reversal would drive the destination site's on-hand below zero,
   * e.g. because a later sale already consumed the transferred stock.
   */
  TRANSFER_VOID_INSUFFICIENT_STOCK: 'TRANSFER_VOID_INSUFFICIENT_STOCK',
  /** `transfers.receive` called on a transfer whose status is not `in_transit`. */
  TRANSFER_NOT_IN_TRANSIT: 'TRANSFER_NOT_IN_TRANSIT',
  /**
   * Phase 2 UI-103: a `transfers.receive` line reports a received quantity
   * greater than the shipped quantity. Accepting would create stock from
   * nothing — operators should complete the receive at the shipped qty and
   * post a separate stock adjustment if they genuinely received more.
   */
  TRANSFER_RECEIVED_EXCEEDS_SHIPPED: 'TRANSFER_RECEIVED_EXCEEDS_SHIPPED',
  /**
   * Phase 2 UI-103: a `transfers.receive` line payload references an item id
   * that does not belong to the target transfer (or is duplicated across
   * entries).
   */
  TRANSFER_RECEIVE_LINE_MISMATCH: 'TRANSFER_RECEIVE_LINE_MISMATCH',

  // --- quotations domain (Phase 5 / Tier-2 #6) ---
  QUOTATION_NOT_FOUND: 'QUOTATION_NOT_FOUND',
  QUOTATION_ITEMS_REQUIRED: 'QUOTATION_ITEMS_REQUIRED',
  QUOTATION_PRODUCT_NOT_FOUND: 'QUOTATION_PRODUCT_NOT_FOUND',
  QUOTATION_CUSTOMER_NOT_FOUND: 'QUOTATION_CUSTOMER_NOT_FOUND',
  QUOTATION_SITE_NOT_FOUND: 'QUOTATION_SITE_NOT_FOUND',
  QUOTATION_QUANTITY_INVALID: 'QUOTATION_QUANTITY_INVALID',
  /**
   * Status transition is not allowed (e.g. moving from `converted` back to
   * `draft`). Source/target status are reported in the error details.
   */
  QUOTATION_INVALID_STATUS_TRANSITION: 'QUOTATION_INVALID_STATUS_TRANSITION',
  /** Only quotations in `draft` may be deleted; everything else is archived. */
  QUOTATION_DELETE_NOT_DRAFT: 'QUOTATION_DELETE_NOT_DRAFT',
  /** No active sequential is configured for the tenant's quotation numbering. */
  QUOTATION_SEQUENTIAL_MISSING: 'QUOTATION_SEQUENTIAL_MISSING',

  // --- receipt templates domain (Iter 2) ---
  RECEIPT_TEMPLATE_NOT_FOUND: 'RECEIPT_TEMPLATE_NOT_FOUND',
  RECEIPT_TEMPLATE_NAME_REQUIRED: 'RECEIPT_TEMPLATE_NAME_REQUIRED',
  /** Tried to delete the only active template for a kind — leave at least one. */
  RECEIPT_TEMPLATE_LAST_FOR_KIND: 'RECEIPT_TEMPLATE_LAST_FOR_KIND',
  /** A duplicate's resolved name collides with an existing one for the same kind. */
  RECEIPT_TEMPLATE_NAME_DUPLICATE: 'RECEIPT_TEMPLATE_NAME_DUPLICATE',

  // --- sales domain ---
  // Added during ENG-018 + ENG-019 while sweeping sales.ts for raw
  // TRPCError messages that bypassed the translate-by-errorCode path
  // and leaked English strings into the localized UI.
  /** Sale id does not exist in the current tenant. */
  SALE_NOT_FOUND: 'SALE_NOT_FOUND',
  /** Post-equivalence normalized quantity is zero / negative / non-finite. */
  SALE_QUANTITY_NONPOSITIVE: 'SALE_QUANTITY_NONPOSITIVE',
  /** No active sale sequential is configured for the tenant. */
  SALE_SEQUENTIAL_MISSING: 'SALE_SEQUENTIAL_MISSING',
  /** The selected customer was not found or is inactive. */
  SALE_CUSTOMER_INVALID: 'SALE_CUSTOMER_INVALID',
  /** A line references a product that is missing or inactive; details.productName. */
  SALE_PRODUCT_INVALID: 'SALE_PRODUCT_INVALID',
  /** A line references a unit assignment that is missing or inactive; details.productName. */
  SALE_UNIT_INVALID: 'SALE_UNIT_INVALID',
  /** A line requested more than the available on-hand stock; details: productName, available, requested. */
  SALE_INSUFFICIENT_STOCK: 'SALE_INSUFFICIENT_STOCK',
  /** Applied discount amount exceeds the computed sale total. */
  SALE_DISCOUNT_EXCEEDS_TOTAL: 'SALE_DISCOUNT_EXCEEDS_TOTAL',
  /** Amount received is below the sale total when the payment status is paid. */
  SALE_AMOUNT_RECEIVED_BELOW_TOTAL: 'SALE_AMOUNT_RECEIVED_BELOW_TOTAL',
  /** Update rejected because the sale is already voided. */
  SALE_UPDATE_VOIDED_FORBIDDEN: 'SALE_UPDATE_VOIDED_FORBIDDEN',
  /** Void: the target is already voided. */
  SALE_VOID_ALREADY_VOIDED: 'SALE_VOID_ALREADY_VOIDED',
  /** Void: the target is already refunded (refund and void are mutually exclusive). */
  SALE_VOID_REFUNDED_FORBIDDEN: 'SALE_VOID_REFUNDED_FORBIDDEN',
  /** Void: only completed sales can be voided. */
  SALE_VOID_NOT_COMPLETED: 'SALE_VOID_NOT_COMPLETED',
  /** Void/return: the sale has zero line items. */
  SALE_WITHOUT_ITEMS: 'SALE_WITHOUT_ITEMS',
  /** Return: voided sales cannot be refunded. */
  SALE_RETURN_VOIDED_FORBIDDEN: 'SALE_RETURN_VOIDED_FORBIDDEN',
  /** Return: only completed sales can be refunded. */
  SALE_RETURN_NOT_COMPLETED: 'SALE_RETURN_NOT_COMPLETED',
  /** Return: the sale is already refunded. */
  SALE_RETURN_ALREADY_REFUNDED: 'SALE_RETURN_ALREADY_REFUNDED',
  /** Return: a prior refund row already exists (duplicate refund). */
  SALE_RETURN_DUPLICATE: 'SALE_RETURN_DUPLICATE',
  /** Reversal transaction references a product row that no longer exists. */
  SALE_REVERSAL_PRODUCT_MISSING: 'SALE_REVERSAL_PRODUCT_MISSING',

  // --- ENG-018 park-and-resume ---
  /** Suspend/discard target is not in status='draft'. */
  SALE_DRAFT_REQUIRED: 'SALE_DRAFT_REQUIRED',
  /** Resume target has no suspension metadata. */
  SALE_NOT_SUSPENDED: 'SALE_NOT_SUSPENDED',
  /** Resume/discard attempted by a non-owner cashier without manager override. */
  SALE_SUSPEND_OWNERSHIP_REQUIRED: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',

  // --- ENG-019 receipt reprint ---
  /** Reprint requested on a draft sale (drafts have no printable receipt). */
  SALE_REPRINT_DRAFT_FORBIDDEN: 'SALE_REPRINT_DRAFT_FORBIDDEN',
  /** Cashier reprint: caller has no open cash session or the sale does not belong to it. */
  SALE_REPRINT_ACTIVE_SESSION_REQUIRED: 'SALE_REPRINT_ACTIVE_SESSION_REQUIRED',

  // --- ENG-018c draft completion ---
  /** Attempt to complete a draft that is still suspended; caller must resume first. */
  SALE_COMPLETE_DRAFT_SUSPENDED: 'SALE_COMPLETE_DRAFT_SUSPENDED',

  // --- ENG-020 fiscal reports ---
  /** `reports.fiscal.getByCufe` could not find a row with that CUFE for the tenant. */
  FISCAL_DOCUMENT_NOT_FOUND: 'FISCAL_DOCUMENT_NOT_FOUND',

  // --- ENG-042 sync resolve TOCTOU close-out ---
  /**
   * `sync.resolve` refused a `local_wins` or `merged` resolution because the
   * local record no longer exists at the moment the transaction opens. The
   * caller should either delete the queued change or pick `remote_wins`.
   * Detected inside the transaction so the conflict row stays `pending` and
   * the queue is unchanged on this throw.
   */
  SYNC_LOCAL_RECORD_MISSING: 'SYNC_LOCAL_RECORD_MISSING',

  // --- ENG-030 AI foundation ---
  /**
   * AI features are turned off at the tenant level
   * (`tenants.settings.ai.enabled === false`). The renderer should gray
   * out AI-driven UI surfaces; the server short-circuits before any
   * provider call so no audit-log row is written.
   */
  AI_DISABLED: 'AI_DISABLED',
  /**
   * The current month's AI spend is at or above the tenant's
   * `monthlyBudgetUsd`. Pre-checked before each call. Caller should
   * raise the budget, wait for next month, or disable the feature.
   */
  AI_BUDGET_EXCEEDED: 'AI_BUDGET_EXCEEDED',
  /**
   * The configured provider is unreachable, unconfigured (no env-var
   * key), or returned an error. Wraps the original SDK / network
   * error in `details.cause`.
   */
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  /**
   * The conversational analytics co-pilot rejected generated SQL before
   * execution. Only single-statement SELECT/WITH queries over the bounded
   * analytics snapshot are allowed.
   */
  AI_COPILOT_SQL_REJECTED: 'AI_COPILOT_SQL_REJECTED',
  /**
   * The co-pilot analytics snapshot would exceed its server-side row caps.
   * The caller must provide a narrower date/site context before retrying.
   */
  AI_COPILOT_QUERY_LIMIT_EXCEEDED: 'AI_COPILOT_QUERY_LIMIT_EXCEEDED',
} as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[keyof typeof SERVER_ERROR_CODES];

/**
 * The tRPC error formatter looks for this shape on `error.cause` to attach
 * the stable code to the JSON response under `data.errorCode`. Exposing it
 * as a class lets `instanceof` checks discriminate it from arbitrary causes.
 */
export class ServerErrorWithCode extends Error {
  readonly errorCode: ServerErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    errorCode: ServerErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ServerErrorWithCode';
    this.errorCode = errorCode;
    this.details = details;
  }
}

/**
 * Throw a TRPCError that carries a stable error code in `cause`. The `message`
 * remains an English fallback so server logs and pre-i18n callers still
 * surface something useful, but the canonical user-facing text comes from the
 * client's translation layer keyed by `errorCode`.
 *
 * @example
 *   throwServerError({
 *     trpcCode: 'UNAUTHORIZED',
 *     errorCode: 'AUTH_INVALID_CREDENTIALS',
 *     message: 'Email or password is incorrect',
 *   });
 */
export function throwServerError(args: {
  trpcCode: TRPC_ERROR_CODE_KEY;
  errorCode: ServerErrorCode;
  message: string;
  details?: Record<string, unknown>;
}): never {
  throw new TRPCError({
    code: args.trpcCode,
    message: args.message,
    cause: new ServerErrorWithCode(args.errorCode, args.message, args.details),
  });
}
