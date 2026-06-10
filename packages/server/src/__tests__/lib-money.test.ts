/**
 * Auditoría 2026-06 — dedicated regression suite for `roundMoney`
 * (ENG-176a), the single source of truth for every monetary rounding in
 * the application layer. Until now the helper was only exercised
 * indirectly (through completeSale / cash-session flows), so a refactor
 * could silently swap it for banker's rounding or drop the EPSILON
 * correction without any test catching the cent-level drift. These
 * cases pin the exact contract the storage CHECKs
 * (`round(col, 2) = col`) and the receipt math rely on.
 */

import { describe, expect, it } from 'vitest';
import { roundMoney } from '../lib/money.js';

describe('roundMoney (ENG-176a)', () => {
  it('rounds the 0.005 half-cent boundary UP (defeats IEEE-754 representation drift)', () => {
    // 1.005 is stored as 1.00499999... in IEEE-754; a plain
    // Math.round(v * 100) / 100 rounds it DOWN to 1.00. The EPSILON
    // correction restores the half-away-from-zero contract.
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(10.005)).toBe(10.01);
  });

  it('collapses classic float-addition drift to the nearest cent', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(99.99000000000001)).toBe(99.99);
  });

  it('handles the tax-exclusive split for LATAM rates (non-terminating decimals)', () => {
    // IVA 19% tax-inclusive: base = gross / 1.19.
    expect(roundMoney(100 / 1.19)).toBe(84.03);
    // Round-trip: the reconstructed gross lands back on the original.
    expect(roundMoney(84.03 * 1.19)).toBe(100);
  });

  it('keeps per-line accumulation stable across a long cart (round-after-each-line contract)', () => {
    // ENG-176a requires rounding AFTER each line, not only at the end.
    // 12 lines of 50 / 1.19 each: per-line rounding gives an exact
    // 2-decimal accumulator at every step.
    let subtotal = 0;
    for (let i = 0; i < 12; i++) {
      subtotal = roundMoney(subtotal + roundMoney(50 / 1.19));
    }
    expect(subtotal).toBe(roundMoney(42.02 * 12));
    expect(subtotal).toBe(504.24);
  });

  it('is idempotent on already-2-decimal values', () => {
    expect(roundMoney(42.02)).toBe(42.02);
    expect(roundMoney(0)).toBe(0);
    expect(roundMoney(1000000.99)).toBe(1000000.99);
  });

  it('rounds negative halves away from zero (symmetric with positives + SQLite round())', () => {
    // Math.round alone rounds -234.5 to -234 (toward +infinity); the
    // sign-mirrored implementation keeps the documented
    // half-away-from-zero contract on both signs.
    expect(roundMoney(-2.345)).toBe(-2.35);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(-0.1 - 0.2)).toBe(-0.3);
    expect(roundMoney(-42.02)).toBe(-42.02);
  });

  it('normalizes -0 to 0 and never coins money out of NaN', () => {
    // toBe uses Object.is, so this also rejects a -0 result.
    expect(roundMoney(-0.001)).toBe(0);
    expect(Number.isNaN(roundMoney(Number.NaN))).toBe(true);
  });
});
