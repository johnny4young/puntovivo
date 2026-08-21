import type { ClientModuleId } from '@/features/modules';

/** Stable English identifiers persisted in the company setup URL. */
const COMPANY_TAB_KEYS = [
  'readiness',
  'general',
  'controls',
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

/** Exact surfaces that can receive focus from an in-app recovery handoff. */
const COMPANY_FOCUS_TARGETS = ['app-updates', 'backup-restore', 'telemetry'] as const;

export type CompanyFocusTarget = (typeof COMPANY_FOCUS_TARGETS)[number];

export const COMPANY_TAB_TRANSLATION_KEYS = {
  readiness: 'company.tabs.readiness',
  general: 'company.tabs.general',
  controls: 'company.tabs.controls',
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
 * Every legacy configuration destination belongs to one advanced group.
 * The guided readiness route remains the admin landing while these stable
 * tab ids preserve existing deep links from recovery and feature surfaces.
 */
/**
 * Tabs that only exist for a tenant running the matching module. Absent
 * from this map means the tab is always available.
 */
export const COMPANY_TAB_REQUIRED_MODULE: Partial<Record<CompanyTabKey, ClientModuleId>> = {
  restaurant: 'dine-in',
};

export const COMPANY_SETUP_TAB_GROUPS = [
  {
    id: 'business',
    labelKey: 'company.tabs.groups.business',
    tabs: ['general', 'controls', 'locale', 'restaurant'],
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

export function isCompanyFocusTarget(value: string | null): value is CompanyFocusTarget {
  return value !== null && (COMPANY_FOCUS_TARGETS as readonly string[]).includes(value);
}
