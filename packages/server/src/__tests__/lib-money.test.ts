/**
 * Auditoría 2026-06 — dedicated regression suite for `roundMoney`
 * (), the single source of truth for every monetary rounding in
 * the application layer. Until now the helper was only exercised
 * indirectly (through completeSale / cash-session flows), so a refactor
 * could silently swap it for banker's rounding or drop the EPSILON
 * correction without any test catching the cent-level drift. These
 * cases pin the exact contract the storage CHECKs
 * (`round(col, 2) = col`) and the receipt math rely on.
 */

import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { real, sqliteTable } from 'drizzle-orm/sqlite-core';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { roundMoney, sumMoneySql, tryRoundMoneyToSafeCents } from '../lib/money.js';

describe('roundMoney', () => {
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
    // requires rounding AFTER each line, not only at the end.
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

describe('tryRoundMoneyToSafeCents', () => {
  it('accepts ordinary rounded cents and rejects non-finite or unsafe-cent values', () => {
    expect(tryRoundMoneyToSafeCents(1.005)).toBe(1.01);
    expect(tryRoundMoneyToSafeCents(90_000_000_000_000)).toBe(90_000_000_000_000);
    expect(tryRoundMoneyToSafeCents(100_000_000_000_000)).toBeNull();
    expect(tryRoundMoneyToSafeCents(Number.POSITIVE_INFINITY)).toBeNull();
    expect(tryRoundMoneyToSafeCents(Number.NaN)).toBeNull();
  });
});

describe('sumMoneySql', () => {
  /**
   * `roundMoney` normalises what the application computes; it never sees a
   * SUM the database performs. That gap is where the credit-limit defect
   * lived: a ledger holding 0.10 and 0.20 sums to 0.30000000000000004, and
   * the cupo check compared THAT against 0.35 and refused a sale landing
   * exactly on the limit. Rounding each row as it is written does not help.
   */
  it('rounds a money sum inside SQL, where roundMoney cannot reach', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const db = getDatabase();
    const sqlite = (db as unknown as { $client: Database.Database }).$client;
    sqlite.exec('CREATE TABLE money_rows (amount REAL NOT NULL)');
    for (const amount of [0.1, 0.2]) {
      sqlite.prepare('INSERT INTO money_rows (amount) VALUES (?)').run(amount);
    }

    // The raw sum must actually drift, or this proves nothing.
    const raw = sqlite
      .prepare('SELECT coalesce(sum(amount), 0) AS total FROM money_rows')
      .get() as {
      total: number;
    };
    expect(raw.total).not.toBe(0.3);

    const rounded = sqlite
      .prepare('SELECT round(coalesce(sum(amount), 0), 2) AS total FROM money_rows')
      .get() as { total: number };
    expect(rounded.total).toBe(0.3);

    // And that is what the helper produces, driven through the ORM rather
    // than by inspecting its internals.
    const moneyRows = sqliteTable('money_rows', { amount: real('amount').notNull() });
    const viaHelper = await db
      .select({ total: sumMoneySql(moneyRows.amount) })
      .from(moneyRows)
      .get();
    expect(viaHelper?.total).toBe(0.3);

    await closeDatabase();
  });
});
