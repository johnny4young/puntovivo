/**
 * ENG-199 — expiry-radar discount suggestions (WC-C3).
 *
 * The radar (Inventario → Vencimientos) lists lots expiring soon; its CTA
 * records a DISCOUNT SUGGESTION computed from a deterministic tier rule.
 * This module owns that lifecycle:
 *
 * - the tier rule (`EXPIRY_DISCOUNT_TIERS` / `suggestedDiscountPctForExpiry`)
 *   — exported constants so a future tenant setting can replace them without
 *   rewriting callers (same posture as the ENG-195 margin thresholds);
 * - `createExpirySuggestion` / `dismissSuggestion` — the two mutations, each
 *   atomic with its `writeAuditLog` row (the AC is that the CTA leaves an
 *   audit trail);
 * - `listActiveSuggestions` — the read the POS badge and the radar share.
 *   Its shape deliberately carries NO cost fields: the POS caller is a
 *   cashier and lot costs are owner data.
 *
 * A suggestion has no `expired` status: read-side filtering hides it as soon
 * as its lot depletes, deactivates, or passes its expiry — no sweeper runs.
 * v2 (WC-D1 price lists) will consume the same table to emit real promos.
 *
 * @module services/price-suggestions
 */

import { and, eq, gt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import { inventoryLots, priceSuggestions, products } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import { writeAuditLog } from './audit-logs.js';

/**
 * One tier of the deterministic expiry-discount rule: lots expiring within
 * `maxDays` days earn a `pct` percent suggestion. Tiers are evaluated in
 * order, first match wins, so the array MUST stay sorted ascending by
 * `maxDays`.
 */
export interface ExpiryDiscountTier {
  maxDays: number;
  pct: number;
}

/**
 * The v1 rule from the WC-C3 spec: ≤7 days → 30%, ≤15 → 20%, ≤30 → 10%.
 * Exported so the radar UI can show the would-be percent per row and so a
 * future tenant setting can override the values in one place.
 */
export const EXPIRY_DISCOUNT_TIERS: readonly ExpiryDiscountTier[] = [
  { maxDays: 7, pct: 30 },
  { maxDays: 15, pct: 20 },
  { maxDays: 30, pct: 10 },
];

/** Milliseconds in a UTC day — the tier rule counts whole calendar days up. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The tier percent for a lot expiring at `expiresAt`, evaluated at `nowIso`.
 * Returns `null` when the lot has no expiry, is already expired (the radar
 * exists to sell BEFORE expiry, not to discount spoiled goods), or falls
 * outside the largest tier window. Day distance rounds UP: a lot expiring
 * in 6.2 days is 7 days out.
 *
 * ENG-211 — `tiers` defaults to the built-in ladder so existing callers and
 * the pure rule tests are unchanged; the router passes the tenant's tuned
 * ladder (`services/discount-settings`). The parameter direction matters:
 * this module must NOT import the settings service, or the two would form
 * an import cycle (settings reads the default ladder from here).
 */
export function suggestedDiscountPctForExpiry(
  expiresAt: string | null,
  nowIso: string,
  tiers: readonly ExpiryDiscountTier[] = EXPIRY_DISCOUNT_TIERS
): number | null {
  if (!expiresAt) return null;
  const expiry = Date.parse(expiresAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(expiry) || Number.isNaN(now)) return null;
  if (expiry < now) return null;
  const daysUntil = Math.ceil((expiry - now) / DAY_MS);
  for (const tier of tiers) {
    if (daysUntil <= tier.maxDays) return tier.pct;
  }
  return null;
}

/**
 * One row of `listActiveSuggestions` — the shared POS-badge / radar shape.
 * Deliberately cost-free: cashiers consume this payload.
 */
export interface ActivePriceSuggestion {
  id: string;
  productId: string;
  lotId: string;
  lotNumber: string;
  discountPct: number;
  lotExpiresAt: string | null;
  productName: string;
}

interface SuggestionActorInput {
  tenantId: string;
  actorId: string;
}

/** Keep the duplicate response stable for both the optimistic pre-check and
 * the database-level race guard. */
function throwActiveSuggestionConflict(lotId: string): never {
  return throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'LOT_DISCOUNT_ALREADY_ACTIVE',
    message: 'The lot already has an active discount suggestion',
    details: { lotId },
  });
}

