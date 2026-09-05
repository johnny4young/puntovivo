/** Preview local catalog pricing without trusting provider amounts or creating financial rows. */
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  externalOrders,
  products,
  productTaxComponents,
  unitXProduct,
  units,
  tenants,
  vatRates,
  tenantLocaleSettings,
  type ExternalOrderRow,
} from '../../db/schema.js';
import { externalOrderSnapshotSchema } from '../../services/external-orders/contract.js';
import { externalOrderError } from '../../services/external-orders/errors.js';
import { resolveSaleItems, type ResolvedItemsBundle } from '../sales/item-resolution.js';
import { roundMoney } from '../../lib/money.js';
import { parsePricingSettings } from '../../services/pricing-settings.js';
import { assertExternalOrderSite } from './invariants.js';

/** A quote is tied to the inbox revision and exact local catalog inputs, not to an external paid flag. */
export interface ExternalAcceptanceReference {
  id: string;
  expectedVersion: number;
  catalogHash: string;
  lineHash: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  currencyCode: string;
}
export function requireExternalOrder(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  id: string
): ExternalOrderRow {
  assertExternalOrderSite(db, tenantId, siteId);
  const row = db
    .select()
    .from(externalOrders)
    .where(
      and(
        eq(externalOrders.tenantId, tenantId),
        eq(externalOrders.siteId, siteId),
        eq(externalOrders.id, id)
      )
    )
    .get();
  if (!row) externalOrderError('missing');
  return row;
}
/** Synchronous bounded read used again while the sale owns the immediate writer. */
export function readExternalCatalog(db: DatabaseInstance, tenantId: string, row: ExternalOrderRow) {
  const parsed = externalOrderSnapshotSchema.safeParse(row.snapshot);
  if (!parsed.success) externalOrderError('invalid');
  const snapshot = parsed.data,
    codes = [...new Set(snapshot.items.map(item => item.productCode))];
  const tenant = db
    .select({
      currencyCode: tenants.defaultCurrencyCode,
      settings: tenants.settings,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  if (!tenant?.currencyCode || tenant.currencyCode !== snapshot.currencyCode)
    externalOrderError('invalid');
  const catalog = db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      version: products.version,
      isActive: products.isActive,
      vatRateId: products.vatRateId,
      taxRate: products.taxRate,
      taxKind: products.taxKind,
      price: products.price,
      cost: products.cost,
      currencyCode: products.currencyCode,
    })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.sku, codes)))
    .orderBy(asc(products.id))
    .limit(codes.length + 1)
    .all();
  if (
    catalog.length !== codes.length ||
    catalog.some(item => !item.isActive || item.currencyCode !== tenant.currencyCode)
  )
    externalOrderError('invalid');
  const productIds = catalog.map(item => item.id);
  const assignments = db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      price: unitXProduct.price,
      equivalence: unitXProduct.equivalence,
      active: units.isActive,
      name: units.name,
      abbreviation: units.abbreviation,
      standardCode: units.standardCode,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(
      and(
        eq(units.tenantId, tenantId),
        eq(unitXProduct.isBase, true),
        inArray(unitXProduct.productId, productIds)
      )
    )
    .orderBy(asc(unitXProduct.productId), asc(unitXProduct.unitId))
    .limit(productIds.length + 1)
    .all();
  if (
    assignments.length !== productIds.length ||
    assignments.some(
      unit =>
        !unit.active || unit.equivalence !== 1 || !Number.isFinite(unit.price) || unit.price < 0
    )
  )
    externalOrderError('invalid');
  const components = db
    .select()
    .from(productTaxComponents)
    .where(
      and(
        eq(productTaxComponents.tenantId, tenantId),
        inArray(productTaxComponents.productId, productIds)
      )
    )
    .orderBy(asc(productTaxComponents.productId), asc(productTaxComponents.position))
    .limit(productIds.length * 4 + 1)
    .all();
  if (components.length > productIds.length * 4) externalOrderError('invalid');
  const rateIds = [
    ...new Set(
      [...catalog.map(item => item.vatRateId), ...components.map(item => item.vatRateId)].filter(
        (id): id is string => id !== null
      )
    ),
  ];
  const rates = rateIds.length
    ? db
        .select()
        .from(vatRates)
        .where(and(eq(vatRates.tenantId, tenantId), inArray(vatRates.id, rateIds)))
        .orderBy(asc(vatRates.id))
        .limit(rateIds.length)
        .all()
    : [];
  const items = snapshot.items.map(item => {
    const product = catalog.find(product => product.sku === item.productCode);
    if (!product) externalOrderError('invalid');
    const productUnits = assignments.filter(unit => unit.productId === product.id);
    if (productUnits.length !== 1) externalOrderError('invalid');
    return {
      productId: product.id,
      unitId: productUnits[0]!.unitId,
      unitPrice: roundMoney(productUnits[0]!.price),
      quantity: item.quantity,
      discount: 0,
    };
  });
  const catalogHash = createHash('sha256')
    .update(
      JSON.stringify({
        catalog,
        assignments,
        components,
        rates,
        currencyCode: tenant.currencyCode,
        countryCode:
          db
            .select({ countryCode: tenantLocaleSettings.countryCode })
            .from(tenantLocaleSettings)
            .where(eq(tenantLocaleSettings.tenantId, tenantId))
            .get()?.countryCode ?? 'CO',
        pricing: parsePricingSettings(tenant.settings),
      })
    )
    .digest('hex');
  return { snapshot, catalog, assignments, items, catalogHash, currencyCode: tenant.currencyCode };
}
/** Hash only frozen line semantics: fresh sale ids are intentionally excluded. */
export function externalResolvedLineHash(resolved: ResolvedItemsBundle): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        resolved.rows.map(row => ({
          productId: row.productId,
          unitId: row.unitId,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          unitEquivalence: row.unitEquivalence,
          discount: row.discount,
          taxComponents: row.taxComponents,
          total: row.total,
          taxAmount: row.taxAmount,
        }))
      )
    )
    .digest('hex');
}
export async function quoteExternalOrder(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  id: string
) {
  const row = requireExternalOrder(db, tenantId, siteId, id);
  if (row.status !== 'received' || row.saleId) externalOrderError('conflict');
  const catalog = readExternalCatalog(db, tenantId, row);
  const resolved = await resolveSaleItems(db, tenantId, siteId, catalog.items, 1);
  if (readExternalCatalog(db, tenantId, row).catalogHash !== catalog.catalogHash)
    externalOrderError('conflict');
  const subtotal = roundMoney(resolved.subtotal),
    taxAmount = roundMoney(resolved.taxAmount),
    total = roundMoney(subtotal + taxAmount);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([row.id, row.version, catalog.catalogHash, subtotal, taxAmount, total]))
    .digest('hex');
  return {
    id: row.id,
    expectedVersion: row.version,
    catalogHash: catalog.catalogHash,
    lineHash: externalResolvedLineHash(resolved),
    fingerprint,
    subtotal,
    taxAmount,
    total,
    currencyCode: catalog.currencyCode,
    quotedTotal: catalog.snapshot.quotedTotal,
    amountDiffers: total !== catalog.snapshot.quotedTotal,
    items: catalog.items.map((item, index) => ({
      ...item,
      name: resolved.rows[index]!.productName,
    })),
  };
}
