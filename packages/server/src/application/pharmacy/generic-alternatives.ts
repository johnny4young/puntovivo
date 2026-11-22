import { and, eq, gt, isNotNull, lt, ne, type SQL } from 'drizzle-orm';
import { resolveTierUnitPrice, type PriceTier } from '@puntovivo/shared/price-tier';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import type { DatabaseInstance } from '../../db/index.js';
import { pharmacyProductProfiles, products, type PharmacyClassification } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import type { TenantBusinessClock } from '../../services/pharmacy/business-clock.js';
import { pharmacyProductPolicyBlockCode } from '../../services/pharmacy/catalog-policy.js';
import { resolvePharmacyPolicy } from '../../services/pharmacy/policy.js';
import { listSellableLots } from '../../services/inventory-lots/queries.js';
import type { PharmacyGenericAlternativesInput } from '../../trpc/schemas/pharmacy.js';

/** Accent-, case- and spacing-insensitive key, so 500mg matches 500 mg and 0,5 matches 0.5. */
export function pharmacyEquivalenceKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, '');
  return key || null;
}

interface AlternativesScope {
  tenantId: string;
  siteId: string;
  clock: TenantBusinessClock;
}

function selectMedicines(db: DatabaseInstance, tenantId: string, where: SQL | undefined) {
  return db
    .select({
      productId: products.id,
      name: products.name,
      sku: products.sku,
      price: products.price,
      price2: products.price2,
      price3: products.price3,
      currencyCode: products.currencyCode,
      activeIngredient: pharmacyProductProfiles.activeIngredient,
      genericName: pharmacyProductProfiles.genericName,
      concentration: pharmacyProductProfiles.concentration,
      dosageForm: pharmacyProductProfiles.dosageForm,
      presentation: pharmacyProductProfiles.presentation,
      manufacturer: pharmacyProductProfiles.manufacturer,
      classification: pharmacyProductProfiles.classification,
      sanitaryRegistration: pharmacyProductProfiles.sanitaryRegistration,
      registrationExpiresAt: pharmacyProductProfiles.registrationExpiresAt,
    })
    .from(products)
    .innerJoin(
      pharmacyProductProfiles,
      and(
        eq(pharmacyProductProfiles.productId, products.id),
        eq(pharmacyProductProfiles.tenantId, tenantId)
      )
    )
    .where(and(eq(products.tenantId, tenantId), where))
    .all();
}

type MedicineRow = ReturnType<typeof selectMedicines>[number];

function tierPrice(row: MedicineRow, tier: PriceTier): number {
  return resolveTierUnitPrice({
    tier,
    assignmentPrice: row.price,
    isBaseUnit: true,
    productPrices: row,
  });
}

/**
 * Cheaper medicines with the same active ingredient, concentration, dosage form
 * and presentation, no stricter class, that the site can sell right now, biggest saving first. Controlled,
 * policy-blocked or out-of-stock products are never suggested; recalls reach
 * this through lot status, like checkout.
 */
export function listPharmacyGenericAlternatives(
  db: DatabaseInstance,
  scope: AlternativesScope,
  input: Omit<PharmacyGenericAlternativesInput, 'siteId'>
) {
  const [source] = selectMedicines(db, scope.tenantId, eq(products.id, input.productId));
  // A hint never errors: an unknown, foreign or non-medicine product has no alternatives.
  if (!source) return { sourcePrice: null, items: [] };

  const keys = new Map<string, string | null>();
  const keyOf = (value: string | null) => {
    if (!value) return null;
    if (!keys.has(value)) keys.set(value, pharmacyEquivalenceKey(value));
    return keys.get(value)!;
  };
  const ingredient = keyOf(source.activeIngredient);
  const concentration = keyOf(source.concentration);
  const dosageForm = keyOf(source.dosageForm);
  // Same pack, so the saving compares like for like.
  const presentation = keyOf(source.presentation);
  const tier = input.priceTier;
  const sourcePrice = tierPrice(source, tier);
  if (
    !ingredient ||
    !concentration ||
    !dosageForm ||
    !presentation ||
    source.classification === 'controlled' ||
    !(sourcePrice > 0)
  ) {
    return { sourcePrice, items: [] };
  }

  const decisions = new Map<PharmacyClassification, ReturnType<typeof resolvePharmacyPolicy>>();
  const policyAllows = (row: MedicineRow) => {
    let decision = decisions.get(row.classification);
    if (!decision) {
      decision = resolvePharmacyPolicy(
        scope.clock.countryCode,
        scope.clock.businessDate,
        row.classification
      );
      decisions.set(row.classification, decision);
    }
    return pharmacyProductPolicyBlockCode(decision, row, scope.clock.businessDate) === null;
  };

  const candidates = selectMedicines(
    db,
    scope.tenantId,
    and(
      ne(products.id, source.productId),
      eq(products.isActive, true),
      ne(products.catalogType, 'variant_parent'),
      eq(products.currencyCode, source.currencyCode),
      gt(products.price, 0),
      // Tiers 2 and 3 can undercut tier 1, so only tier 1 bounds the scan.
      tier === 1 ? lt(products.price, sourcePrice) : undefined,
      isNotNull(pharmacyProductProfiles.activeIngredient),
      isNotNull(pharmacyProductProfiles.concentration),
      isNotNull(pharmacyProductProfiles.dosageForm),
      isNotNull(pharmacyProductProfiles.presentation),
      // Never a stricter class than the source: an OTC sale must not turn into a prescription one.
      source.classification === 'otc'
        ? eq(pharmacyProductProfiles.classification, 'otc')
        : ne(pharmacyProductProfiles.classification, 'controlled')
    )
  ).flatMap(row => {
    const price = tierPrice(row, tier);
    const matches =
      price < sourcePrice &&
      keyOf(row.activeIngredient) === ingredient &&
      keyOf(row.concentration) === concentration &&
      keyOf(row.dosageForm) === dosageForm &&
      keyOf(row.presentation) === presentation &&
      policyAllows(row);
    return matches ? [{ row, price }] : [];
  });
  if (candidates.length === 0) return { sourcePrice, items: [] };

  const lotsByProduct = new Map<string, ReturnType<typeof listSellableLots>>();
  for (const lot of listSellableLots(db, {
    tenantId: scope.tenantId,
    siteId: scope.siteId,
    productIds: candidates.map(({ row }) => row.productId),
    nowIso: scope.clock.nowIso,
    businessDate: scope.clock.businessDate,
  })) {
    const list = lotsByProduct.get(lot.productId) ?? [];
    list.push(lot);
    lotsByProduct.set(lot.productId, list);
  }

  const items = candidates.flatMap(({ row, price }) => {
    const lots = lotsByProduct.get(row.productId);
    if (!lots) return [];
    return [
      {
        productId: row.productId,
        name: row.name,
        sku: row.sku,
        price,
        savings: roundMoney(sourcePrice - price),
        classification: row.classification,
        genericName: row.genericName,
        manufacturer: row.manufacturer,
        concentration: row.concentration,
        presentation: row.presentation,
        siteStock: roundQuantity(lots.reduce((total, lot) => total + lot.onHand, 0)),
        nextLot: { lotNumber: lots[0]!.lotNumber, expiresAt: lots[0]!.expiresAt },
      },
    ];
  });
  items.sort((a, b) => b.savings - a.savings || a.name.localeCompare(b.name));
  return { sourcePrice, items: items.slice(0, input.limit) };
}