/**
 * SQLite reports the partial active-lot index as this exact unique-key shape.
 * Do not convert unrelated unique failures (for example an improbable id
 * collision) into a misleading domain conflict.
 */
function isActiveLotUniqueConstraint(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    typeof candidate.message === 'string' &&
    candidate.message.includes('price_suggestions.tenant_id') &&
    candidate.message.includes('price_suggestions.lot_id')
  );
}

/**
 * Record an expiry-discount suggestion for a lot. Validates that the lot
 * belongs to the tenant, is active with stock, and falls inside a tier
 * window; computes the percent SERVER-side (the client never chooses it);
 * inserts the suggestion and its audit row in one transaction. The partial
 * unique index `(tenant_id, lot_id) WHERE status='active'` makes the
 * duplicate guard race-safe — the insert maps its constraint race back to
 * LOT_DISCOUNT_ALREADY_ACTIVE, never a generic SQLite error or two active
 * rows.
 */
export function createExpirySuggestion(
  db: DatabaseInstance,
  input: SuggestionActorInput & {
    lotId: string;
    /** ENG-211 — the tenant's tuned ladder; omit for the built-in default. */
    tiers?: readonly ExpiryDiscountTier[];
  }
): ActivePriceSuggestion {
  const nowIso = new Date().toISOString();
  return db.transaction(tx => {
    const lot = tx
      .select({
        id: inventoryLots.id,
        siteId: inventoryLots.siteId,
        productId: inventoryLots.productId,
        lotNumber: inventoryLots.lotNumber,
        expiresAt: inventoryLots.expiresAt,
        onHand: inventoryLots.onHand,
        status: inventoryLots.status,
        productName: products.name,
      })
      .from(inventoryLots)
      .innerJoin(products, eq(inventoryLots.productId, products.id))
      .where(and(eq(inventoryLots.tenantId, input.tenantId), eq(inventoryLots.id, input.lotId)))
      .get();

    if (!lot) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'LOT_NOT_FOUND',
        message: 'Lot not found for this tenant',
        details: { lotId: input.lotId },
      });
    }
    if (lot.status !== 'active' || lot.onHand <= 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'LOT_DISCOUNT_NOT_ELIGIBLE',
        message: 'The lot has no sellable stock to discount',
        details: { lotId: input.lotId, reason: 'no_stock' },
      });
    }
    const discountPct = suggestedDiscountPctForExpiry(lot.expiresAt, nowIso, input.tiers);
    if (discountPct === null) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'LOT_DISCOUNT_NOT_ELIGIBLE',
        message: 'The lot expiry is missing, already past, or outside the discount window',
        details: { lotId: input.lotId, reason: 'expiry_out_of_window' },
      });
    }

    const existing = tx
      .select({ id: priceSuggestions.id })
      .from(priceSuggestions)
      .where(
        and(
          eq(priceSuggestions.tenantId, input.tenantId),
          eq(priceSuggestions.lotId, input.lotId),
          eq(priceSuggestions.status, 'active')
        )
      )
      .get();
    if (existing) {
      throwActiveSuggestionConflict(input.lotId);
    }

    const id = nanoid();
    try {
      tx.insert(priceSuggestions)
        .values({
          id,
          tenantId: input.tenantId,
          siteId: lot.siteId,
          productId: lot.productId,
          lotId: lot.id,
          discountPct,
          reason: 'expiry',
          lotExpiresAt: lot.expiresAt,
          status: 'active',
          createdBy: input.actorId,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
    } catch (error) {
      if (isActiveLotUniqueConstraint(error)) {
        throwActiveSuggestionConflict(input.lotId);
      }
      throw error;
    }

    writeAuditLog({
      tx,
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'inventory.lot.discount_suggested',
      resourceType: 'price_suggestion',
      resourceId: id,
      after: { discountPct, status: 'active' },
      metadata: {
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        productId: lot.productId,
        productName: lot.productName,
        lotExpiresAt: lot.expiresAt,
      },
    });

    return {
      id,
      productId: lot.productId,
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      discountPct,
      lotExpiresAt: lot.expiresAt,
      productName: lot.productName,
    };
  });
}

