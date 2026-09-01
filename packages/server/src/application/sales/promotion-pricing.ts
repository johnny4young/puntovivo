/** Promotion quote adapters for the authoritative sale-item resolver. */
import type { DatabaseInstance } from '../../db/index.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { resolvePricingSettings } from '../../services/pricing-settings.js';
import {
  quotePromotions,
  type PromotionCheckoutQuote,
  type PromotionPricingLine,
} from '../../services/promotions.js';
import type { ResolvedItemsBundle } from './item-resolution.js';

function pricingLines(bundle: ResolvedItemsBundle): PromotionPricingLine[] {
  return bundle.rows.map((row, index) => ({
    lineKey: `fresh:${index}`,
    productId: row.productId,
    categoryId: row.categoryId,
    quantity: row.quantity,
    normalizedQuantity: row.normalizedQuantity,
    unitPrice: row.unitPrice,
    manualDiscountRate: row.discount,
    taxComponents: row.taxComponents,
    tracksLots: row.tracksLots,
  }));
}

export async function quoteResolvedSalePromotions(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    customerId: string | null;
    resolvedItems: ResolvedItemsBundle;
    headerDiscountAmount: number;
    nowIso?: string;
  }
): Promise<PromotionCheckoutQuote> {
  const pricing = await resolvePricingSettings(db, args.tenantId);
  return quotePromotions(db, {
    tenantId: args.tenantId,
    siteId: args.siteId,
    customerId: args.customerId,
    lines: pricingLines(args.resolvedItems),
    priceIncludesTax: pricing.priceIncludesTax,
    headerDiscountAmount: args.headerDiscountAmount,
    ...(args.nowIso ? { nowIso: args.nowIso } : {}),
  });
}

/**
 * Replace the manual-price result with the exact server quote. The positional
 * assertion is deliberate: duplicate products are legal cart lines, so a
 * product-keyed map would collapse modifiers or units and snapshot the wrong
 * promotion onto a line.
 */
export function applyPromotionQuote(
  bundle: ResolvedItemsBundle,
  quote: PromotionCheckoutQuote
): ResolvedItemsBundle {
  if (
    quote.lines.length !== bundle.rows.length ||
    quote.lines.some(
      (line, index) =>
        line.lineKey !== `fresh:${index}` || line.productId !== bundle.rows[index]?.productId
    )
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PROMOTION_QUOTE_STALE',
      message: 'Promotion quote no longer matches the sale lines',
    });
  }
  return {
    productStocks: bundle.productStocks,
    subtotal: quote.subtotal,
    taxAmount: quote.taxAmount,
    rows: bundle.rows.map((row, index) => {
      const priced = quote.lines[index]!;
      return {
        ...row,
        discount: priced.effectiveDiscountRate,
        taxAmount: priced.lineTax,
        taxComponents: priced.taxComponents,
        total: priced.lineTotal,
      };
    }),
  };
}

export function promotionPricingLines(bundle: ResolvedItemsBundle): PromotionPricingLine[] {
  return pricingLines(bundle);
}
