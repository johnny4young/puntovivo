/**
 * minimum viable loyalty ().
 *
 * Append-only points ledger with a materialized balance, same discipline as
 * the cash session (): `loyalty_movements` is the truth,
 * `loyalty_accounts.points` is the fast read, and BOTH move inside one
 * transaction so a crash can never leave a balance that its ledger does not
 * explain. Parity `points ≡ Σ(movements.points)` is pinned by `loyalty.test.ts`.
 *
 * v1 rule (per the  spec): `earn = floor(total × rate)` where `rate` is
 * points per currency unit, tuned per tenant (`tenants.settings.loyalty`).
 * The earned rate is SNAPSHOT on the movement, so a later rate change never
 * rewrites what a customer was already told they earned.
 *
 * Sale-path integration:
 * - `earnPointsForSale` runs inside the completeSale transaction, on BOTH
 * completion paths (fresh sale and resumed draft) — suspending a change is
 * a cashier workflow detail, not something the customer should lose points
 * over. It is idempotent per (account, sale) via a partial unique index,
 * and best-effort by contract: loyalty must NEVER block a sale (the
 * register is the pilot gate), so each caller wraps it in a SAVEPOINT
 * (nested tx) and logs failures — the savepoint is what keeps a swallowed
 * failure from committing a half-written ledger.
 * - `revertPointsForSale` appends a negative `revert` row on a sale
 * reversal — history is never erased (same posture as restoreLotsForSale
 * clearing provenance, but append-only because points are money-like).
 *
 * Redemptions and their source-linked restorations also live in this ledger;
 * the sale use-case owns tender orchestration while this module owns balance
 * mutation and immutable movement evidence.
 *
 * @module services/loyalty
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import { loyaltyAccounts, loyaltyMovements, customers, tenants } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import { roundMoney } from '../lib/money.js';

/** Tenant-level knobs for the loyalty program. */
export interface LoyaltySettings {
  /** Off by default: a tenant opts in explicitly (no silent point liability). */
  enabled: boolean;
  /**
   * Points per currency unit. The  spec writes the rule as
   * `floor(total / rate)`; this is the same rule expressed as a multiplier
   * (`floor(total × pointsPerUnit)`), which keeps a sane default for COP
   * (0.001 → 1 point per $1.000) without a divide-by-zero footgun.
   */
  pointsPerUnit: number;
  /** Redemption is a separate opt-in because points become a liability. */
  redemptionEnabled: boolean;
  /** Frozen monetary value of one whole point in the tenant currency. */
  valuePerPoint: number;
}

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: false,
  pointsPerUnit: 0.001,
  redemptionEnabled: false,
  valuePerPoint: 1_000,
};

/** Bounds mirrored by the Zod input; enforced here because the blob is
 * free-form JSON a bad edit could corrupt. */
export const MAX_POINTS_PER_UNIT = 100;
export const MAX_VALUE_PER_POINT = 1_000_000_000;

function normalizePointsPerUnit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MAX_POINTS_PER_UNIT) {
    return DEFAULT_LOYALTY_SETTINGS.pointsPerUnit;
  }
  return raw;
}

function normalizeValuePerPoint(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MAX_VALUE_PER_POINT) {
    return DEFAULT_LOYALTY_SETTINGS.valuePerPoint;
  }
  return roundMoney(raw);
}

function parseLoyaltySettings(settings: unknown): LoyaltySettings {
  const blob = (settings ?? {}) as Record<string, unknown>;
  const loyalty = (blob.loyalty ?? {}) as Partial<LoyaltySettings>;
  return {
    enabled: typeof loyalty.enabled === 'boolean' ? loyalty.enabled : false,
    pointsPerUnit: normalizePointsPerUnit(loyalty.pointsPerUnit),
    redemptionEnabled:
      typeof loyalty.redemptionEnabled === 'boolean' ? loyalty.redemptionEnabled : false,
    valuePerPoint: normalizeValuePerPoint(loyalty.valuePerPoint),
  };
}

