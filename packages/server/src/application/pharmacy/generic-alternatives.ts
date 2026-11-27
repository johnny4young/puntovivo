import { and, eq, gt, isNotNull, ne, type SQL } from 'drizzle-orm';
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

/**
 * Resolve dose/unit count per commercial pack from explicit `dosesPerPack` or
 * standard Colombian/LATAM presentation strings ("Caja x 30 tabletas",
 * "Blíster × 10", "Frasco por 24 cápsulas"). Ignores mass/volume units (mg, ml).
 */
export function resolveDosesPerPack(
  explicitDoses: number | null | undefined,
  presentation: string | null | undefined
): number | null {
  if (typeof explicitDoses === 'number' && Number.isInteger(explicitDoses) && explicitDoses > 0) {
    return explicitDoses;
  }
  if (!presentation) return null;
  const normalized = presentation
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US');

  const countUnits =
    '(?:tabletas?|tabs?|capsulas?|caps?|comprimidos?|grageas?|sobres?|ampollas?|viales?|unidades?|dosis|blisters?|supositorios?|ovulos?|parches?)';
  // 1) Explicit pack multiplier ("x 30 tabletas", "×10", "por 24 capsulas")
  const packMatch = new RegExp(
    `(?:\\b(?:x|por)\\s*|×\\s*)(\\d{1,4})(?!\\s*(?:mg|mcg|ug|g|kg|ml|l|cc|ui|%))(?:\\s*${countUnits})?`,
    'i'
  ).exec(normalized);
  if (packMatch) {
    const parsed = Number.parseInt(packMatch[1]!, 10);
    if (parsed > 0 && parsed <= 10_000) return parsed;
  }
  // 2) Direct count phrase ("30 tabletas", "10 capsulas")
  const directMatch = new RegExp(`\\b(\\d{1,4})\\s*${countUnits}\\b`, 'i').exec(normalized);
  if (directMatch) {
    const parsed = Number.parseInt(directMatch[1]!, 10);
    if (parsed > 0 && parsed <= 10_000) return parsed;
  }
  return null;
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
      dosesPerPack: pharmacyProductProfiles.dosesPerPack,
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
 * Cheaper equivalents with the same active ingredient, concentration and dosage
 * form, no stricter class, that the site can sell right now. Compares exact
 * same presentations directly AND cross-presentations (e.g. Caja x 30 vs
 * Blíster x 10) by cost per dose whenever both carry a known dose count.
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
  const presentation = keyOf(source.presentation);
  const sourceDoses = resolveDosesPerPack(source.dosesPerPack, source.presentation);
  const tier = input.priceTier;
  const sourcePrice = tierPrice(source, tier);
  if (
    !ingredient ||
    !concentration ||
    !dosageForm ||
    (!presentation && !sourceDoses) ||
    source.classification === 'controlled' ||
    !(sourcePrice > 0)
  ) {
    return { sourcePrice, items: [] };
  }

  const sourcePricePerDose = sourceDoses ? roundMoney(sourcePrice / sourceDoses) : null;

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

  interface EvaluatedCandidate {
    row: MedicineRow;
    price: number;
    savings: number;
    dosesPerPack: number | null;
    pricePerDose: number | null;
    sourceDosesPerPack: number | null;
    sourcePricePerDose: number | null;
    savingsPerDose: number | null;
    comparisonMode: 'same_presentation' | 'per_dose';
  }

  const candidates: EvaluatedCandidate[] = selectMedicines(
    db,
    scope.tenantId,
    and(
      ne(products.id, source.productId),
      eq(products.isActive, true),
      ne(products.catalogType, 'variant_parent'),
      eq(products.currencyCode, source.currencyCode),
      gt(products.price, 0),
      isNotNull(pharmacyProductProfiles.activeIngredient),
      isNotNull(pharmacyProductProfiles.concentration),
      isNotNull(pharmacyProductProfiles.dosageForm),
      // Never a stricter class than the source: an OTC sale must not turn into a prescription one.
      source.classification === 'otc'
        ? eq(pharmacyProductProfiles.classification, 'otc')
        : ne(pharmacyProductProfiles.classification, 'controlled')
    )
  ).flatMap((row): EvaluatedCandidate[] => {
    if (
      keyOf(row.activeIngredient) !== ingredient ||
      keyOf(row.concentration) !== concentration ||
      keyOf(row.dosageForm) !== dosageForm ||
      !policyAllows(row)
    ) {
      return [];
    }

    const price = tierPrice(row, tier);
    const candidatePresentation = keyOf(row.presentation);
    const candidateDoses = resolveDosesPerPack(row.dosesPerPack, row.presentation);
    const pricePerDose = candidateDoses ? roundMoney(price / candidateDoses) : null;

    if (presentation && candidatePresentation === presentation) {
      if (!(price < sourcePrice)) return [];
      const savings = roundMoney(sourcePrice - price);
      const savingsPerDose =
        sourcePricePerDose !== null && pricePerDose !== null
          ? roundMoney(sourcePricePerDose - pricePerDose)
          : null;
      return [
        {
          row,
          price,
          savings,
          dosesPerPack: candidateDoses,
          pricePerDose,
          sourceDosesPerPack: sourceDoses,
          sourcePricePerDose,
          savingsPerDose,
          comparisonMode: 'same_presentation' as const,
        },
      ];
    }

    // Cross-presentation comparison (e.g. Caja x 30 vs Blíster x 10) requires valid dose counts on both
    if (
      sourceDoses &&
      candidateDoses &&
      sourcePricePerDose !== null &&
      pricePerDose !== null &&
      price / candidateDoses < sourcePrice / sourceDoses - 0.005
    ) {
      const exactSavingPerDose = sourcePrice / sourceDoses - price / candidateDoses;
      const savingsPerDose = roundMoney(exactSavingPerDose);
      const savings = roundMoney(exactSavingPerDose * candidateDoses);
      if (!(savings > 0) || !(savingsPerDose > 0)) return [];
      return [
        {
          row,
          price,
          savings,
          dosesPerPack: candidateDoses,
          pricePerDose,
          sourceDosesPerPack: sourceDoses,
          sourcePricePerDose,
          savingsPerDose,
          comparisonMode: 'per_dose' as const,
        },
      ];
    }

    return [];
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

  const items = candidates.flatMap(candidate => {
    const lots = lotsByProduct.get(candidate.row.productId);
    if (!lots) return [];
    return [
      {
        productId: candidate.row.productId,
        name: candidate.row.name,
        sku: candidate.row.sku,
        price: candidate.price,
        savings: candidate.savings,
        dosesPerPack: candidate.dosesPerPack,
        pricePerDose: candidate.pricePerDose,
        sourceDosesPerPack: candidate.sourceDosesPerPack,
        sourcePricePerDose: candidate.sourcePricePerDose,
        savingsPerDose: candidate.savingsPerDose,
        comparisonMode: candidate.comparisonMode,
        classification: candidate.row.classification,
        genericName: candidate.row.genericName,
        manufacturer: candidate.row.manufacturer,
        concentration: candidate.row.concentration,
        presentation: candidate.row.presentation,
        siteStock: roundQuantity(lots.reduce((total, lot) => total + lot.onHand, 0)),
        nextLot: { lotNumber: lots[0]!.lotNumber, expiresAt: lots[0]!.expiresAt },
      },
    ];
  });
  items.sort((a, b) => {
    if (a.comparisonMode === 'same_presentation' && b.comparisonMode === 'same_presentation') {
      return b.savings - a.savings || a.name.localeCompare(b.name);
    }
    const aRate = a.savingsPerDose ?? a.savings;
    const bRate = b.savingsPerDose ?? b.savings;
    return bRate - aRate || b.savings - a.savings || a.name.localeCompare(b.name);
  });
  return { sourcePrice, items: items.slice(0, input.limit) };
}
