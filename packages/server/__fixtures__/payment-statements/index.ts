/**
 * ENG-038c — Deterministic 30-day payment-statement fixture generator.
 *
 * Generates a reproducible stream of provider statement rows + the
 * matching POS-side `payment_outbox` rows so the matcher test, the
 * benchmark harness, and any future ENG-065d UX work share the same
 * source of truth.
 *
 * Why a generator instead of static JSON files:
 *
 * - 30 days × 6 rails × ~6 settlements/day ≈ 1080 rows is too noisy to
 *   hand-edit and review in a PR.
 * - Tests need to seed `payment_outbox` rows that align with the
 *   fixture; both halves are derived from the same `RawSettlement[]`
 *   so they stay in lockstep by construction.
 * - The 5 % deliberate mismatch rate is parameterized so future tickets
 *   can tighten or loosen the noise without rewriting the fixture.
 *
 * Determinism: seeded via a small LCG (`mulberry32`-style) so the
 * sequence is byte-identical across runs and platforms without depending
 * on `Math.random`. Tests that need a different fixture pass a different
 * seed.
 *
 * @module __fixtures__/payment-statements
 */

import type { PaymentRailId } from '../../src/db/schema.js';
import { PAYMENT_RAIL_IDS } from '../../src/services/payments/manifest.js';

/** Shape that mirrors what each real provider emits in its statement. */
export interface RawSettlement {
  railId: PaymentRailId;
  reference: string;
  providerTransactionId: string;
  amount: number;
  currencyCode: string;
  status: 'settled' | 'declined' | 'pending';
  settledAt: string;
  fee: number;
}

/** Per-statement-row plus the matching POS-side tender (when generated). */
export interface FixtureRow {
  statement: RawSettlement;
  /** When null the statement row is an "orphan provider" mismatch. */
  posTender: {
    salePaymentId: string;
    amount: number;
    currencyCode: string;
    reference: string;
    createdAt: string;
  } | null;
  /** Optional pre-staged outbox row that mirrors the tender's capture. */
  outboxRow: {
    id: string;
    railId: PaymentRailId;
    salePaymentId: string;
    amount: number;
    currencyCode: string;
    reference: string;
    providerTransactionId: string | null;
    status: 'approved' | 'settled' | 'declined' | 'timeout' | 'retrying';
    createdAt: string;
  } | null;
  /**
   * Marks the row as one of the deliberately-noisy entries the fixture
   * sprinkles in. Useful for assertions that exercise every classifier.
   */
  mismatchKind:
    | null
    | 'amount_mismatch'
    | 'missing_provider_reference'
    | 'orphan_provider_row'
    | 'provider_issue';
}

export interface FixtureBundle {
  /** Per-rail row buckets keyed by rail id. */
  rails: Record<PaymentRailId, FixtureRow[]>;
  /** Flat list across every rail. */
  rows: FixtureRow[];
  /** Per-rail count plus expected match rate for assertions. */
  summary: {
    totalRows: number;
    mismatchRows: number;
    expectedMatchRate: number;
  };
}

export interface FixtureOptions {
  /** Deterministic seed; default `1`. */
  seed?: number;
  /** Number of consecutive days the fixture spans; default `30`. */
  days?: number;
  /** Average settlements per rail per day; default `6`. */
  settlementsPerRailPerDay?: number;
  /** Fraction of rows to inject as mismatches; default `0.05`. */
  mismatchRate?: number;
  /** Closing of the window (ISO string); default deterministic 2026-05-01. */
  windowEnd?: string;
  /** Optional tenant id used to namespace generated ids. Default 'fixture'. */
  tenantId?: string;
}

const FIXED_NOW_ISO = '2026-05-01T00:00:00.000Z';

const RAIL_CURRENCY: Record<PaymentRailId, string> = {
  wompi: 'COP',
  bold: 'COP',
  epayco: 'COP',
  mercado_pago: 'COP',
  nequi: 'COP',
  daviplata: 'COP',
};