/** Read `tenants.settings.loyalty`, merged with defaults (total value). */
export async function resolveLoyaltySettings(
  db: DatabaseInstance,
  tenantId: string
): Promise<LoyaltySettings> {
  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return parseLoyaltySettings(tenant?.settings);
}

/** Persist (a partial patch of) `tenants.settings.loyalty`. */
export async function writeLoyaltySettings(
  db: DatabaseInstance,
  tenantId: string,
  patch: Partial<LoyaltySettings>
): Promise<LoyaltySettings> {
  return db.transaction(
    tx => {
      const tenant = tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .get();
      const current = parseLoyaltySettings(tenant?.settings);
      if (
        patch.enabled === undefined &&
        patch.pointsPerUnit === undefined &&
        patch.redemptionEnabled === undefined &&
        patch.valuePerPoint === undefined
      ) {
        return current;
      }
      const next: LoyaltySettings = {
        enabled: patch.enabled ?? current.enabled,
        pointsPerUnit:
          patch.pointsPerUnit === undefined
            ? current.pointsPerUnit
            : normalizePointsPerUnit(patch.pointsPerUnit),
        redemptionEnabled: patch.redemptionEnabled ?? current.redemptionEnabled,
        valuePerPoint:
          patch.valuePerPoint === undefined
            ? current.valuePerPoint
            : normalizeValuePerPoint(patch.valuePerPoint),
      };
      const settings = { ...((tenant?.settings ?? {}) as Record<string, unknown>), loyalty: next };
      tx.update(tenants)
        .set({ settings, updatedAt: new Date().toISOString() })
        .where(eq(tenants.id, tenantId))
        .run();
      return next;
    },
    { behavior: 'immediate' }
  );
}

/**
 * Points a sale total earns under `pointsPerUnit`. Floors to whole points —
 * partial points are a customer-support conversation nobody wants, and the
 * spec says `floor`.
 */
export function pointsForTotal(total: number, pointsPerUnit: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.floor(total * pointsPerUnit);
}

/**
 * Get-or-create the customer's account inside the caller's transaction.
 * Returns null when the customer does not belong to the tenant — a caller on
 * the sale path must never create loyalty rows for a foreign customer.
 */
function ensureAccount(
  tx: DatabaseInstance,
  tenantId: string,
  customerId: string,
  nowIso: string
): { id: string; points: number } | null {
  const existing = tx
    .select({ id: loyaltyAccounts.id, points: loyaltyAccounts.points })
    .from(loyaltyAccounts)
    .where(and(eq(loyaltyAccounts.tenantId, tenantId), eq(loyaltyAccounts.customerId, customerId)))
    .get();
  if (existing) return existing;

  const customer = tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)))
    .get();
  if (!customer) return null;

  const id = nanoid();
  tx.insert(loyaltyAccounts)
    .values({ id, tenantId, customerId, points: 0, createdAt: nowIso, updatedAt: nowIso })
    .onConflictDoNothing({
      target: [loyaltyAccounts.tenantId, loyaltyAccounts.customerId],
    })
    .run();

  // Another connection may have created the first account after our initial
  // read. Re-select instead of assuming this insert won so callers receive
  // the canonical id and its current balance in both paths.
  return (
    tx
      .select({ id: loyaltyAccounts.id, points: loyaltyAccounts.points })
      .from(loyaltyAccounts)
      .where(
        and(eq(loyaltyAccounts.tenantId, tenantId), eq(loyaltyAccounts.customerId, customerId))
      )
      .get() ?? null
  );
}

