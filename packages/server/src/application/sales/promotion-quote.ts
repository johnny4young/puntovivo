/** Authoritative promotion previews for fresh carts and persisted drafts. */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessions,
  inventoryLots,
  products,
  saleItemLots,
  saleItemTaxComponents,
  saleItems,
  sales,
  tenants,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { isLotExpiredAt } from '../../services/inventory-lots/index.js';
import { parsePricingSettings } from '../../services/pricing-settings.js';
import { quotePromotions, type PromotionPricingLine } from '../../services/promotions.js';
import { legacyComponent } from '../../services/tax-components.js';
import type { PromotionQuoteInput } from '../../trpc/schemas/sales.js';
import { getNormalizedSaleQuantity } from './policies.js';
import {
  resolveSaleCustomer,
  resolveSaleItems,
  type ResolvedSaleCustomer,
} from './item-resolution.js';
import { quoteResolvedSalePromotions } from './promotion-pricing.js';
import { resolveTenantBusinessClock } from '../../services/pharmacy/business-clock.js';

export interface PromotionQuoteContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
}

function requireDraft(
  sale: typeof sales.$inferSelect | undefined
): asserts sale is typeof sales.$inferSelect {
  if (!sale) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'SALE_NOT_FOUND',
      message: 'Sale not found',
    });
  }
  if (sale.status !== 'draft' || sale.suspendedAt !== null) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_DRAFT_REQUIRED',
      message: 'Only a resumed draft can be quoted for completion',
    });
  }
}

async function quoteFresh(
  ctx: PromotionQuoteContext,
  input: Extract<PromotionQuoteInput, { mode: 'fresh' }>
) {
  const customer = await resolveSaleCustomer(ctx.db, ctx.tenantId, input.customerId);
  const businessClock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const priceTier = input.priceTier ?? customer.priceTier;
  const resolved = await resolveSaleItems(ctx.db, ctx.tenantId, ctx.siteId, input.items, priceTier);
  return quoteResolvedSalePromotions(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    customerId: customer.customerId,
    resolvedItems: resolved,
    headerDiscountAmount: input.discountAmount,
    nowIso: businessClock.nowIso,
    businessDate: businessClock.businessDate,
  });
}

async function resolveDraftCustomer(
  db: DatabaseInstance,
  tenantId: string,
  sale: typeof sales.$inferSelect,
  inputCustomerId: string | null | undefined
): Promise<ResolvedSaleCustomer> {
  return resolveSaleCustomer(
    db,
    tenantId,
    inputCustomerId === undefined ? sale.customerId : inputCustomerId
  );
}

