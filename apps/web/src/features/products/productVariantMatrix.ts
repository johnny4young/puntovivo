import type { ProductVariantAxis } from '@/types';

export const MAX_VARIANT_AXES = 3;
export const MAX_VARIANT_OPTIONS = 20;
export const MAX_VARIANT_COMBINATIONS = 100;
const MAX_PRODUCT_NAME_LENGTH = 255;

export interface VariantAxisDraft {
  name: string;
  valuesText: string;
}

export type VariantMatrixValidationCode =
  | 'axisRequired'
  | 'valuesRequired'
  | 'duplicateAxis'
  | 'duplicateValue'
  | 'tooLong'
  | 'tooManyOptions'
  | 'tooManyCombinations';

export interface VariantPreviewRow {
  name: string;
  sku: string;
  values: Record<string, string>;
}

export function parseVariantAxes(drafts: VariantAxisDraft[]): {
  axes: ProductVariantAxis[];
  error: VariantMatrixValidationCode | null;
} {
  const axes = drafts.map(draft => ({
    name: draft.name.trim(),
    values: draft.valuesText
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  }));

  if (axes.some(axis => !axis.name)) return { axes, error: 'axisRequired' };
  if (axes.some(axis => axis.values.length === 0)) return { axes, error: 'valuesRequired' };
  if (axes.some(axis => axis.name.length > 40 || axis.values.some(value => value.length > 40))) {
    return { axes, error: 'tooLong' };
  }
  if (axes.some(axis => axis.values.length > MAX_VARIANT_OPTIONS)) {
    return { axes, error: 'tooManyOptions' };
  }

  const axisNames = axes.map(axis => axis.name.toLocaleLowerCase());
  if (new Set(axisNames).size !== axisNames.length) return { axes, error: 'duplicateAxis' };
  if (
    axes.some(axis => {
      const values = axis.values.map(value => value.toLocaleLowerCase());
      return new Set(values).size !== values.length;
    })
  ) {
    return { axes, error: 'duplicateValue' };
  }

  const count = axes.reduce((total, axis) => total * axis.values.length, 1);
  if (count > MAX_VARIANT_COMBINATIONS) return { axes, error: 'tooManyCombinations' };
  return { axes, error: null };
}

function skuToken(value: string, fallback: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || fallback
  );
}

function tokensForAxis(axis: ProductVariantAxis): string[] {
  const baseTokens = axis.values.map((value, index) => skuToken(value, `OPT${index + 1}`));
  const counts = new Map<string, number>();
  for (const token of baseTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return baseTokens.map((token, index) =>
    (counts.get(token) ?? 0) > 1 ? `${token}-${index + 1}` : token
  );
}

function truncateAtCodePointBoundary(value: string, maxCodeUnits: number): string {
  let result = '';
  for (const codePoint of value) {
    if (result.length + codePoint.length > maxCodeUnits) break;
    result += codePoint;
  }
  return result;
}

function buildVariantName(parentName: string, valueLabel: string): string {
  const suffix = ` · ${valueLabel}`;
  const parentPrefix = truncateAtCodePointBoundary(
    parentName,
    MAX_PRODUCT_NAME_LENGTH - suffix.length
  ).trimEnd();
  return `${parentPrefix}${suffix}`;
}

export function buildVariantPreview(
  parent: { name: string; sku: string },
  axes: ProductVariantAxis[]
): VariantPreviewRow[] {
  const axisTokens = axes.map(tokensForAxis);
  let combinations: Array<Array<{ value: string; token: string }>> = [[]];

  axes.forEach((axis, axisIndex) => {
    combinations = combinations.flatMap(combination =>
      axis.values.map((value, valueIndex) => [
        ...combination,
        { value, token: axisTokens[axisIndex]![valueIndex]! },
      ])
    );
  });

  const usedSuffixes = new Set<string>();
  return combinations.map(combination => {
    const values = Object.fromEntries(
      axes.map((axis, index) => [axis.name, combination[index]!.value])
    );
    const baseSuffix = combination.map(item => item.token).join('-');
    let suffix = baseSuffix;
    let discriminator = 2;
    while (usedSuffixes.has(suffix)) {
      suffix = `${baseSuffix}-${discriminator}`;
      discriminator += 1;
    }
    usedSuffixes.add(suffix);
    const prefix = truncateAtCodePointBoundary(
      parent.sku,
      Math.max(1, 100 - suffix.length - 1)
    ).replace(/-+$/g, '');
    const valueLabel = combination.map(item => item.value).join(' / ');
    return {
      name: buildVariantName(parent.name, valueLabel),
      sku: `${prefix}-${suffix}`,
      values,
    };
  });
}