/** Append a movement and move the balance in lockstep (same tx). */
function appendMovement(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    accountId: string;
    saleId: string | null;
    saleReturnId?: string | null;
    salePaymentId?: string | null;
    sourceMovementId?: string | null;
    kind: 'earn' | 'redeem' | 'adjust' | 'revert' | 'restore';
    points: number;
    rateAtEarn?: number | null;
    valuePerPoint?: number | null;
    moneyAmount?: number | null;
    currencyCode?: string | null;
    note?: string | null;
    createdBy?: string | null;
    nowIso: string;
    /** Redemption/adjustment fail closed; returns and voids may create debt. */
    allowNegativeBalance?: boolean;
  }
): string {
  const id = nanoid();
  tx.insert(loyaltyMovements)
    .values({
      id,
      tenantId: args.tenantId,
      accountId: args.accountId,
      saleId: args.saleId,
      saleReturnId: args.saleReturnId ?? null,
      salePaymentId: args.salePaymentId ?? null,
      sourceMovementId: args.sourceMovementId ?? null,
      kind: args.kind,
      points: args.points,
      rateAtEarn: args.rateAtEarn ?? null,
      valuePerPoint: args.valuePerPoint ?? null,
      moneyAmount: args.moneyAmount ?? null,
      currencyCode: args.currencyCode ?? null,
      note: args.note ?? null,
      createdBy: args.createdBy ?? null,
      createdAt: args.nowIso,
    })
    .run();
  // Balance moves with the ledger, never independently.
  const updated = tx
    .update(loyaltyAccounts)
    .set({
      points: sql`${loyaltyAccounts.points} + ${args.points}`,
      updatedAt: args.nowIso,
    })
    .where(
      and(
        eq(loyaltyAccounts.id, args.accountId),
        eq(loyaltyAccounts.tenantId, args.tenantId),
        ...(args.points < 0 && args.allowNegativeBalance !== true
          ? [gte(loyaltyAccounts.points, Math.abs(args.points))]
          : [])
      )
    )
    .run();
  if (updated.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOYALTY_INSUFFICIENT_POINTS',
      message: 'The customer does not have enough points for this operation',
    });
  }
  return id;
}

/**
 * Revert the proportional earned-points liability of one normalized return.
 * The target is cumulative, so repeated partial returns absorb integer
 * rounding deterministically and the final return removes the exact balance.
 */
export function revertPointsForReturn(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    saleId: string;
    saleReturnId: string;
    saleTotal: number;
    cumulativeRefundAmount: number;
    fullyReturned: boolean;
    nowIso?: string;
  }
): number {
  const earned = tx
    .select({
      id: loyaltyMovements.id,
      accountId: loyaltyMovements.accountId,
      points: loyaltyMovements.points,
    })
    .from(loyaltyMovements)
    .where(
      and(
        eq(loyaltyMovements.tenantId, args.tenantId),
        eq(loyaltyMovements.saleId, args.saleId),
        eq(loyaltyMovements.kind, 'earn')
      )
    )
    .get();
  if (!earned || earned.points <= 0 || args.saleTotal <= 0) return 0;

  const existingForReturn = tx
    .select({ id: loyaltyMovements.id })
    .from(loyaltyMovements)
    .where(
      and(
        eq(loyaltyMovements.tenantId, args.tenantId),
        eq(loyaltyMovements.saleReturnId, args.saleReturnId),
        eq(loyaltyMovements.kind, 'revert'),
        eq(loyaltyMovements.sourceMovementId, earned.id)
      )
    )
    .get();
  if (existingForReturn) return 0;

  const prior = tx
    .select({ points: loyaltyMovements.points })
    .from(loyaltyMovements)
    .where(
      and(
        eq(loyaltyMovements.tenantId, args.tenantId),
        eq(loyaltyMovements.saleId, args.saleId),
        eq(loyaltyMovements.kind, 'revert'),
        eq(loyaltyMovements.sourceMovementId, earned.id)
      )
    )
    .all()
    .reduce((sum, row) => sum + Math.abs(row.points), 0);
  const target = args.fullyReturned
    ? earned.points
    : Math.floor(
        earned.points * Math.min(1, Math.max(0, args.cumulativeRefundAmount / args.saleTotal))
      );
  const points = Math.max(0, target - prior);
  if (points === 0) return 0;

  appendMovement(tx, {
    tenantId: args.tenantId,
    accountId: earned.accountId,
    saleId: args.saleId,
    saleReturnId: args.saleReturnId,
    sourceMovementId: earned.id,
    kind: 'revert',
    points: -points,
    nowIso: args.nowIso ?? new Date().toISOString(),
    allowNegativeBalance: true,
  });
  return points;
}

