/** Authoritative promotion lifecycle, eligibility and checkout pricing. */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import {
  categories,
  customers,
  inventoryLots,
  pharmacyProductProfiles,
  priceSuggestions,
  products,
  promotions,
  saleItemPromotions,
  sites,
  tenants,
} from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import { roundMoney } from '../lib/money.js';
import { writeAuditLog } from './audit-logs.js';
import { isLotExpiredAt } from './inventory-lots/index.js';
import { resolveUtcDayWindow } from './reports/day-window.js';
import { listLotsForProduct } from './inventory-lots/queries.js';
import { assertTenantBusinessClockCurrent } from './pharmacy/business-clock.js';
import { enqueueSyncInTransaction, type EnqueueSyncContext } from './sync/enqueue.js';
import {
  calculateTaxComponentSnapshots,
  type TaxComponentDefinition,
  type TaxComponentSnapshot,
} from './tax-components.js';

export const MAX_STACKED_PROMOTIONS = 10;

export interface PromotionRuleInput {
  name: string;
  discountPct: number;
  siteId?: string | null | undefined;
  productId?: string | null | undefined;
  categoryId?: string | null | undefined;
  customerId?: string | null | undefined;
  minQuantity: number;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
  priority: number;
  combinable: boolean;
}

export interface PromotionPricingLine {
  lineKey: string;
  productId: string;
  categoryId: string | null;
  quantity: number;
  normalizedQuantity: number;
  unitPrice: number;
  manualDiscountRate: number;
  taxComponents: readonly TaxComponentDefinition[];
  tracksLots: boolean;
  /** Frozen allocations for a persisted draft; fresh carts omit this and use FEFO. */
  lotAllocations?: readonly {
    lotId: string;
    quantity: number;
    sellable: boolean;
  }[];
}

export interface AppliedPromotionSnapshot {
  promotionId: string;
  promotionVersion: number;
  name: string;
  discountPct: number;
  discountAmount: number;
  priority: number;
  combinable: boolean;
  position: number;
  source: 'manual' | 'expiry';
  sourceLotId: string | null;
}

export interface PromotionPricedLine {
  lineKey: string;
  productId: string;
  manualDiscountRate: number;
  effectiveDiscountRate: number;
  lineBase: number;
  lineTax: number;
  lineTotal: number;
  taxComponents: TaxComponentSnapshot[];
  promotionDiscountAmount: number;
  promotions: AppliedPromotionSnapshot[];
}

export interface PromotionCheckoutQuote {
  fingerprint: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  promotionDiscountAmount: number;
  lines: PromotionPricedLine[];
}

type PromotionRow = typeof promotions.$inferSelect;
type PromotionSyncContext = Pick<EnqueueSyncContext, 'envelope' | 'deviceId'>;

function enqueuePromotionChange(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    id: string;
    operation: 'create' | 'update';
    sync?: PromotionSyncContext | undefined;
  }
): string {
  const row = tx
    .select()
    .from(promotions)
    .where(and(eq(promotions.tenantId, args.tenantId), eq(promotions.id, args.id)))
    .get();
  if (!row) promotionError('PROMOTION_NOT_FOUND', 'Promotion not found after mutation');
  return enqueueSyncInTransaction(
    {
      db: tx,
      tenantId: args.tenantId,
      envelope: args.sync?.envelope ?? null,
      deviceId: args.sync?.deviceId ?? null,
    },
    {
      entityType: 'promotions',
      entityId: row.id,
      operation: args.operation,
      data: { ...row },
    }
  ).id;
}

function promotionError(
  errorCode:
    | 'PROMOTION_NOT_FOUND'
    | 'PROMOTION_TARGET_INVALID'
    | 'PROMOTION_STATE_INVALID'
    | 'PROMOTION_QUOTE_STALE'
    | 'PROMOTION_EXPIRY_PHARMACY_FORBIDDEN',
  message: string,
  details?: Record<string, unknown>
): never {
  throwServerError({ trpcCode: 'BAD_REQUEST', errorCode, message, details });
}

