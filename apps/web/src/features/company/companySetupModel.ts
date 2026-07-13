/** Stable English identifiers persisted in the company setup URL. */
const COMPANY_TAB_KEYS = [
  'readiness',
  'general',
  'locale',
  'data',
  'device',
  'ai',
  'fiscal',
  'payments',
  'modules',
  'restaurant',
] as const;

export type CompanyTabKey = (typeof COMPANY_TAB_KEYS)[number];

export const COMPANY_TAB_TRANSLATION_KEYS = {
  readiness: 'company.tabs.readiness',
  general: 'company.tabs.general',
  locale: 'company.tabs.locale',
  data: 'company.tabs.data',
  device: 'company.tabs.device',
  ai: 'company.tabs.ai',
  fiscal: 'company.tabs.fiscal',
  payments: 'company.tabs.payments',
  modules: 'company.tabs.modules',
  restaurant: 'company.tabs.restaurant',
} as const satisfies Record<CompanyTabKey, string>;

/**
 * ENG-188 — readiness is pinned; every other setup tab belongs to exactly one
 * labeled category while preserving the existing URL contract. ENG-104 keeps
 * readiness as the admin landing; ENG-039d3 keeps restaurant preferences
 * available to every admin tenant.
 */
export const COMPANY_SETUP_TAB_GROUPS = [
  {
    id: 'business',
    labelKey: 'company.tabs.groups.business',
    tabs: ['general', 'locale', 'restaurant'],
  },
  {
    id: 'billing',
    labelKey: 'company.tabs.groups.billing',
    tabs: ['fiscal', 'payments'],
  },
  {
    id: 'system',
    labelKey: 'company.tabs.groups.system',
    tabs: ['modules', 'ai', 'data', 'device'],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: string;
  tabs: readonly CompanyTabKey[];
}>;

export function isCompanyTabKey(value: string | null): value is CompanyTabKey {
  return value !== null && (COMPANY_TAB_KEYS as readonly string[]).includes(value);
}
