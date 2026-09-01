/**
 * Business profiles shared by the server-owned module presets and renderer
 * guidance. Keeping the identifiers here prevents onboarding, readiness and
 * product templates from drifting into different closed sets.
 */
export const VERTICAL_PRESET_IDS = [
  'retail',
  'restaurant',
  'quickservice',
  'wholesale',
  'hardware',
  'butchery',
] as const;

export type VerticalPresetId = (typeof VERTICAL_PRESET_IDS)[number];

/** Profiles that currently offer explicit product-entry templates. */
export const PRODUCT_TEMPLATE_VERTICAL_IDS = ['hardware', 'butchery'] as const;

export type ProductTemplateVerticalId = (typeof PRODUCT_TEMPLATE_VERTICAL_IDS)[number];

export function isProductTemplateVerticalId(value: unknown): value is ProductTemplateVerticalId {
  return PRODUCT_TEMPLATE_VERTICAL_IDS.includes(value as ProductTemplateVerticalId);
}