function normalizeNullable(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

function normalizeTimestamp(value: string | null | undefined): string | null {
  const normalized = normalizeNullable(value);
  if (!normalized) return null;
  const epoch = Date.parse(normalized);
  if (!Number.isFinite(epoch)) {
    promotionError('PROMOTION_TARGET_INVALID', 'Promotion dates must be valid timestamps');
  }
  return new Date(epoch).toISOString();
}

function normalizedRule(input: PromotionRuleInput) {
  return {
    name: input.name.trim(),
    discountPct: roundMoney(input.discountPct),
    siteId: normalizeNullable(input.siteId),
    productId: normalizeNullable(input.productId),
    categoryId: normalizeNullable(input.categoryId),
    customerId: normalizeNullable(input.customerId),
    minQuantity: input.minQuantity,
    // SQLite compares these TEXT values lexicographically. Canonical UTC is
    // therefore part of the persistence contract; retaining arbitrary valid
    // offsets would make chronologically ordered windows compare incorrectly.
    startsAt: normalizeTimestamp(input.startsAt),
    endsAt: normalizeTimestamp(input.endsAt),
    priority: input.priority,
    combinable: input.combinable,
  };
}

function normalizeRate(value: number): number {
  const normalized = Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function assertRuleShape(input: ReturnType<typeof normalizedRule>): void {
  if (!input.name || input.name.length > 120) {
    promotionError('PROMOTION_TARGET_INVALID', 'Promotion name is required and must be concise');
  }
  if (!(input.discountPct > 0) || input.discountPct > 100) {
    promotionError('PROMOTION_TARGET_INVALID', 'Promotion discount must be between 0 and 100');
  }
  if (!(input.minQuantity > 0) || !Number.isFinite(input.minQuantity)) {
    promotionError('PROMOTION_TARGET_INVALID', 'Promotion minimum quantity must be positive');
  }
  if (input.productId && input.categoryId) {
    promotionError(
      'PROMOTION_TARGET_INVALID',
      'A promotion may target a product or a category, not both'
    );
  }
  if (input.startsAt && input.endsAt && input.startsAt >= input.endsAt) {
    promotionError('PROMOTION_TARGET_INVALID', 'Promotion end must be after its start');
  }
}

function assertTenantTargets(
  db: DatabaseInstance,
  tenantId: string,
  input: ReturnType<typeof normalizedRule>
): void {
  const targetExists =
    (!input.siteId ||
      Boolean(
        db
          .select({ id: sites.id })
          .from(sites)
          .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, tenantId)))
          .get()
      )) &&
    (!input.productId ||
      Boolean(
        db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, input.productId), eq(products.tenantId, tenantId)))
          .get()
      )) &&
    (!input.categoryId ||
      Boolean(
        db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.id, input.categoryId), eq(categories.tenantId, tenantId)))
          .get()
      )) &&
    (!input.customerId ||
      Boolean(
        db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId)))
          .get()
      ));
  if (!targetExists) {
    promotionError('PROMOTION_TARGET_INVALID', 'Promotion target does not belong to this business');
  }
}

/** Create an inert draft; activation is always a second explicit action. */
export function createPromotion(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    actorId: string;
    rule: PromotionRuleInput;
    sync?: PromotionSyncContext | undefined;
  }
): PromotionRow {
  const rule = normalizedRule(args.rule);
  assertRuleShape(rule);
  const now = new Date().toISOString();
  const id = nanoid();
  db.transaction(
    tx => {
      assertTenantTargets(tx, args.tenantId, rule);
      tx.insert(promotions)
        .values({
          id,
          tenantId: args.tenantId,
          ...rule,
          status: 'draft',
          source: 'manual',
          version: 1,
          createdBy: args.actorId,
          updatedBy: args.actorId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: 'promotion.create',
        resourceType: 'promotion',
        resourceId: id,
        after: { ...rule, status: 'draft', version: 1 },
      });
      enqueuePromotionChange(tx, {
        tenantId: args.tenantId,
        id,
        operation: 'create',
        sync: args.sync,
      });
    },
    { behavior: 'immediate' }
  );
  return db
    .select()
    .from(promotions)
    .where(and(eq(promotions.tenantId, args.tenantId), eq(promotions.id, id)))
    .get()!;
}