export function quotePersistedDraftPromotions(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    saleId: string;
    customerId: string | null;
    nowIso: string;
    businessDate?: string;
  }
) {
  const sale = db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, args.tenantId), eq(sales.id, args.saleId)))
    .get();
  requireDraft(sale);
  const sourceSession = sale.cashSessionId
    ? db
        .select({ siteId: cashSessions.siteId })
        .from(cashSessions)
        .where(
          and(eq(cashSessions.tenantId, args.tenantId), eq(cashSessions.id, sale.cashSessionId))
        )
        .get()
    : null;
  const siteId = sourceSession?.siteId ?? args.siteId;
  if (siteId !== args.siteId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SALE_DRAFT_SITE_MISMATCH',
      message: 'Complete the draft at the site where its inventory was reserved',
      details: { expectedSiteId: siteId, actualSiteId: args.siteId },
    });
  }

  const rows = db
    .select({
      id: saleItems.id,
      productId: saleItems.productId,
      categoryId: products.categoryId,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      unitEquivalence: saleItems.unitEquivalence,
      discount: saleItems.discount,
      manualDiscountRate: saleItems.manualDiscountRate,
      taxKind: saleItems.taxKind,
      taxRate: saleItems.taxRate,
      tracksLots: products.tracksLots,
    })
    .from(saleItems)
    .innerJoin(
      products,
      and(eq(products.id, saleItems.productId), eq(products.tenantId, args.tenantId))
    )
    .where(eq(saleItems.saleId, sale.id))
    .orderBy(asc(saleItems.id))
    .all();
  if (rows.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_WITHOUT_ITEMS',
      message: 'Cannot quote a draft without line items',
    });
  }
  const itemIds = rows.map(row => row.id);
  const componentRows = db
    .select()
    .from(saleItemTaxComponents)
    .where(
      and(
        eq(saleItemTaxComponents.tenantId, args.tenantId),
        inArray(saleItemTaxComponents.saleItemId, itemIds)
      )
    )
    .orderBy(asc(saleItemTaxComponents.saleItemId), asc(saleItemTaxComponents.position))
    .all();
  const componentsByItem = new Map<string, typeof componentRows>();
  for (const component of componentRows) {
    const group = componentsByItem.get(component.saleItemId) ?? [];
    group.push(component);
    componentsByItem.set(component.saleItemId, group);
  }
  const lotRows = db
    .select({
      saleItemId: saleItemLots.saleItemId,
      lotId: saleItemLots.lotId,
      quantity: saleItemLots.quantity,
      status: inventoryLots.status,
      expiresAt: inventoryLots.expiresAt,
    })
    .from(saleItemLots)
    .innerJoin(
      inventoryLots,
      and(eq(inventoryLots.id, saleItemLots.lotId), eq(inventoryLots.tenantId, args.tenantId))
    )
    .where(and(eq(saleItemLots.tenantId, args.tenantId), inArray(saleItemLots.saleItemId, itemIds)))
    .orderBy(asc(saleItemLots.saleItemId), asc(saleItemLots.id))
    .all();
  const lotsByItem = new Map<string, typeof lotRows>();
  for (const lot of lotRows) {
    const group = lotsByItem.get(lot.saleItemId) ?? [];
    group.push(lot);
    lotsByItem.set(lot.saleItemId, group);
  }
  const lines: PromotionPricingLine[] = rows.map(row => ({
    lineKey: `draft:${row.id}`,
    productId: row.productId,
    categoryId: row.categoryId,
    quantity: row.quantity,
    normalizedQuantity: getNormalizedSaleQuantity(row.quantity, row.unitEquivalence),
    unitPrice: row.unitPrice,
    manualDiscountRate: row.manualDiscountRate ?? row.discount,
    taxComponents: componentsByItem.get(row.id) ?? [
      legacyComponent({
        vatRateId: null,
        taxKind: row.taxKind,
        taxRate: row.taxRate,
      }),
    ],
    tracksLots: row.tracksLots,
    lotAllocations: (lotsByItem.get(row.id) ?? []).map(lot => ({
      lotId: lot.lotId,
      quantity: lot.quantity,
      sellable:
        (lot.status === 'active' || lot.status === 'depleted') &&
        !isLotExpiredAt(lot.expiresAt, args.nowIso, args.businessDate),
    })),
  }));
  const tenant = db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .get();
  const pricing = parsePricingSettings(tenant?.settings);
  return quotePromotions(db, {
    tenantId: args.tenantId,
    siteId,
    customerId: args.customerId,
    lines,
    priceIncludesTax: pricing.priceIncludesTax,
    headerDiscountAmount: sale.discountAmount,
    nowIso: args.nowIso,
    ...(args.businessDate ? { businessDate: args.businessDate } : {}),
  });
}

async function quoteDraft(
  ctx: PromotionQuoteContext,
  input: Extract<PromotionQuoteInput, { mode: 'fromDraft' }>
) {
  const sale = await ctx.db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, ctx.tenantId), eq(sales.id, input.saleId)))
    .get();
  requireDraft(sale);
  const customer = await resolveDraftCustomer(ctx.db, ctx.tenantId, sale, input.customerId);
  const businessClock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  return quotePersistedDraftPromotions(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    saleId: sale.id,
    customerId: customer.customerId,
    nowIso: businessClock.nowIso,
    businessDate: businessClock.businessDate,
  });
}

export async function quoteSalePromotions(ctx: PromotionQuoteContext, input: PromotionQuoteInput) {
  return input.mode === 'fresh' ? quoteFresh(ctx, input) : quoteDraft(ctx, input);
}
