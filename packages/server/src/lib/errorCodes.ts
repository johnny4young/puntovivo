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

  // --- cash sessions domain (Phase 1 DB-051 / API-051 / API-055) ---
  CASH_SESSION_REQUIRED: 'CASH_SESSION_REQUIRED',
  CASH_SESSION_SITE_REQUIRED: 'CASH_SESSION_SITE_REQUIRED',
  CASH_SESSION_ALREADY_OPEN_FOR_CASHIER: 'CASH_SESSION_ALREADY_OPEN_FOR_CASHIER',
  CASH_SESSION_ALREADY_OPEN_FOR_REGISTER: 'CASH_SESSION_ALREADY_OPEN_FOR_REGISTER',
  CASH_SESSION_OPENING_FLOAT_MISMATCH: 'CASH_SESSION_OPENING_FLOAT_MISMATCH',
  CASH_SESSION_OPENING_FLOAT_INVALID: 'CASH_SESSION_OPENING_FLOAT_INVALID',

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
