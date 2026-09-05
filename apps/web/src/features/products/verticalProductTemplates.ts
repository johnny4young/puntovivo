import {
  getVerticalProductTemplate,
  type VerticalProductTemplateId,
} from '@puntovivo/shared/vertical-product-templates';

import { calculatePricing } from './pricing';
import type { ProductFormValues, UnitLookupOption } from './productForm.types';

export interface ProductTemplatePriceSeed {
  cost: number;
  price: number;
  price2: number;
  price3: number;
}

export interface ProductTemplateApplication {
  templateId: VerticalProductTemplateId;
  values: Pick<
    ProductFormValues,
    | 'sellByFraction'
    | 'fractionStep'
    | 'fractionMinimum'
    | 'tracksStock'
    | 'tracksLots'
    | 'tracksSerials'
    | 'price'
    | 'price2'
    | 'price3'
    | 'marginPercent1'
    | 'marginPercent2'
    | 'marginPercent3'
    | 'marginAmount1'
    | 'marginAmount2'
    | 'marginAmount3'
  >;
  unitAssignment: ProductFormValues['unitAssignments'][number];
  resetsDirectStock: boolean;
}

export type BuildProductTemplateApplicationResult =
  | { ok: true; application: ProductTemplateApplication }
  | { ok: false; missingAbbreviations: ReadonlyArray<string> };

function normalizeUnitKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Build a form-only template patch. Unit resolution is read-only against the
 * tenant's existing catalog; a missing unit returns before any form mutation.
 */
export function buildProductTemplateApplication(args: {
  templateId: VerticalProductTemplateId;
  units: ReadonlyArray<UnitLookupOption>;
  prices: ProductTemplatePriceSeed;
}): BuildProductTemplateApplicationResult {
  const template = getVerticalProductTemplate(args.templateId);
  const preferred = new Set(template.preferredUnitAbbreviations.map(normalizeUnitKey));
  const unit = args.units.find(candidate => {
    if (
      candidate.isActive === false ||
      candidate.dimension !== template.requiredUnitDimension ||
      !preferred.has(normalizeUnitKey(candidate.abbreviation))
    ) {
      return false;
    }
    // The weighted template advertises GS1 scale compatibility. Require the
    // same positive physical conversion factor the authoritative lookup will
    // enforce later instead of creating a product that cannot be scanned.
    return (
      template.gs1Hint !== 'weight' ||
      (typeof candidate.referenceFactor === 'number' &&
        Number.isFinite(candidate.referenceFactor) &&
        candidate.referenceFactor > 0)
    );
  });
  if (!unit) {
    return { ok: false, missingAbbreviations: template.preferredUnitAbbreviations };
  }

  const price = args.prices.price;
  const price2 = args.prices.price2 > 0 ? args.prices.price2 : price;
  const price3 = args.prices.price3 > 0 ? args.prices.price3 : price;
  const tier1 = calculatePricing({ cost: args.prices.cost, price });
  const tier2 = calculatePricing({ cost: args.prices.cost, price: price2 });
  const tier3 = calculatePricing({ cost: args.prices.cost, price: price3 });

  return {
    ok: true,
    application: {
      templateId: template.id,
      values: {
        sellByFraction: template.sellByFraction,
        fractionStep: template.fractionStep,
        fractionMinimum: template.fractionMinimum,
        tracksStock: true,
        tracksLots: template.tracksLots,
        tracksSerials: template.tracksSerials,
        price,
        price2,
        price3,
        marginPercent1: tier1.marginPercent,
        marginPercent2: tier2.marginPercent,
        marginPercent3: tier3.marginPercent,
        marginAmount1: tier1.marginAmount,
        marginAmount2: tier2.marginAmount,
        marginAmount3: tier3.marginAmount,
      },
      unitAssignment: {
        unitId: unit.id,
        equivalence: 1,
        price,
        price2,
        price3,
        isBase: true,
      },
      resetsDirectStock: template.tracksLots || template.tracksSerials,
    },
  };
}