export function updatePromotion(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    actorId: string;
    id: string;
    version: number;
    rule: PromotionRuleInput;
    sync?: PromotionSyncContext | undefined;
  }
): PromotionRow {
  const rule = normalizedRule(args.rule);
  assertRuleShape(rule);
  const now = new Date().toISOString();
  db.transaction(
    tx => {
      const current = tx
        .select()
        .from(promotions)
        .where(and(eq(promotions.tenantId, args.tenantId), eq(promotions.id, args.id)))
        .get();
      if (!current) promotionError('PROMOTION_NOT_FOUND', 'Promotion not found');
      if (current.source !== 'manual' || !['draft', 'paused'].includes(current.status)) {
        promotionError(
          'PROMOTION_STATE_INVALID',
          'Only draft or paused manual promotions can be edited'
        );
      }
      assertTenantTargets(tx, args.tenantId, rule);
      const updated = tx
        .update(promotions)
        .set({
          ...rule,
          version: current.version + 1,
          updatedBy: args.actorId,
          updatedAt: now,
        })
        .where(
          and(
            eq(promotions.tenantId, args.tenantId),
            eq(promotions.id, args.id),
            eq(promotions.version, args.version),
            eq(promotions.status, current.status)
          )
        )
        .run();
      if (updated.changes !== 1) {
        promotionError('PROMOTION_STATE_INVALID', 'Promotion changed; reload before editing');
      }
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: 'promotion.update',
        resourceType: 'promotion',
        resourceId: args.id,
        before: current,
        after: { ...rule, version: current.version + 1 },
      });
      enqueuePromotionChange(tx, {
        tenantId: args.tenantId,
        id: args.id,
        operation: 'update',
        sync: args.sync,
      });
    },
    { behavior: 'immediate' }
  );
  return db
    .select()
    .from(promotions)
    .where(and(eq(promotions.tenantId, args.tenantId), eq(promotions.id, args.id)))
    .get()!;
}

const ALLOWED_TRANSITIONS: Record<PromotionRow['status'], readonly PromotionRow['status'][]> = {
  draft: ['active', 'archived'],
  active: ['paused', 'archived'],
  paused: ['active', 'archived'],
  archived: [],
};

export function transitionPromotion(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    actorId: string;
    id: string;
    version: number;
    status: PromotionRow['status'];
    sync?: PromotionSyncContext | undefined;
  }
): PromotionRow {
  const now = new Date().toISOString();
  db.transaction(
    tx => {
      const current = tx
        .select()
        .from(promotions)
        .where(and(eq(promotions.tenantId, args.tenantId), eq(promotions.id, args.id)))
        .get();
      if (!current) promotionError('PROMOTION_NOT_FOUND', 'Promotion not found');
      if (!ALLOWED_TRANSITIONS[current.status].includes(args.status)) {
        promotionError('PROMOTION_STATE_INVALID', 'Promotion status transition is not allowed', {
          current: current.status,
          requested: args.status,
        });
      }
      if (args.status === 'active') {
        assertTenantTargets(tx, args.tenantId, normalizedRule(current));
      }
      const updated = tx
        .update(promotions)
        .set({
          status: args.status,
          version: current.version + 1,
          updatedBy: args.actorId,
          updatedAt: now,
        })
        .where(
          and(
            eq(promotions.tenantId, args.tenantId),
            eq(promotions.id, args.id),
            eq(promotions.version, args.version),
            eq(promotions.status, current.status)
          )
        )
        .run();
      if (updated.changes !== 1) {
        promotionError('PROMOTION_STATE_INVALID', 'Promotion changed; reload before continuing');
      }
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: 'promotion.status_changed',
        resourceType: 'promotion',
        resourceId: args.id,
        before: { status: current.status, version: current.version },
        after: { status: args.status, version: current.version + 1 },
      });
      enqueuePromotionChange(tx, {
        tenantId: args.tenantId,
        id: args.id,
        operation: 'update',
        sync: args.sync,
      });
    },
    { behavior: 'immediate' }
  );
  return db
    .select()
    .from(promotions)
    .where(and(eq(promotions.tenantId, args.tenantId), eq(promotions.id, args.id)))
    .get()!;
}

