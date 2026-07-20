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
 * Redemption as a `loyalty` tender is deliberately NOT here: it touches the
 * payment split and is tracked as its own slice.
 *
 * @module services/loyalty
 */

import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import { loyaltyAccounts, loyaltyMovements, customers, tenants } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';

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
}

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: false,
  pointsPerUnit: 0.001,
};

/** Bounds mirrored by the Zod input; enforced here because the blob is
 * free-form JSON a bad edit could corrupt. */
export const MAX_POINTS_PER_UNIT = 100;

function normalizePointsPerUnit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MAX_POINTS_PER_UNIT) {
    return DEFAULT_LOYALTY_SETTINGS.pointsPerUnit;
  }
  return raw;
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
  const blob = (tenant?.settings ?? {}) as Record<string, unknown>;
  const loyalty = (blob.loyalty ?? {}) as Partial<LoyaltySettings>;
  return {
    enabled: typeof loyalty.enabled === 'boolean' ? loyalty.enabled : false,
    pointsPerUnit: normalizePointsPerUnit(loyalty.pointsPerUnit),
  };
}

/** Persist (a partial patch of) `tenants.settings.loyalty`. */
export async function writeLoyaltySettings(
  db: DatabaseInstance,
  tenantId: string,
  patch: Partial<LoyaltySettings>
): Promise<LoyaltySettings> {
  const current = await resolveLoyaltySettings(db, tenantId);
  if (patch.enabled === undefined && patch.pointsPerUnit === undefined) {
    return current;
  }
  const next: LoyaltySettings = {
    enabled: patch.enabled ?? current.enabled,
    pointsPerUnit:
      patch.pointsPerUnit === undefined
        ? current.pointsPerUnit
        : normalizePointsPerUnit(patch.pointsPerUnit),
  };

  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
  settings.loyalty = next;
  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date().toISOString() })
    .where(eq(tenants.id, tenantId));
  return next;
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
    kind: 'earn' | 'redeem' | 'adjust' | 'revert';
    points: number;
    rateAtEarn?: number | null;
    note?: string | null;
    createdBy?: string | null;
    nowIso: string;
  }
): string {
  const id = nanoid();
  tx.insert(loyaltyMovements)
    .values({
      id,
      tenantId: args.tenantId,
      accountId: args.accountId,
      saleId: args.saleId,
      kind: args.kind,
      points: args.points,
      rateAtEarn: args.rateAtEarn ?? null,
      note: args.note ?? null,
      createdBy: args.createdBy ?? null,
      createdAt: args.nowIso,
    })
    .run();
  // Balance moves with the ledger, never independently.
  tx.update(loyaltyAccounts)
    .set({
      points: sql`${loyaltyAccounts.points} + ${args.points}`,
      updatedAt: args.nowIso,
    })
    .where(eq(loyaltyAccounts.id, args.accountId))
    .run();
  return id;
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
        eq(loyaltyMovements.kind, 'revert')
      )
    )
    .get();
  if (alreadyReverted) return 0;

  const nowIso = args.nowIso ?? new Date().toISOString();
  appendMovement(tx, {
    tenantId: args.tenantId,
    accountId: earned.accountId,
    saleId: args.saleId,
    kind: 'revert',
    points: -earned.points,
    nowIso,
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
    .where(eq(loyaltyMovements.accountId, account.id))
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
  return db.transaction(tx => {
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
  });
}
