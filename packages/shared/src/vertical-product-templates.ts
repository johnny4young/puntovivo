import { MIN_OPERATIONAL_QUANTITY } from './unit-math.ts';
import type { UnitDimension } from './units.ts';
import type { ProductTemplateVerticalId } from './vertical-presets.ts';

export const VERTICAL_PRODUCT_TEMPLATE_IDS = [
  'hardware-length',
  'hardware-serialized',
  'hardware-lot',
  'butchery-weighted-cut',
  'butchery-packaged-cut',
] as const;

export type VerticalProductTemplateId = (typeof VERTICAL_PRODUCT_TEMPLATE_IDS)[number];

export interface VerticalProductTemplate {
  id: VerticalProductTemplateId;
  vertical: ProductTemplateVerticalId;
  preferredUnitAbbreviations: ReadonlyArray<string>;
  requiredUnitDimension: UnitDimension;
  sellByFraction: boolean;
  fractionStep: number;
  fractionMinimum: number;
  tracksLots: boolean;
  tracksSerials: boolean;
  gs1Hint: 'none' | 'weight' | 'price';
}

/**
 * Safe product-entry starting points. They describe form values only: applying
 * one never creates units, writes products or performs a stock transformation.
 */
export const VERTICAL_PRODUCT_TEMPLATES: ReadonlyArray<VerticalProductTemplate> = [
  {
    id: 'hardware-length',
    vertical: 'hardware',
    preferredUnitAbbreviations: ['MTR', 'MT', 'M', 'METRO'],
    requiredUnitDimension: 'length',
    sellByFraction: true,
    fractionStep: MIN_OPERATIONAL_QUANTITY,
    fractionMinimum: MIN_OPERATIONAL_QUANTITY,
    tracksLots: false,
    tracksSerials: false,
    gs1Hint: 'none',
  },
  {
    id: 'hardware-serialized',
    vertical: 'hardware',
    preferredUnitAbbreviations: ['UND', 'UN', 'PZA'],
    requiredUnitDimension: 'count',
    sellByFraction: false,
    fractionStep: MIN_OPERATIONAL_QUANTITY,
    fractionMinimum: MIN_OPERATIONAL_QUANTITY,
    tracksLots: false,
    tracksSerials: true,
    gs1Hint: 'none',
  },
  {
    id: 'hardware-lot',
    vertical: 'hardware',
    preferredUnitAbbreviations: ['UND', 'UN', 'PZA'],
    requiredUnitDimension: 'count',
    sellByFraction: false,
    fractionStep: MIN_OPERATIONAL_QUANTITY,
    fractionMinimum: MIN_OPERATIONAL_QUANTITY,
    tracksLots: true,
    tracksSerials: false,
    gs1Hint: 'none',
  },
  {
    id: 'butchery-weighted-cut',
    vertical: 'butchery',
    preferredUnitAbbreviations: ['KG', 'KGS', 'KILO'],
    requiredUnitDimension: 'mass',
    sellByFraction: true,
    fractionStep: MIN_OPERATIONAL_QUANTITY,
    fractionMinimum: MIN_OPERATIONAL_QUANTITY,
    tracksLots: true,
    tracksSerials: false,
    gs1Hint: 'weight',
  },
  {
    id: 'butchery-packaged-cut',
    vertical: 'butchery',
    preferredUnitAbbreviations: ['UND', 'UN', 'PZA'],
    requiredUnitDimension: 'count',
    sellByFraction: false,
    fractionStep: MIN_OPERATIONAL_QUANTITY,
    fractionMinimum: MIN_OPERATIONAL_QUANTITY,
    tracksLots: true,
    tracksSerials: false,
    gs1Hint: 'price',
  },
];

export function getVerticalProductTemplate(id: VerticalProductTemplateId): VerticalProductTemplate {
  const template = VERTICAL_PRODUCT_TEMPLATES.find(candidate => candidate.id === id);
  if (!template) throw new Error(`Unknown vertical product template: ${id}`);
  return template;
}
