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
