import { and, eq, inArray } from 'drizzle-orm';
import type { CheckoutApprovalItem } from '@puntovivo/shared/checkout-approval';
import {
  isPriceTier,
  isUnitPriceOverride,
  resolveTierUnitPrice,
  type PriceTier,
} from '@puntovivo/shared/price-tier';
import type { DatabaseInstance } from '../../db/index.js';
import { products, saleItems, sales, unitXProduct } from '../../db/schema.js';

function itemKey(productId: string, unitId: string): string {
  return `${productId}\u0000${unitId}`;
}

async function hasFreshPriceOverride(args: {
  db: DatabaseInstance;
  tenantId: string;
  items: CheckoutApprovalItem[];
  priceTier: PriceTier;
}): Promise<boolean> {
  const productIds = [...new Set(args.items.map(item => item.productId))];
  if (productIds.length === 0) return false;
  const rows = await args.db
    .select({
      productId: products.id,
      unitId: unitXProduct.unitId,
      productPrice: products.price,
      productPrice2: products.price2,
      productPrice3: products.price3,
      assignmentPrice: unitXProduct.price,
      assignmentPrice2: unitXProduct.price2,
      assignmentPrice3: unitXProduct.price3,
      assignmentIsBase: unitXProduct.isBase,
    })
    .from(unitXProduct)
    .innerJoin(
      products,
      and(eq(products.id, unitXProduct.productId), eq(products.tenantId, args.tenantId))
    )
    .where(inArray(products.id, productIds))
    .all();
  const catalogByItem = new Map(rows.map(row => [itemKey(row.productId, row.unitId), row]));

  return args.items.some(item => {
    const catalog = catalogByItem.get(itemKey(item.productId, item.unitId));
    // Missing catalog identities are rejected by completion with their own
    // stable code. Do not ask for an approval that cannot make them sellable.
    if (!catalog) return false;
    return isUnitPriceOverride({
      unitPrice: item.unitPrice,
      retailUnitPrice: catalog.assignmentPrice,
      referenceUnitPrice: resolveTierUnitPrice({
        tier: args.priceTier,
        assignmentPrice: catalog.assignmentPrice,
        assignmentPrice2: catalog.assignmentPrice2 ?? undefined,
        assignmentPrice3: catalog.assignmentPrice3 ?? undefined,
        isBaseUnit: catalog.assignmentIsBase === true,
        productPrices: {
          price: catalog.productPrice,
          price2: catalog.productPrice2,
          price3: catalog.productPrice3,
        },
      }),
    });
  });
}

async function hasDraftPriceOverride(args: {
  db: DatabaseInstance;
  tenantId: string;
  saleId: string;
}): Promise<boolean> {
  const sale = await args.db
    .select({ id: sales.id, priceTier: sales.priceTier })
    .from(sales)
    .where(
      and(eq(sales.id, args.saleId), eq(sales.tenantId, args.tenantId), eq(sales.status, 'draft'))
    )
    .get();
  if (!sale) return false;
  const priceTier = isPriceTier(sale.priceTier) ? sale.priceTier : 1;
  const rows = await args.db
    .select({
      unitPrice: saleItems.unitPrice,
      catalogUnitPrice1: saleItems.catalogUnitPrice1,
      catalogUnitPrice2: saleItems.catalogUnitPrice2,
      catalogUnitPrice3: saleItems.catalogUnitPrice3,
    })
    .from(saleItems)
    .where(eq(saleItems.saleId, sale.id))
    .all();

  return rows.some(row => {
    if (
      row.catalogUnitPrice1 === null ||
      row.catalogUnitPrice2 === null ||
      row.catalogUnitPrice3 === null
    ) {
      return true;
    }
    const referenceUnitPrice =
      priceTier === 1
        ? row.catalogUnitPrice1
        : priceTier === 2
          ? row.catalogUnitPrice2
          : row.catalogUnitPrice3;
    return isUnitPriceOverride({
      unitPrice: row.unitPrice,
      referenceUnitPrice,
      retailUnitPrice: row.catalogUnitPrice1,
    });
  });
}

/** Authoritative read-side hint; completion independently repeats the check. */
export async function hasCheckoutPriceOverride(args: {
  db: DatabaseInstance;
  tenantId: string;
  items: CheckoutApprovalItem[];
  priceTier: PriceTier;
  saleId?: string | undefined;
}): Promise<boolean> {
  return args.saleId
    ? hasDraftPriceOverride({ db: args.db, tenantId: args.tenantId, saleId: args.saleId })
    : hasFreshPriceOverride(args);
}