export function listPromotions(
  db: DatabaseInstance,
  args: { tenantId: string; page: number; perPage: number; status?: PromotionRow['status'] }
) {
  const condition = args.status
    ? and(eq(promotions.tenantId, args.tenantId), eq(promotions.status, args.status))
    : eq(promotions.tenantId, args.tenantId);
  const items = db
    .select({
      promotion: promotions,
      siteName: sites.name,
      productName: products.name,
      categoryName: categories.name,
      customerName: customers.name,
    })
    .from(promotions)
    .leftJoin(sites, and(eq(sites.id, promotions.siteId), eq(sites.tenantId, args.tenantId)))
    .leftJoin(
      products,
      and(eq(products.id, promotions.productId), eq(products.tenantId, args.tenantId))
    )
    .leftJoin(
      categories,
      and(eq(categories.id, promotions.categoryId), eq(categories.tenantId, args.tenantId))
    )
    .leftJoin(
      customers,
      and(eq(customers.id, promotions.customerId), eq(customers.tenantId, args.tenantId))
    )
    .where(condition)
    .orderBy(desc(promotions.updatedAt), desc(promotions.id))
    .limit(args.perPage)
    .offset((args.page - 1) * args.perPage)
    .all()
    .map(({ promotion, ...targetNames }) => ({ ...promotion, ...targetNames }));
  const total = Number(
    db
      .select({ count: sql<number>`count(*)` })
      .from(promotions)
      .where(condition)
      .get()?.count ?? 0
  );
  return { items, total, page: args.page, perPage: args.perPage };
}

/** Manager radar read: identify already-converted lots without a broad list scan. */
export function listExpiryPromotionsForLots(
  db: DatabaseInstance,
  args: { tenantId: string; lotIds: readonly string[] }
) {
  const lotIds = [...new Set(args.lotIds)];
  if (lotIds.length === 0) return [];
  return db
    .select({
      id: promotions.id,
      sourceLotId: promotions.sourceLotId,
      name: promotions.name,
      status: promotions.status,
      discountPct: promotions.discountPct,
      version: promotions.version,
    })
    .from(promotions)
    .where(
      and(
        eq(promotions.tenantId, args.tenantId),
        eq(promotions.source, 'expiry'),
        inArray(promotions.sourceLotId, lotIds),
        sql`${promotions.status} <> 'archived'`
      )
    )
    .orderBy(asc(promotions.sourceLotId), desc(promotions.updatedAt))
    .all();
}

function expiryEndsAt(expiresAt: string | null, timezone: string): string | null {
  if (!expiresAt) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(expiresAt)
    ? resolveUtcDayWindow(expiresAt, timezone).endExclusiveIso
    : expiresAt;
}

