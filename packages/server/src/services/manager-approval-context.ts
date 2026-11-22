/**
 * Decision context frozen onto a checkout approval request: how the
 * requested discount compares with the requester's role limit, the ticket's
 * margin with and without it, and the customer's recent buying habit.
 *
 * @module services/manager-approval-context
 */
import type { CheckoutApprovalContext } from '@puntovivo/shared/checkout-approval';
import type { UserRole } from '@puntovivo/shared/roles';
import { splitLineTax } from '@puntovivo/shared/tax-split';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import {
  customers,
  products,
  sales,
  unitXProduct,
  units,
  type ManagerApprovalDecisionContext,
} from '../db/schema.js';
import { roundMoney } from '../lib/money.js';
import { checkoutDiscountPercent } from './loss-prevention/checkout.js';
import { resolveLossPreventionSettings } from './loss-prevention/settings.js';
import { resolvePricingSettings } from './pricing-settings.js';
import { getProductTaxComponents } from './tax-components.js';

const CUSTOMER_HABIT_WINDOW_DAYS = 90;
const CUSTOMER_HABIT_SALE_LIMIT = 200;
const DAY_MS = 86_400_000;

const roundPercent = (value: number) => roundQuantity(value, 1);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function marginPercent(revenue: number, cost: number): number | null {
  return revenue > 0 ? roundPercent(((revenue - cost) / revenue) * 100) : null;
}

function discountContext(
  db: DatabaseInstance,
  tenantId: string,
  role: UserRole,
  checkout: CheckoutApprovalContext
): ManagerApprovalDecisionContext['discount'] {
  if (checkout.discountAmount <= 0) return null;
  const policy =
    role === 'cashier' || role === 'manager'
      ? resolveLossPreventionSettings(db, tenantId).roles[role]
      : null;
  return {
    percent: roundPercent(checkoutDiscountPercent(checkout.items, checkout.discountAmount)),
    roleLimitPercent: policy?.maxDiscountPercent ?? null,
  };
}

async function marginContext(
  db: DatabaseInstance,
  tenantId: string,
  checkout: CheckoutApprovalContext
): Promise<ManagerApprovalDecisionContext['margin']> {
  const productIds = [...new Set(checkout.items.map(item => item.productId))];
  const pricing = await resolvePricingSettings(db, tenantId);
  const productRows = db
    .select({ id: products.id, cost: products.cost, taxRate: products.taxRate })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();
  const assignments = db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(and(eq(units.tenantId, tenantId), inArray(unitXProduct.productId, productIds)))
    .all();
  const componentsByProduct = getProductTaxComponents(db, tenantId, productIds);
  const productById = new Map(productRows.map(row => [row.id, row]));
  const equivalenceByKey = new Map(
    assignments.map(row => [`${row.productId}:${row.unitId}`, row.equivalence])
  );

  let cost = 0;
  let baseWithout = 0;
  let baseWith = 0;
  let totalWith = 0;
  let lineDiscounts = 0;
  for (const item of checkout.items) {
    const product = productById.get(item.productId);
    const equivalence = equivalenceByKey.get(`${item.productId}:${item.unitId}`);
    // A zero cost would read as a 100 % margin; say nothing instead.
    if (!product || product.cost <= 0 || equivalence === undefined) return null;
    const line = {
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      // Same aggregate rate the sale splits component taxes with.
      taxRate:
        componentsByProduct
          .get(item.productId)
          ?.reduce((sum, component) => sum + component.taxRate, 0) ?? product.taxRate,
      priceIncludesTax: pricing.priceIncludesTax,
    };
    const undiscounted = splitLineTax({ ...line, discountPercent: 0 });
    const discounted = splitLineTax({ ...line, discountPercent: item.discount });
    cost = roundMoney(cost + roundMoney(product.cost * item.quantity * equivalence));
    baseWithout = roundMoney(baseWithout + undiscounted.lineBase);
    baseWith = roundMoney(baseWith + discounted.lineBase);
    totalWith = roundMoney(totalWith + discounted.lineTotal);
    lineDiscounts = roundMoney(lineDiscounts + discounted.discountAmount);
  }

  // A ticket-level discount is tax inclusive; take its pre-tax share.
  const headerDiscount = roundMoney(Math.max(0, checkout.discountAmount - lineDiscounts));
  const headerBase =
    headerDiscount > 0 && totalWith > 0 ? roundMoney((headerDiscount * baseWith) / totalWith) : 0;
  const withoutDiscountPercent = marginPercent(baseWithout, cost);
  if (withoutDiscountPercent === null) return null;
  return {
    withDiscountPercent: marginPercent(roundMoney(baseWith - headerBase), cost),
    withoutDiscountPercent,
  };
}

async function customerContext(
  db: DatabaseInstance,
  tenantId: string,
  customerId: string | null,
  nowMs: number
): Promise<ManagerApprovalDecisionContext['customer']> {
  if (!customerId) return null;
  const customer = await db
    .select({ name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .get();
  if (!customer) return null;

  const completedAt = sql<string>`coalesce(${sales.checkoutCompletedAt}, ${sales.createdAt})`;
  const since = new Date(nowMs - CUSTOMER_HABIT_WINDOW_DAYS * DAY_MS).toISOString();
  const rows = await db
    .select({
      completedAt,
      total: sales.total,
      discountAmount: sales.discountAmount,
      tipAmount: sales.tipAmount,
      serviceChargeAmount: sales.serviceChargeAmount,
    })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.customerId, customerId),
        eq(sales.status, 'completed'),
        // A sale completes after it is created; the raw column keeps the scan bounded.
        gte(sales.createdAt, since),
        gte(completedAt, since)
      )
    )
    .orderBy(desc(completedAt))
    .limit(CUSTOMER_HABIT_SALE_LIMIT)
    .all();

  const discountPercents = rows.flatMap(row => {
    const gross = row.total - row.tipAmount - row.serviceChargeAmount + row.discountAmount;
    return gross > 0 ? [(row.discountAmount / gross) * 100] : [];
  });
  const usualDiscount = median(discountPercents);
  return {
    name: customer.name,
    windowDays: CUSTOMER_HABIT_WINDOW_DAYS,
    purchases: rows.length,
    averageDaysBetween:
      rows.length > 1
        ? roundPercent(
            (Date.parse(rows[0]!.completedAt) - Date.parse(rows.at(-1)!.completedAt)) /
              DAY_MS /
              (rows.length - 1)
          )
        : null,
    usualDiscountPercent: usualDiscount === null ? null : roundPercent(usualDiscount),
  };
}

export async function buildCheckoutApprovalDecisionContext(args: {
  db: DatabaseInstance;
  tenantId: string;
  requesterRole: UserRole;
  checkout: CheckoutApprovalContext;
  nowMs: number;
}): Promise<ManagerApprovalDecisionContext> {
  const { db, tenantId, checkout } = args;
  return {
    version: 1,
    discount: discountContext(db, tenantId, args.requesterRole, checkout),
    margin: await marginContext(db, tenantId, checkout),
    customer: await customerContext(db, tenantId, checkout.customerId, args.nowMs),
  };
}
