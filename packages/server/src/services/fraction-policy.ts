import { throwServerError } from '../lib/errorCodes.js';

/**
 * Epsilon used to compare floating-point fraction alignment. Chosen so that
 * `0.1 + 0.2` style drift (~1e-16) always compares equal while genuinely
 * out-of-step values (>= 1e-6 of a unit) are rejected.
 */
const FRACTION_EPSILON = 1e-9;

export interface FractionPolicy {
  sellByFraction: boolean;
  fractionStep: number | null;
  fractionMinimum: number | null;
}

export interface FractionPolicyInput {
  sellByFraction?: boolean | null;
  fractionStep?: number | null;
  fractionMinimum?: number | null;
}

interface QuantityPolicyProduct extends FractionPolicy {
  name: string;
}

function isStepAligned(quantity: number, step: number): boolean {
  const ratio = quantity / step;
  return Math.abs(ratio - Math.round(ratio)) < FRACTION_EPSILON;
}

function isWholeQuantity(quantity: number): boolean {
  return Math.abs(quantity - Math.round(quantity)) < FRACTION_EPSILON;
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const EMPTY_POLICY: FractionPolicy = {
  sellByFraction: false,
  fractionStep: null,
  fractionMinimum: null,
};

/**
 * Normalize and validate a fraction policy input against an existing policy.
 *
 * Resolution rules:
 *   - Each field in `input` that is `undefined` inherits from `existing` so
 *     partial updates don't accidentally wipe configured values.
 *   - When `sellByFraction` is false, the other fields are forced to `null`.
 *     Callers never need to clear them manually.
 *   - When `sellByFraction` is true, the step and minimum are validated
 *     against the business rules. Each failure throws a TRPCError with a
 *     stable error code so the client can translate the message.
 */
export function resolveFractionPolicy(
  input: FractionPolicyInput,
  existing: FractionPolicy = EMPTY_POLICY
): FractionPolicy {
  const sellByFraction = input.sellByFraction ?? existing.sellByFraction;
  const fractionStep =
    input.fractionStep !== undefined ? input.fractionStep : existing.fractionStep;
  const fractionMinimum =
    input.fractionMinimum !== undefined ? input.fractionMinimum : existing.fractionMinimum;

  if (!sellByFraction) {
    return { ...EMPTY_POLICY };
  }

  if (!isPositiveFinite(fractionStep)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_FRACTION_STEP_REQUIRED',
      message: 'Fraction step must be greater than zero when fractional sales are enabled',
    });
  }

  if (!isPositiveFinite(fractionMinimum)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_FRACTION_MINIMUM_REQUIRED',
      message: 'Fraction minimum must be greater than zero when fractional sales are enabled',
    });
  }

  if (fractionMinimum < fractionStep) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_FRACTION_MINIMUM_BELOW_STEP',
      message: 'Fraction minimum must be greater than or equal to the fraction step',
      details: { fractionStep, fractionMinimum },
    });
  }

  if (!isStepAligned(fractionMinimum, fractionStep)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PRODUCT_FRACTION_MINIMUM_NOT_ALIGNED',
      message: 'Fraction minimum must align with the configured fraction step',
      details: { fractionStep, fractionMinimum },
    });
  }

  return { sellByFraction: true, fractionStep, fractionMinimum };
}

/**
 * Assert that `quantity` is allowed for the given product per its fraction
 * policy. Throws a coded TRPCError with structured details so the client can
 * render a localized message that includes the offending step / minimum.
 */
export function assertSaleQuantityAllowed(
  quantity: number,
  product: QuantityPolicyProduct
): void {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_QUANTITY_INVALID',
      message: 'Quantity must be greater than zero',
      details: { product: product.name, quantity },
    });
  }

  if (!product.sellByFraction) {
    if (!isWholeQuantity(quantity)) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_QUANTITY_NOT_WHOLE',
        message: `Product "${product.name}" must be sold in whole units`,
        details: { product: product.name, quantity },
      });
    }
    return;
  }

  const { fractionStep, fractionMinimum } = product;

  if (fractionStep === null || fractionMinimum === null) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_FRACTION_POLICY_MISSING',
      message: `Product "${product.name}" is missing its fraction policy configuration`,
      details: { product: product.name },
    });
  }

  if (quantity + FRACTION_EPSILON < fractionMinimum) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_QUANTITY_BELOW_MINIMUM',
      message: `Product "${product.name}" must be sold with a minimum quantity of ${fractionMinimum}`,
      details: { product: product.name, fractionMinimum, quantity },
    });
  }

  if (!isStepAligned(quantity, fractionStep)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_QUANTITY_NOT_ALIGNED',
      message: `Product "${product.name}" must use increments of ${fractionStep}`,
      details: { product: product.name, fractionStep, quantity },
    });
  }
}