/** Explicit manager approval that converts one informational suggestion. */
export function activateExpirySuggestion(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    actorId: string;
    suggestionId: string;
    sync?: PromotionSyncContext | undefined;
    nowIso?: string | undefined;
    businessDate: string;
    timezone: string;
    countryCode: string;
    localeVersion: number;
  }
): PromotionRow {
  const now = args.nowIso ?? new Date().toISOString();
  const timezone = args.timezone ?? 'UTC';
  const promotionId = nanoid();
  db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, args.tenantId, args);
      const tenant = tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, args.tenantId))
        .get();
      const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
      const suggestion = tx
        .select({
          id: priceSuggestions.id,
          status: priceSuggestions.status,
          promotionId: priceSuggestions.promotionId,
          siteId: priceSuggestions.siteId,
          productId: priceSuggestions.productId,
          lotId: priceSuggestions.lotId,
          lotNumber: inventoryLots.lotNumber,
          lotStatus: inventoryLots.status,
          onHand: inventoryLots.onHand,
          expiresAt: inventoryLots.expiresAt,
          discountPct: priceSuggestions.discountPct,
          productName: products.name,
        })
        .from(priceSuggestions)
        .innerJoin(
          inventoryLots,
          and(
            eq(inventoryLots.id, priceSuggestions.lotId),
            eq(inventoryLots.tenantId, args.tenantId)
          )
        )
        .innerJoin(
          products,
          and(eq(products.id, priceSuggestions.productId), eq(products.tenantId, args.tenantId))
        )
        .where(
          and(
            eq(priceSuggestions.tenantId, args.tenantId),
            eq(priceSuggestions.id, args.suggestionId)
          )
        )
        .get();
      if (!suggestion || suggestion.status !== 'active' || suggestion.promotionId) {
        promotionError('PROMOTION_STATE_INVALID', 'Active price suggestion not found');
      }
      const medicineProfile = tx
        .select({ productId: pharmacyProductProfiles.productId })
        .from(pharmacyProductProfiles)
        .where(
          and(
            eq(pharmacyProductProfiles.tenantId, args.tenantId),
            eq(pharmacyProductProfiles.productId, suggestion.productId)
          )
        )
        .get();
      if (settings.businessType === 'pharmacy' || medicineProfile) {
        promotionError(
          'PROMOTION_EXPIRY_PHARMACY_FORBIDDEN',
          'Expiry suggestions cannot become promotions for pharmacy medicines or tenants'
        );
      }
      const existingExpiryPromotion = tx
        .select({ id: promotions.id })
        .from(promotions)
        .where(
          and(
            eq(promotions.tenantId, args.tenantId),
            eq(promotions.source, 'expiry'),
            eq(promotions.sourceLotId, suggestion.lotId),
            sql`${promotions.status} <> 'archived'`
          )
        )
        .get();
      if (existingExpiryPromotion) {
        promotionError(
          'PROMOTION_STATE_INVALID',
          'The lot already has a non-archived expiry promotion'
        );
      }
      if (
        suggestion.lotStatus !== 'active' ||
        suggestion.onHand <= 0 ||
        isLotExpiredAt(suggestion.expiresAt, now, args.businessDate)
      ) {
        promotionError('PROMOTION_STATE_INVALID', 'The suggested lot is no longer sellable');
      }
      tx.insert(promotions)
        .values({
          id: promotionId,
          tenantId: args.tenantId,
          name: `Expiry · ${suggestion.productName} · ${suggestion.lotNumber}`,
          status: 'active',
          discountPct: suggestion.discountPct,
          siteId: suggestion.siteId,
          productId: suggestion.productId,
          categoryId: null,
          customerId: null,
          minQuantity: 1,
          startsAt: now,
          endsAt: expiryEndsAt(suggestion.expiresAt, timezone),
          priority: 1_000,
          combinable: false,
          source: 'expiry',
          sourcePriceSuggestionId: suggestion.id,
          sourceLotId: suggestion.lotId,
          version: 1,
          createdBy: args.actorId,
          updatedBy: args.actorId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const converted = tx
        .update(priceSuggestions)
        .set({ status: 'converted', promotionId, updatedAt: now })
        .where(
          and(
            eq(priceSuggestions.tenantId, args.tenantId),
            eq(priceSuggestions.id, suggestion.id),
            eq(priceSuggestions.status, 'active'),
            isNull(priceSuggestions.promotionId)
          )
        )
        .run();
      if (converted.changes !== 1) {
        promotionError('PROMOTION_STATE_INVALID', 'The suggestion changed during approval');
      }
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: 'inventory.lot.discount_promotion_activated',
        resourceType: 'promotion',
        resourceId: promotionId,
        before: { suggestionId: suggestion.id, status: 'active' },
        after: { promotionId, status: 'active', discountPct: suggestion.discountPct },
        metadata: { lotId: suggestion.lotId, productId: suggestion.productId },
      });
      enqueuePromotionChange(tx, {
        tenantId: args.tenantId,
        id: promotionId,
        operation: 'create',
        sync: args.sync,
      });
    },
    { behavior: 'immediate' }
  );
  return db
    .select()
    .from(promotions)
    .where(and(eq(promotions.tenantId, args.tenantId), eq(promotions.id, promotionId)))
    .get()!;
}

