/**
 * Unit tests for the fraction policy service. These run in isolation from
 * the tRPC router so the business rules and their error-code mapping are
 * pinned down without any database or HTTP scaffolding.
 *
 * @module __tests__/fraction-policy.test
 */

import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  assertSaleQuantityAllowed,
  resolveFractionPolicy,
} from '../services/fraction-policy.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';

function expectCodedError(fn: () => unknown, errorCode: string): TRPCError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(TRPCError);
  const cause = (caught as TRPCError).cause;
  expect(cause).toBeInstanceOf(ServerErrorWithCode);
  expect((cause as ServerErrorWithCode).errorCode).toBe(errorCode);
  return caught as TRPCError;
}

describe('resolveFractionPolicy', () => {
  it('returns an empty policy when sellByFraction is false', () => {
    expect(resolveFractionPolicy({ sellByFraction: false })).toEqual({
      sellByFraction: false,
      fractionStep: null,
      fractionMinimum: null,
    });
  });

  it('clears step and minimum when toggling sellByFraction off from an existing policy', () => {
    const existing = { sellByFraction: true, fractionStep: 0.25, fractionMinimum: 0.5 };
    expect(resolveFractionPolicy({ sellByFraction: false }, existing)).toEqual({
      sellByFraction: false,
      fractionStep: null,
      fractionMinimum: null,
    });
  });

  it('inherits undefined fields from the existing policy on partial updates', () => {
    const existing = { sellByFraction: true, fractionStep: 0.25, fractionMinimum: 0.5 };
    const next = resolveFractionPolicy({ fractionMinimum: 1 }, existing);
    expect(next).toEqual({ sellByFraction: true, fractionStep: 0.25, fractionMinimum: 1 });
  });

  it('accepts a valid new policy', () => {
    const next = resolveFractionPolicy({
      sellByFraction: true,
      fractionStep: 0.25,
      fractionMinimum: 0.5,
    });
    expect(next).toEqual({ sellByFraction: true, fractionStep: 0.25, fractionMinimum: 0.5 });
  });

  it('rejects when sellByFraction=true but step is missing', () => {
    expectCodedError(
      () => resolveFractionPolicy({ sellByFraction: true, fractionMinimum: 1 }),
      'PRODUCT_FRACTION_STEP_REQUIRED'
    );
  });

  it('rejects when sellByFraction=true but step is zero / negative / non-finite', () => {
    expectCodedError(
      () =>
        resolveFractionPolicy({
          sellByFraction: true,
          fractionStep: 0,
          fractionMinimum: 1,
        }),
      'PRODUCT_FRACTION_STEP_REQUIRED'
    );
    expectCodedError(
      () =>
        resolveFractionPolicy({
          sellByFraction: true,
          fractionStep: -0.5,
          fractionMinimum: 1,
        }),
      'PRODUCT_FRACTION_STEP_REQUIRED'
    );
    expectCodedError(
      () =>
        resolveFractionPolicy({
          sellByFraction: true,
          fractionStep: Number.NaN,
          fractionMinimum: 1,
        }),
      'PRODUCT_FRACTION_STEP_REQUIRED'
    );
  });

  it('rejects when sellByFraction=true but minimum is missing / non-positive', () => {
    expectCodedError(
      () => resolveFractionPolicy({ sellByFraction: true, fractionStep: 0.25 }),
      'PRODUCT_FRACTION_MINIMUM_REQUIRED'
    );
    expectCodedError(
      () =>
        resolveFractionPolicy({
          sellByFraction: true,
          fractionStep: 0.25,
          fractionMinimum: 0,
        }),
      'PRODUCT_FRACTION_MINIMUM_REQUIRED'
    );
  });

  it('rejects when minimum is below step', () => {
    expectCodedError(
      () =>
        resolveFractionPolicy({
          sellByFraction: true,
          fractionStep: 0.5,
          fractionMinimum: 0.25,
        }),
      'PRODUCT_FRACTION_MINIMUM_BELOW_STEP'
    );
  });

  it('rejects when minimum does not align with step', () => {
    expectCodedError(
      () =>
        resolveFractionPolicy({
          sellByFraction: true,
          fractionStep: 0.25,
          fractionMinimum: 0.3,
        }),
      'PRODUCT_FRACTION_MINIMUM_NOT_ALIGNED'
    );
  });

  it('accepts minimum = step exactly (1 step worth)', () => {
    expect(
      resolveFractionPolicy({
        sellByFraction: true,
        fractionStep: 0.25,
        fractionMinimum: 0.25,
      })
    ).toEqual({ sellByFraction: true, fractionStep: 0.25, fractionMinimum: 0.25 });
  });
});