/**
 * Retire an active suggestion (radar "Descartar"). Keeps the row for audit;
 * the dismissal itself is audited too. Targeting a missing, foreign-tenant,
 * or already-dismissed suggestion throws PRICE_SUGGESTION_NOT_FOUND.
 */
export function dismissSuggestion(
  db: DatabaseInstance,
  input: SuggestionActorInput & { suggestionId: string }
): void {
  const nowIso = new Date().toISOString();
  db.transaction(tx => {
    const suggestion = tx
      .select({
        id: priceSuggestions.id,
        lotId: priceSuggestions.lotId,
        productId: priceSuggestions.productId,
        discountPct: priceSuggestions.discountPct,
        status: priceSuggestions.status,
        lotNumber: inventoryLots.lotNumber,
        productName: products.name,
      })
      .from(priceSuggestions)
      .innerJoin(inventoryLots, eq(priceSuggestions.lotId, inventoryLots.id))
      .innerJoin(products, eq(priceSuggestions.productId, products.id))
      .where(
        and(
          eq(priceSuggestions.tenantId, input.tenantId),
          eq(priceSuggestions.id, input.suggestionId)
        )
      )
      .get();
    if (!suggestion || suggestion.status !== 'active') {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'PRICE_SUGGESTION_NOT_FOUND',
        message: 'Active price suggestion not found for this tenant',
        details: { suggestionId: input.suggestionId },
      });
    }

    tx.update(priceSuggestions)
      .set({ status: 'dismissed', updatedAt: nowIso })
      .where(
        and(
          eq(priceSuggestions.tenantId, input.tenantId),
          eq(priceSuggestions.id, input.suggestionId)
        )
      )
      .run();

    writeAuditLog({
      tx,
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'inventory.lot.discount_suggestion_dismissed',
      resourceType: 'price_suggestion',
      resourceId: suggestion.id,
      before: { discountPct: suggestion.discountPct, status: 'active' },
      after: { status: 'dismissed' },
      metadata: {
        lotId: suggestion.lotId,
        lotNumber: suggestion.lotNumber,
        productId: suggestion.productId,
        productName: suggestion.productName,
      },
    });
  });
}

/**
 * Active suggestions whose lot can still honor them: lot active, stock on
 * hand, and whose expiry snapshot has not passed. This read-side filter is
 * why the table needs no sweeper — a depleted or expired suggestion silently
 * drops off the POS badge and the radar even if the live lot is edited later.
 */
export function listActiveSuggestions(
  db: DatabaseInstance,
  args: { tenantId: string; siteId?: string }
): ActivePriceSuggestion[] {
  const nowIso = new Date().toISOString();
  const conditions = [
    eq(priceSuggestions.tenantId, args.tenantId),
    eq(priceSuggestions.status, 'active'),
    eq(inventoryLots.status, 'active'),
    gt(inventoryLots.onHand, 0),
    sql`${priceSuggestions.lotExpiresAt} >= ${nowIso}`,
  ];
  if (args.siteId) {
    conditions.push(eq(priceSuggestions.siteId, args.siteId));
  }
  return db
    .select({
      id: priceSuggestions.id,
      productId: priceSuggestions.productId,
      lotId: priceSuggestions.lotId,
      lotNumber: inventoryLots.lotNumber,
      discountPct: priceSuggestions.discountPct,
      lotExpiresAt: priceSuggestions.lotExpiresAt,
      productName: products.name,
    })
    .from(priceSuggestions)
    .innerJoin(inventoryLots, eq(priceSuggestions.lotId, inventoryLots.id))
    .innerJoin(products, eq(priceSuggestions.productId, products.id))
    .where(and(...conditions))
    .all();
}