const RAIL_AMOUNT_RANGES: Record<PaymentRailId, { min: number; max: number }> = {
  wompi: { min: 12_000, max: 480_000 },
  bold: { min: 8_000, max: 320_000 },
  epayco: { min: 15_000, max: 540_000 },
  mercado_pago: { min: 9_000, max: 380_000 },
  nequi: { min: 5_000, max: 220_000 },
  daviplata: { min: 4_000, max: 180_000 },
};

const RAIL_REFERENCE_PREFIX: Record<PaymentRailId, string> = {
  wompi: 'WMP',
  bold: 'BLD',
  epayco: 'EPC',
  mercado_pago: 'MPO',
  nequi: 'NEQ',
  daviplata: 'DVP',
};

/**
 * Lightweight deterministic PRNG. mulberry32 is fast, has 2^32 period,
 * and produces bit-identical streams across V8 / Node platforms.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickAmount(rng: () => number, range: { min: number; max: number }): number {
  const raw = range.min + rng() * (range.max - range.min);
  // Round to nearest 100 COP so the deterministic fixture reads like a
  // typical retail tender (no fractional COP cents).
  return Math.round(raw / 100) * 100;
}

function pickReference(
  rng: () => number,
  railId: PaymentRailId,
  dayIndex: number,
  rowIndex: number
): string {
  // Encode dayIndex + rowIndex into the reference so collisions across
  // the 1080-row stream are impossible without depending on `rng`.
  const suffix = String(Math.floor(rng() * 9999)).padStart(4, '0');
  return `${RAIL_REFERENCE_PREFIX[railId]}-${dayIndex.toString().padStart(2, '0')}${rowIndex.toString().padStart(2, '0')}-${suffix}`;
}

function pickTransactionId(rng: () => number, railId: PaymentRailId): string {
  const raw = Math.floor(rng() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  return `${railId}-tx-${raw}`;
}

/**
 * Build the full deterministic fixture bundle. Both halves (statement
 * rows + POS-side tender / outbox rows) are derived together so tests
 * can seed `payment_outbox` and assert directly against the same
 * `RawSettlement` stream.
 */
