import type { TFunction } from 'i18next';

/** Rule shown next to a group's name, as on the plate sheet: «Elija uno», «Hasta 3». */
export function groupRule(
  t: TFunction,
  group: { selection: 'single' | 'multiple'; minSelections: number; maxSelections: number }
): string {
  const { minSelections: min, maxSelections: max } = group;
  if (group.selection === 'single')
    return t(min ? 'restaurants:groups.rule.chooseOne' : 'restaurants:groups.rule.atMostOne');
  if (min === 0) return t('restaurants:groups.rule.upTo', { count: max });
  if (min === max) return t('restaurants:groups.rule.exactly', { count: max });
  return t('restaurants:groups.rule.range', { min, max });
}