describe('assertSaleQuantityAllowed', () => {
  const wholeProduct = {
    name: 'Soda',
    sellByFraction: false,
    fractionStep: null,
    fractionMinimum: null,
  };
  const fractionalProduct = {
    name: 'Cable',
    sellByFraction: true,
    fractionStep: 0.25,
    fractionMinimum: 0.5,
  };

  it('accepts whole quantities for whole-unit products', () => {
    expect(() => assertSaleQuantityAllowed(1, wholeProduct)).not.toThrow();
    expect(() => assertSaleQuantityAllowed(42, wholeProduct)).not.toThrow();
  });

  it('rejects fractional quantities for whole-unit products with SALE_QUANTITY_NOT_WHOLE', () => {
    expectCodedError(
      () => assertSaleQuantityAllowed(0.5, wholeProduct),
      'SALE_QUANTITY_NOT_WHOLE'
    );
  });

  it('rejects zero / negative / non-finite quantities with SALE_QUANTITY_INVALID', () => {
    expectCodedError(() => assertSaleQuantityAllowed(0, wholeProduct), 'SALE_QUANTITY_INVALID');
    expectCodedError(() => assertSaleQuantityAllowed(-1, wholeProduct), 'SALE_QUANTITY_INVALID');
    expectCodedError(
      () => assertSaleQuantityAllowed(Number.POSITIVE_INFINITY, wholeProduct),
      'SALE_QUANTITY_INVALID'
    );
    expectCodedError(() => assertSaleQuantityAllowed(Number.NaN, wholeProduct), 'SALE_QUANTITY_INVALID');
  });

  it('accepts aligned fractional quantities for fractional products', () => {
    expect(() => assertSaleQuantityAllowed(0.5, fractionalProduct)).not.toThrow();
    expect(() => assertSaleQuantityAllowed(0.75, fractionalProduct)).not.toThrow();
    expect(() => assertSaleQuantityAllowed(2.5, fractionalProduct)).not.toThrow();
  });

  it('rejects quantities below the configured minimum', () => {
    expectCodedError(
      () => assertSaleQuantityAllowed(0.25, fractionalProduct),
      'SALE_QUANTITY_BELOW_MINIMUM'
    );
  });

  it('rejects quantities that do not align with the configured step', () => {
    expectCodedError(
      () => assertSaleQuantityAllowed(0.6, fractionalProduct),
      'SALE_QUANTITY_NOT_ALIGNED'
    );
  });

  it('is tolerant of IEEE-754 drift (0.1 + 0.2 style)', () => {
    const product = {
      name: 'Produce',
      sellByFraction: true,
      fractionStep: 0.1,
      fractionMinimum: 0.1,
    };
    // 0.1 + 0.2 !== 0.3 in IEEE-754, but the epsilon-aware alignment check
    // should still accept 0.3 as a valid step-aligned quantity.
    expect(() => assertSaleQuantityAllowed(0.3, product)).not.toThrow();
    expect(() => assertSaleQuantityAllowed(0.1 + 0.2, product)).not.toThrow();
  });

  it('rejects sellByFraction=true with null policy columns (corrupt config)', () => {
    expectCodedError(
      () =>
        assertSaleQuantityAllowed(1, {
          name: 'Broken',
          sellByFraction: true,
          fractionStep: null,
          fractionMinimum: null,
        }),
      'SALE_FRACTION_POLICY_MISSING'
    );
  });
});