export function generatePaymentStatementFixture(
  opts: FixtureOptions = {}
): FixtureBundle {
  const seed = opts.seed ?? 1;
  const days = opts.days ?? 30;
  const settlementsPerRailPerDay = opts.settlementsPerRailPerDay ?? 6;
  const mismatchRate = opts.mismatchRate ?? 0.05;
  const tenantId = opts.tenantId ?? 'fixture';
  const windowEnd = opts.windowEnd ?? FIXED_NOW_ISO;
  const windowEndMs = Date.parse(windowEnd);
  if (!Number.isFinite(windowEndMs)) {
    throw new Error(`generatePaymentStatementFixture: invalid windowEnd ${windowEnd}`);
  }

  const rng = mulberry32(seed);
  const rails = Object.fromEntries(
    PAYMENT_RAIL_IDS.map(rail => [rail, [] as FixtureRow[]])
  ) as Record<PaymentRailId, FixtureRow[]>;
  const rows: FixtureRow[] = [];

  let globalRowIndex = 0;

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    // dayIndex = 0 is the most recent day; older days subtract toward
    // the start of the window so the resulting timestamps stay inside
    // the documented window.
    const dayStartMs = windowEndMs - (days - 1 - dayIndex) * 24 * 60 * 60 * 1000;
    for (const railId of PAYMENT_RAIL_IDS) {
      const range = RAIL_AMOUNT_RANGES[railId];
      for (let rowIndex = 0; rowIndex < settlementsPerRailPerDay; rowIndex += 1) {
        const baseAmount = pickAmount(rng, range);
        const baseRef = pickReference(rng, railId, dayIndex, rowIndex);
        const baseTxId = pickTransactionId(rng, railId);
        // Distribute settlements across the day so the matcher's
        // ordering assertions exercise multiple hour-granularity buckets.
        const minuteOffset = Math.floor(rng() * 23 * 60);
        const settledAtMs = dayStartMs + minuteOffset * 60 * 1000;
        const settledAt = new Date(settledAtMs).toISOString();

        const mismatchRoll = rng();
        const mismatchKind =
          mismatchRoll < mismatchRate ? pickMismatchKind(rng) : null;

        const salePaymentId = `${tenantId}-sp-${globalRowIndex.toString().padStart(5, '0')}`;
        const outboxId = `${tenantId}-pob-${globalRowIndex.toString().padStart(5, '0')}`;
        globalRowIndex += 1;

        if (mismatchKind === 'amount_mismatch') {
          // POS tender + outbox row exist with the correct reference, but
          // the provider settled a slightly different amount (drift > epsilon).
          const drift = baseAmount * 0.02;
          rows.push(
            pushRow(rails, {
              statement: {
                railId,
                reference: baseRef,
                providerTransactionId: baseTxId,
                amount: baseAmount + drift,
                currencyCode: RAIL_CURRENCY[railId],
                status: 'settled',
                settledAt,
                fee: roundTo2(baseAmount * 0.015),
              },
              posTender: {
                salePaymentId,
                amount: baseAmount,
                currencyCode: RAIL_CURRENCY[railId],
                reference: baseRef,
                createdAt: settledAt,
              },
              outboxRow: {
                id: outboxId,
                railId,
                salePaymentId,
                amount: baseAmount,
                currencyCode: RAIL_CURRENCY[railId],
                reference: baseRef,
                providerTransactionId: baseTxId,
                status: 'approved',
                createdAt: settledAt,
              },
              mismatchKind,
            })
          );
        } else if (mismatchKind === 'missing_provider_reference') {
          // POS tender exists but there is NO outbox row — operator
          // captured the tender as "card" but the cashier never tapped
          // the rail-bound capture flow. Statement row also drops away
          // so the deterministic classifier surfaces it correctly.
          rows.push(
            pushRow(rails, {
              statement: null as unknown as RawSettlement,
              posTender: {
                salePaymentId,
                amount: baseAmount,
                currencyCode: RAIL_CURRENCY[railId],
                reference: baseRef,
                createdAt: settledAt,
              },
              outboxRow: null,
              mismatchKind,
            })
          );
        } else if (mismatchKind === 'orphan_provider_row') {
          // Statement row landed without a matching POS tender — the
          // provider received money the POS never recorded (refunded
          // tender, returned-without-void, manual operator action).
          rows.push(
            pushRow(rails, {
              statement: {
                railId,
                reference: baseRef,
                providerTransactionId: baseTxId,
                amount: baseAmount,
                currencyCode: RAIL_CURRENCY[railId],
                status: 'settled',
                settledAt,
                fee: roundTo2(baseAmount * 0.015),
              },
              posTender: null,
              outboxRow: null,
              mismatchKind,
            })
          );
        } else if (mismatchKind === 'provider_issue') {
          // Outbox row marks the tender as declined/timeout — the operator
          // already saw a red badge; the matcher must surface it in the
          // mismatch list with `suggestedAction='review_provider'`.
          const failureStatus = rng() < 0.5 ? 'declined' : 'timeout';
          rows.push(
            pushRow(rails, {
              statement: {
                railId,
                reference: baseRef,
                providerTransactionId: baseTxId,
                amount: baseAmount,
                currencyCode: RAIL_CURRENCY[railId],
                status: failureStatus === 'declined' ? 'declined' : 'pending',
                settledAt,
                fee: 0,
              },
              posTender: {
                salePaymentId,
                amount: baseAmount,
                currencyCode: RAIL_CURRENCY[railId],
                reference: baseRef,
                createdAt: settledAt,
              },
              outboxRow: {
                id: outboxId,
                railId,
                salePaymentId,
                amount: baseAmount,
                currencyCode: RAIL_CURRENCY[railId],
                reference: baseRef,
                providerTransactionId: baseTxId,
                status: failureStatus,
                createdAt: settledAt,
              },
              mismatchKind,
            })
          );
        } else {
          // Happy path: deterministic match across reference + amount +
          // providerTransactionId. The matcher should mark this as
          // matched without invoking the AI tie-break.
          rows.push(
            pushRow(rails, {
              statement: {
                railId,
                reference: baseRef,
                providerTransactionId: baseTxId,
                amount: baseAmount,
                currencyCode: RAIL_CURRENCY[railId],
                status: 'settled',
                settledAt,
                fee: roundTo2(baseAmount * 0.015),
              },
              posTender: {
                salePaymentId,
                amount: baseAmount,
                currencyCode: RAIL_CURRENCY[railId],
                reference: baseRef,
                createdAt: settledAt,
              },
              outboxRow: {
                id: outboxId,
                railId,
                salePaymentId,
                amount: baseAmount,
                currencyCode: RAIL_CURRENCY[railId],
                reference: baseRef,
                providerTransactionId: baseTxId,
                status: 'approved',
                createdAt: settledAt,
              },
              mismatchKind: null,
            })
          );
        }
      }
    }
  }

  const mismatchRows = rows.filter(row => row.mismatchKind !== null).length;
  const totalRows = rows.length;
  const expectedMatchRate = (totalRows - mismatchRows) / Math.max(totalRows, 1);

  return {
    rails,
    rows,
    summary: {
      totalRows,
      mismatchRows,
      expectedMatchRate,
    },
  };
}