function specificity(rule: PromotionRow): number {
  return (
    (rule.sourceLotId ? 1_000 : 0) +
    (rule.productId ? 100 : rule.categoryId ? 80 : 0) +
    (rule.customerId ? 20 : 0) +
    (rule.siteId ? 10 : 0)
  );
}

function candidateSort(a: PromotionRow, b: PromotionRow): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const specificityDelta = specificity(b) - specificity(a);
  if (specificityDelta !== 0) return specificityDelta;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function selectCombination(candidates: PromotionRow[]): PromotionRow[] {
  const sorted = [...candidates].sort(candidateSort);
  const first = sorted[0];
  if (!first) return [];
  if (!first.combinable) return [first];
  const selected = [first];
  for (const candidate of sorted.slice(1)) {
    if (!candidate.combinable || selected.length >= MAX_STACKED_PROMOTIONS) break;
    selected.push(candidate);
  }
  return selected;
}

function fingerprintQuote(
  lines: PromotionPricedLine[],
  totals: Omit<PromotionCheckoutQuote, 'fingerprint' | 'lines'>
) {
  const stable = {
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    total: totals.total,
    promotionDiscountAmount: totals.promotionDiscountAmount,
    lines: lines.map(line => ({
      lineKey: line.lineKey,
      productId: line.productId,
      manualDiscountRate: line.manualDiscountRate,
      effectiveDiscountRate: line.effectiveDiscountRate,
      lineBase: line.lineBase,
      lineTax: line.lineTax,
      lineTotal: line.lineTotal,
      promotions: line.promotions.map(promotion => ({
        id: promotion.promotionId,
        version: promotion.promotionVersion,
        amount: promotion.discountAmount,
      })),
    })),
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/**
 * Resolve every active rule against a cart and recalculate tax from the
 * effective line discount. No writes. Expiry rules are conservative: FEFO
 * must allocate the whole line from the approved source lot, otherwise the
 * rule is skipped rather than discounting units from another lot.
 */
export function quotePromotions(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    customerId: string | null;
    lines: readonly PromotionPricingLine[];
    priceIncludesTax: boolean;
    headerDiscountAmount?: number;
    nowIso?: string;
    businessDate?: string;
  }
): PromotionCheckoutQuote {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const productIds = [...new Set(args.lines.map(line => line.productId))];
  const categoryIds = [
    ...new Set(args.lines.map(line => line.categoryId).filter((id): id is string => Boolean(id))),
  ];
  const targetCondition = or(
    and(isNull(promotions.productId), isNull(promotions.categoryId)),
    ...(productIds.length > 0 ? [inArray(promotions.productId, productIds)] : []),
    ...(categoryIds.length > 0 ? [inArray(promotions.categoryId, categoryIds)] : [])
  );
  const rules = db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.tenantId, args.tenantId),
        eq(promotions.status, 'active'),
        or(isNull(promotions.startsAt), lte(promotions.startsAt, nowIso)),
        or(isNull(promotions.endsAt), gt(promotions.endsAt, nowIso)),
        or(isNull(promotions.siteId), eq(promotions.siteId, args.siteId)),
        args.customerId
          ? or(isNull(promotions.customerId), eq(promotions.customerId, args.customerId))
          : isNull(promotions.customerId),
        targetCondition
      )
    )
    .orderBy(desc(promotions.priority), asc(promotions.createdAt), asc(promotions.id))
    .all();
  const tenant = db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .get();
  const businessType = ((tenant?.settings ?? {}) as Record<string, unknown>).businessType;
  const pharmacyProductIds =
    businessType === 'pharmacy'
      ? new Set(productIds)
      : productIds.length > 0 && rules.some(rule => rule.source === 'expiry')
        ? new Set(
            db
              .select({ productId: pharmacyProductProfiles.productId })
              .from(pharmacyProductProfiles)
              .where(
                and(
                  eq(pharmacyProductProfiles.tenantId, args.tenantId),
                  inArray(pharmacyProductProfiles.productId, productIds)
                )
              )
              .all()
              .map(row => row.productId)
          )
        : new Set<string>();

  const lotRemainders = new Map<string, number>();
  const lotsByProduct = new Map<string, ReturnType<typeof listLotsForProduct>>();
  for (const line of args.lines) {
    if (!line.tracksLots || line.lotAllocations || lotsByProduct.has(line.productId)) continue;
    const lots = listLotsForProduct(db, {
      tenantId: args.tenantId,
      siteId: args.siteId,
      productId: line.productId,
      activeOnly: true,
    }).filter(lot => !isLotExpiredAt(lot.expiresAt, nowIso, args.businessDate));
    lotsByProduct.set(line.productId, lots);
    for (const lot of lots) lotRemainders.set(lot.id, lot.onHand);
  }

  let subtotal = 0;
  let taxAmount = 0;
  let promotionDiscountAmount = 0;
  const pricedLines: PromotionPricedLine[] = [];
  for (const line of args.lines) {
    const frozenLot =
      line.lotAllocations?.length === 1 &&
      line.lotAllocations[0]!.sellable &&
      line.lotAllocations[0]!.quantity + 1e-9 >= line.normalizedQuantity
        ? line.lotAllocations[0]!
        : null;
    const fefoLots = line.lotAllocations ? [] : (lotsByProduct.get(line.productId) ?? []);
    const firstFefoLot = fefoLots.find(lot => (lotRemainders.get(lot.id) ?? 0) > 1e-9) ?? null;
    const qualifyingLotId = frozenLot?.lotId ?? firstFefoLot?.id ?? null;
    const firstLotCoversLine =
      frozenLot !== null ||
      (firstFefoLot !== null &&
        (lotRemainders.get(firstFefoLot.id) ?? 0) + 1e-9 >= line.normalizedQuantity);
    const eligible = rules.filter(rule => {
      if (rule.productId && rule.productId !== line.productId) return false;
      if (rule.categoryId && rule.categoryId !== line.categoryId) return false;
      if (line.quantity + 1e-9 < rule.minQuantity) return false;
      if (rule.source === 'expiry') {
        if (pharmacyProductIds.has(line.productId)) return false;
        if (!line.tracksLots || !rule.sourceLotId) return false;
        if (!firstLotCoversLine || qualifyingLotId !== rule.sourceLotId) return false;
      }
      return true;
    });
    const selected = selectCombination(eligible);
    let effectiveDiscountRate = normalizeRate(line.manualDiscountRate);
    let before = calculateTaxComponentSnapshots({
      components: line.taxComponents,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      discountPercent: effectiveDiscountRate,
      priceIncludesTax: args.priceIncludesTax,
    });
    const applications: AppliedPromotionSnapshot[] = [];
    for (const [position, rule] of selected.entries()) {
      const nextRate = normalizeRate(
        100 - ((100 - effectiveDiscountRate) * (100 - rule.discountPct)) / 100
      );
      const after = calculateTaxComponentSnapshots({
        components: line.taxComponents,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        discountPercent: nextRate,
        priceIncludesTax: args.priceIncludesTax,
      });
      const discountAmount = roundMoney(Math.max(0, before.lineTotal - after.lineTotal));
      if (discountAmount > 0) {
        applications.push({
          promotionId: rule.id,
          promotionVersion: rule.version,
          name: rule.name,
          discountPct: rule.discountPct,
          discountAmount,
          priority: rule.priority,
          combinable: rule.combinable,
          position,
          source: rule.source,
          sourceLotId: rule.sourceLotId,
        });
      }
      effectiveDiscountRate = nextRate;
      before = after;
    }
    subtotal = roundMoney(subtotal + before.lineBase);
    taxAmount = roundMoney(taxAmount + before.lineTax);
    const linePromotionDiscount = applications.reduce(
      (sum, promotion) => roundMoney(sum + promotion.discountAmount),
      0
    );
    promotionDiscountAmount = roundMoney(promotionDiscountAmount + linePromotionDiscount);
    pricedLines.push({
      lineKey: line.lineKey,
      productId: line.productId,
      manualDiscountRate: normalizeRate(line.manualDiscountRate),
      effectiveDiscountRate,
      lineBase: before.lineBase,
      lineTax: before.lineTax,
      lineTotal: before.lineTotal,
      taxComponents: before.components,
      promotionDiscountAmount: linePromotionDiscount,
      promotions: applications,
    });

    // Advance the same virtual FEFO cursor the sale transaction will use so a
    // second line cannot reuse one lot's promotional stock.
    if (line.lotAllocations) continue;
    let remaining = line.normalizedQuantity;
    for (const lot of fefoLots) {
      if (remaining <= 1e-9) break;
      const available = lotRemainders.get(lot.id) ?? 0;
      if (available <= 1e-9) continue;
      const take = Math.min(available, remaining);
      lotRemainders.set(lot.id, available - take);
      remaining -= take;
    }
  }
  const headerDiscount = roundMoney(args.headerDiscountAmount ?? 0);
  const total = roundMoney(subtotal + taxAmount - headerDiscount);
  if (total < 0) {
    promotionError('PROMOTION_STATE_INVALID', 'Discounts exceed the quoted checkout total');
  }
  const totals = { subtotal, taxAmount, total, promotionDiscountAmount };
  return { ...totals, lines: pricedLines, fingerprint: fingerprintQuote(pricedLines, totals) };
}

