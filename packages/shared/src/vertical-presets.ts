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
  'pharmacy',
] as const;

export type VerticalPresetId = (typeof VERTICAL_PRESET_IDS)[number];

export function isVerticalPresetId(value: unknown): value is VerticalPresetId {
  return VERTICAL_PRESET_IDS.includes(value as VerticalPresetId);
}

/** Profiles that currently offer explicit product-entry templates. */
export const PRODUCT_TEMPLATE_VERTICAL_IDS = ['hardware', 'butchery'] as const;

export type ProductTemplateVerticalId = (typeof PRODUCT_TEMPLATE_VERTICAL_IDS)[number];

/** Profiles that sell on the touch register instead of desktop Vender. */
export const TOUCH_REGISTER_VERTICAL_IDS = ['restaurant', 'quickservice'] as const;

export function isTouchRegisterVerticalId(value: unknown): boolean {
  return TOUCH_REGISTER_VERTICAL_IDS.includes(
    value as (typeof TOUCH_REGISTER_VERTICAL_IDS)[number]
  );
}

/** Profiles that sell to companies on account rather than fiar to neighbours. */
export const ON_ACCOUNT_VERTICAL_IDS = ['hardware', 'wholesale'] as const;

export function isOnAccountVerticalId(value: unknown): boolean {
  return ON_ACCOUNT_VERTICAL_IDS.includes(value as (typeof ON_ACCOUNT_VERTICAL_IDS)[number]);
}

export function isProductTemplateVerticalId(value: unknown): value is ProductTemplateVerticalId {
  return PRODUCT_TEMPLATE_VERTICAL_IDS.includes(value as ProductTemplateVerticalId);
}