function pickMismatchKind(rng: () => number): FixtureRow['mismatchKind'] {
  const roll = rng();
  if (roll < 0.25) return 'amount_mismatch';
  if (roll < 0.5) return 'missing_provider_reference';
  if (roll < 0.75) return 'orphan_provider_row';
  return 'provider_issue';
}

function pushRow(
  rails: Record<PaymentRailId, FixtureRow[]>,
  row: FixtureRow
): FixtureRow {
  const railId =
    row.statement?.railId ??
    row.outboxRow?.railId ??
    // missing_provider_reference rows still belong to a rail conceptually
    // (the POS tender was captured for that rail) — fall back to the
    // first rail when neither side carries it. In practice this branch
    // never hits because the generator always provides at least one.
    PAYMENT_RAIL_IDS[0];
  rails[railId].push(row);
  return row;
}

function roundTo2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Pull only the statement rows that align with what a provider would
 * actually deliver in a pull import. Used by the worker statement-import
 * path to walk a deterministic stream.
 */
export function listStatementRows(bundle: FixtureBundle): RawSettlement[] {
  return bundle.rows
    .filter(row => row.statement !== null)
    .map(row => row.statement);
}

/**
 * Pull only the POS-side outbox rows that should be pre-seeded into
 * `payment_outbox` before the reconciliation pass runs. Mirrors what
 * the live capture path would land.
 */
export function listOutboxRows(bundle: FixtureBundle): NonNullable<FixtureRow['outboxRow']>[] {
  const out: NonNullable<FixtureRow['outboxRow']>[] = [];
  for (const row of bundle.rows) {
    if (row.outboxRow) out.push(row.outboxRow);
  }
  return out;
}

/**
 * Pull only the POS-side tenders that should be pre-seeded into
 * `sale_payments` so the matcher has tenders to walk.
 */
export function listPosTenders(bundle: FixtureBundle): NonNullable<FixtureRow['posTender']>[] {
  const out: NonNullable<FixtureRow['posTender']>[] = [];
  for (const row of bundle.rows) {
    if (row.posTender) out.push(row.posTender);
  }
  return out;
}