export function assertPromotionQuoteFingerprint(
  quoted: PromotionCheckoutQuote,
  supplied: string | undefined
): void {
  if (!supplied || quoted.fingerprint !== supplied) {
    promotionError('PROMOTION_QUOTE_STALE', 'Promotion quote changed; refresh checkout', {
      expectedFingerprint: quoted.fingerprint,
    });
  }
}

/** Freeze exactly what checkout applied; callers invoke this in the sale tx. */
export function persistSaleItemPromotionSnapshots(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    saleItemId: string;
    promotions: readonly AppliedPromotionSnapshot[];
    createdAt: string;
    sync?: PromotionSyncContext | undefined;
  }
): { snapshotIds: string[]; outboxIds: string[] } {
  const snapshotIds: string[] = [];
  const outboxIds: string[] = [];
  for (const promotion of args.promotions) {
    const id = nanoid();
    tx.insert(saleItemPromotions)
      .values({
        id,
        tenantId: args.tenantId,
        saleItemId: args.saleItemId,
        promotionId: promotion.promotionId,
        promotionVersion: promotion.promotionVersion,
        nameSnapshot: promotion.name,
        discountPct: promotion.discountPct,
        discountAmount: roundMoney(promotion.discountAmount),
        priority: promotion.priority,
        combinable: promotion.combinable,
        position: promotion.position,
        source: promotion.source,
        sourceLotId: promotion.sourceLotId,
        createdAt: args.createdAt,
      })
      .run();
    snapshotIds.push(id);
    const row = tx
      .select()
      .from(saleItemPromotions)
      .where(and(eq(saleItemPromotions.tenantId, args.tenantId), eq(saleItemPromotions.id, id)))
      .get();
    if (!row) {
      promotionError('PROMOTION_STATE_INVALID', 'Promotion snapshot was not persisted');
    }
    outboxIds.push(
      enqueueSyncInTransaction(
        {
          db: tx,
          tenantId: args.tenantId,
          envelope: args.sync?.envelope ?? null,
          deviceId: args.sync?.deviceId ?? null,
        },
        {
          entityType: 'sale_item_promotions',
          entityId: id,
          operation: 'create',
          data: { ...row },
        }
      ).id
    );
  }
  return { snapshotIds, outboxIds };
}
