/** Stable English identifiers persisted in Operations deep links. */
const OPERATIONS_TAB_KEYS = [
  'attention',
  'support',
  'sync',
  'fiscal',
  'device',
  'cash',
  'payments',
  'alerts',
  'webhooks',
  'diagnostics',
  'authority',
] as const;

export type OperationsTabKey = (typeof OPERATIONS_TAB_KEYS)[number];
export type OperationsAdvancedTabKey = Exclude<OperationsTabKey, 'attention'>;

/** Exact surfaces that can receive focus from an in-app recovery handoff. */
const OPERATIONS_FOCUS_TARGETS = ['registered-devices'] as const;

export type OperationsFocusTarget = (typeof OPERATIONS_FOCUS_TARGETS)[number];

export const OPERATIONS_TAB_TRANSLATION_KEYS = {
  support: 'tabs.support',
  sync: 'tabs.sync',
  fiscal: 'tabs.fiscal',
  device: 'tabs.device',
  cash: 'tabs.cash',
  payments: 'tabs.payments',
  alerts: 'tabs.alerts',
  webhooks: 'tabs.webhooks',
  diagnostics: 'tabs.diagnostics',
  authority: 'tabs.authority',
} as const satisfies Record<OperationsAdvancedTabKey, string>;

/**
 * Technical recovery stays available to administrators without competing with
 * the store-status landing. The stable tab ids preserve existing deep links.
 */
export const OPERATIONS_ADVANCED_TAB_GROUPS = [
  {
    id: 'recovery',
    labelKey: 'navigation.groups.recovery',
    tabs: ['support', 'sync', 'fiscal', 'device', 'payments', 'cash'],
  },
  {
    id: 'evidence',
    labelKey: 'navigation.groups.evidence',
    tabs: ['alerts', 'webhooks', 'diagnostics', 'authority'],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: string;
  tabs: readonly OperationsAdvancedTabKey[];
}>;

export function isOperationsTabKey(value: string | null): value is OperationsTabKey {
  return value !== null && (OPERATIONS_TAB_KEYS as readonly string[]).includes(value);
}

export function isOperationsFocusTarget(value: string | null): value is OperationsFocusTarget {
  return value !== null && (OPERATIONS_FOCUS_TARGETS as readonly string[]).includes(value);
}