/**
 * Earn points for a completed sale. MUST run inside the sale's transaction.
 * Returns the points earned (0 when the program is off, the sale has no
 * customer, the total earns nothing, or the sale already earned).
 *
 * Idempotent by design: the partial unique index on (account, sale) WHERE
 * kind='earn' makes a retried completion a no-op instead of double-crediting.
 */
export function earnPointsForSale(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    customerId: string | null;
    saleId: string;
    total: number;
    settings: LoyaltySettings;
    nowIso?: string;
  }
): number {
  if (!args.settings.enabled || !args.customerId) return 0;
  const points = pointsForTotal(args.total, args.settings.pointsPerUnit);
  if (points <= 0) return 0;

  const nowIso = args.nowIso ?? new Date().toISOString();
  const account = ensureAccount(tx, args.tenantId, args.customerId, nowIso);
  if (!account) return 0;

  const alreadyEarned = tx
    .select({ id: loyaltyMovements.id })
    .from(loyaltyMovements)
    .where(
      and(
        eq(loyaltyMovements.accountId, account.id),
        eq(loyaltyMovements.saleId, args.saleId),
        eq(loyaltyMovements.kind, 'earn')
      )
    )
    .get();
  if (alreadyEarned) return 0;

  appendMovement(tx, {
    tenantId: args.tenantId,
    accountId: account.id,
    saleId: args.saleId,
    kind: 'earn',
    points,
    rateAtEarn: args.settings.pointsPerUnit,
    nowIso,
  });
  return points;
}

export interface LoyaltyRedemptionResult {
  accountId: string;
  movementId: string;
  points: number;
  balanceAfter: number;
}

/** Debit one server-priced loyalty tender inside the enclosing sale tx. */
export function redeemPointsForPayment(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    customerId: string | null;
    saleId: string;
    salePaymentId: string;
    points: number;
    amount: number;
    currencyCode: string;
    settings: LoyaltySettings;
    createdBy: string;
    nowIso: string;
  }
): LoyaltyRedemptionResult {
  if (!args.customerId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CUSTOMER_VALUE_TENDER_CUSTOMER_REQUIRED',
      message: 'Loyalty redemption requires a customer',
    });
  }
  if (!args.settings.enabled || !args.settings.redemptionEnabled) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOYALTY_REDEMPTION_DISABLED',
      message: 'Loyalty redemption is not enabled for this business',
    });
  }
  if (!Number.isInteger(args.points) || args.points <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOYALTY_TENDER_AMOUNT_MISMATCH',
      message: 'Loyalty redemption requires a positive whole-points amount',
    });
  }
  const amount = roundMoney(args.amount);
  const expectedAmount = roundMoney(args.points * args.settings.valuePerPoint);
  if (amount !== expectedAmount) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOYALTY_TENDER_AMOUNT_MISMATCH',
      message: 'The loyalty tender does not match the configured point value',
      details: { points: args.points, expectedAmount, receivedAmount: amount },
    });
  }
  const account = tx
    .select({ id: loyaltyAccounts.id, points: loyaltyAccounts.points })
    .from(loyaltyAccounts)
    .where(
      and(
        eq(loyaltyAccounts.tenantId, args.tenantId),
        eq(loyaltyAccounts.customerId, args.customerId)
      )
    )
    .get();
  if (!account || account.points < args.points) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOYALTY_INSUFFICIENT_POINTS',
      message: 'The customer does not have enough points',
      details: { balance: account?.points ?? 0, requested: args.points },
    });
  }
  const movementId = appendMovement(tx, {
    tenantId: args.tenantId,
    accountId: account.id,
    saleId: args.saleId,
    salePaymentId: args.salePaymentId,
    kind: 'redeem',
    points: -args.points,
    valuePerPoint: args.settings.valuePerPoint,
    moneyAmount: amount,
    currencyCode: args.currencyCode,
    createdBy: args.createdBy,
    nowIso: args.nowIso,
  });
  return {
    accountId: account.id,
    movementId,
    points: args.points,
    balanceAfter: account.points - args.points,
  };
}

function restoreRedemption(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    saleId: string;
    saleReturnId: string | null;
    salePaymentId: string;
    points: number | null;
    amount: number | null;
    createdBy: string;
    nowIso: string;
  }
): LoyaltyRedemptionResult | null {
  const source = tx
    .select({
      id: loyaltyMovements.id,
      accountId: loyaltyMovements.accountId,
      points: loyaltyMovements.points,
      valuePerPoint: loyaltyMovements.valuePerPoint,
      moneyAmount: loyaltyMovements.moneyAmount,
      currencyCode: loyaltyMovements.currencyCode,
    })
    .from(loyaltyMovements)
    .where(
      and(
        eq(loyaltyMovements.tenantId, args.tenantId),
        eq(loyaltyMovements.salePaymentId, args.salePaymentId),
        eq(loyaltyMovements.kind, 'redeem')
      )
    )
    .get();
  if (!source) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOYALTY_TENDER_SOURCE_MISSING',
      message: 'The original loyalty redemption could not be verified',
    });
  }
  const sourcePoints = Math.abs(source.points);
  const alreadyRestored = tx
    .select({ points: loyaltyMovements.points })
    .from(loyaltyMovements)
    .where(
      and(
        eq(loyaltyMovements.tenantId, args.tenantId),
        eq(loyaltyMovements.sourceMovementId, source.id),
        eq(loyaltyMovements.kind, 'restore')
      )
    )
    .all()
    .reduce((sum, movement) => sum + Math.max(0, movement.points), 0);
  const points = args.points ?? sourcePoints - alreadyRestored;
  if (!Number.isInteger(points) || points < 0 || alreadyRestored + points > sourcePoints) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOYALTY_TENDER_RESTORE_INVALID',
      message: 'The loyalty restoration exceeds the original redemption',
    });
  }
  if (points === 0) return null;
  const account = tx
    .select({ points: loyaltyAccounts.points })
    .from(loyaltyAccounts)
    .where(
      and(eq(loyaltyAccounts.id, source.accountId), eq(loyaltyAccounts.tenantId, args.tenantId))
    )
    .get();
  if (!account) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOYALTY_TENDER_SOURCE_MISSING',
      message: 'The loyalty account could not be verified',
    });
  }
  const movementId = appendMovement(tx, {
    tenantId: args.tenantId,
    accountId: source.accountId,
    saleId: args.saleId,
    saleReturnId: args.saleReturnId,
    sourceMovementId: source.id,
    kind: 'restore',
    points,
    valuePerPoint: source.valuePerPoint,
    moneyAmount: roundMoney(
      args.amount ?? source.moneyAmount ?? points * (source.valuePerPoint ?? 0)
    ),
    currencyCode: source.currencyCode,
    createdBy: args.createdBy,
    nowIso: args.nowIso,
    allowNegativeBalance: true,
  });
  return {
    accountId: source.accountId,
    movementId,
    points,
    balanceAfter: account.points + points,
  };
}

export function restorePointsForReturn(
  tx: DatabaseInstance,
  args: Omit<Parameters<typeof restoreRedemption>[1], 'saleReturnId'> & {
    saleReturnId: string;
    amount: number;
  }
): LoyaltyRedemptionResult | null {
  return restoreRedemption(tx, args);
}

export function restorePointsForVoid(
  tx: DatabaseInstance,
  args: Omit<Parameters<typeof restoreRedemption>[1], 'saleReturnId' | 'points' | 'amount'>
): LoyaltyRedemptionResult | null {
  return restoreRedemption(tx, { ...args, saleReturnId: null, points: null, amount: null });
}

/**
 * Revert the earn of a reversed sale. MUST run inside the reversal's
 * transaction. Appends a negative `revert` row (history is never erased) and
 * is idempotent: a second reversal finds the earn already reverted and does
 * nothing. Returns the points taken back (0 when there was no earn).
 */
export function revertPointsForSale(
  tx: DatabaseInstance,
  args: { tenantId: string; saleId: string; nowIso?: string }
): number {
  const earned = tx
    .select({
      id: loyaltyMovements.id,
      accountId: loyaltyMovements.accountId,
      points: loyaltyMovements.points,
    })
    .from(loyaltyMovements)
    .where(
      and(
        eq(loyaltyMovements.tenantId, args.tenantId),
        eq(loyaltyMovements.saleId, args.saleId),
        eq(loyaltyMovements.kind, 'earn')
      )
    )
    .get();
  if (!earned) return 0;

  const alreadyReverted = tx
    .select({ id: loyaltyMovements.id })
    .from(loyaltyMovements)
    .where(
      and(
        eq(loyaltyMovements.tenantId, args.tenantId),
        eq(loyaltyMovements.saleId, args.saleId),
        eq(loyaltyMovements.kind, 'revert'),
        eq(loyaltyMovements.sourceMovementId, earned.id)
      )
    )
    .get();
  if (alreadyReverted) return 0;

  const nowIso = args.nowIso ?? new Date().toISOString();
  appendMovement(tx, {
    tenantId: args.tenantId,
    accountId: earned.accountId,
    saleId: args.saleId,
    sourceMovementId: earned.id,
    kind: 'revert',
    points: -earned.points,
    nowIso,
    allowNegativeBalance: true,
  });
  return earned.points;
}

/** One ledger row as the customer surface renders it. */
export interface LoyaltyMovementRow {
  id: string;
  saleId: string | null;
  kind: string;
  points: number;
  note: string | null;
  createdAt: string;
}

/** The customer's balance + recent ledger. Balance 0 with an empty ledger
 * when the customer never earned (no account row is created on read). */
export async function getLoyaltyForCustomer(
  db: DatabaseInstance,
  args: { tenantId: string; customerId: string; limit?: number }
): Promise<{ points: number; movements: LoyaltyMovementRow[] }> {
  const account = await db
    .select({ id: loyaltyAccounts.id, points: loyaltyAccounts.points })
    .from(loyaltyAccounts)
    .where(
      and(
        eq(loyaltyAccounts.tenantId, args.tenantId),
        eq(loyaltyAccounts.customerId, args.customerId)
      )
    )
    .get();
  if (!account) return { points: 0, movements: [] };

  const movements = await db
    .select({
      id: loyaltyMovements.id,
      saleId: loyaltyMovements.saleId,
      kind: loyaltyMovements.kind,
      points: loyaltyMovements.points,
      note: loyaltyMovements.note,
      createdAt: loyaltyMovements.createdAt,
    })
    .from(loyaltyMovements)
    .where(
      and(eq(loyaltyMovements.tenantId, args.tenantId), eq(loyaltyMovements.accountId, account.id))
    )
    .orderBy(sql`${loyaltyMovements.createdAt} DESC`)
    .limit(args.limit ?? 20)
    .all();
  return { points: account.points, movements };
}

/**
 * Manual owner correction (admin surface). Positive or negative, never
 * zero; a negative adjust may not push the balance below zero — points are
 * money-like and a negative balance is a support incident, not a state.
 */
export function adjustPoints(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    customerId: string;
    actorId: string;
    points: number;
    note: string;
  }
): { points: number } {
  const nowIso = new Date().toISOString();
  return db.transaction(
    tx => {
      const account = ensureAccount(tx, args.tenantId, args.customerId, nowIso);
      if (!account) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'LOYALTY_CUSTOMER_NOT_FOUND',
          message: 'Customer not found for this tenant',
          details: { customerId: args.customerId },
        });
      }
      if (account.points + args.points < 0) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'LOYALTY_INSUFFICIENT_POINTS',
          message: 'The adjustment would leave a negative balance',
          details: { customerId: args.customerId, balance: account.points, points: args.points },
        });
      }
      appendMovement(tx, {
        tenantId: args.tenantId,
        accountId: account.id,
        saleId: null,
        kind: 'adjust',
        points: args.points,
        note: args.note,
        createdBy: args.actorId,
        nowIso,
      });
      return { points: account.points + args.points };
    },
    { behavior: 'immediate' }
  );
}
