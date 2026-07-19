import { and, count, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../../db/index.js';
import {
  cashSessions,
  products,
  sitePeripherals,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../../../db/schema.js';
import { resolveModulesState } from '../../../services/modules/manifest.js';
import { readPaymentRailCredentials } from '../../../services/payments/credentials.js';
import { PAYMENT_RAIL_IDS } from '../../../services/payments/manifest.js';
import { resolveReadinessProfile } from '../../../services/readiness/profile.js';
import {
  countFiscalOutboxFailures,
  readFiscalConfigState,
  readSyncBacklog,
} from '../../../services/readiness/signals.js';
import type { SetupReadinessOutput, SetupReadinessSection } from '../../schemas/setupReadiness.js';
import { SYNC_BACKLOG_WARN_THRESHOLD } from './constants.js';

/**
 * Aggregates the fiscal, payments, peripherals, modules, users, sites,
 * products, AI, locale, cash-session, and sync signals in one projection.
 * The matrix stays aligned with docs/SELLABILITY.md lines 28-37.
 *
 * Score = round((ready + 0.5 * (optional-pending + warning)) / applicable
 * sections * 100). Blockers contribute zero and not-applicable sections do
 * not enter the denominator.
 */

function hasPopulatedSettingsValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return value === true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasPopulatedSettingsValue);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasPopulatedSettingsValue);
  }
  return false;
}

/**
 * Resolve the per-tenant readiness payload. All queries scope by tenantId.
 * Returns a stable shape regardless of tenant state: sections never disappear;
 * their status carries the meaning. This reads the source tables directly
 * instead of re-walking other tRPC middleware stacks server-side.
 */
export async function buildReadiness(args: {
  db: DatabaseInstance;
  tenantId: string;
}): Promise<SetupReadinessOutput> {
  const { db, tenantId } = args;

  const tenantRow = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settingsBlob = (tenantRow?.settings as Record<string, unknown> | null | undefined) ?? null;
  const settings =
    settingsBlob && typeof settingsBlob === 'object'
      ? (settingsBlob as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const localeRow = await db
    .select({ countryCode: tenantLocaleSettings.countryCode })
    .from(tenantLocaleSettings)
    .where(eq(tenantLocaleSettings.tenantId, tenantId))
    .get();

  const sitesRow = await db
    .select({ total: count(sites.id) })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  const siteCount = Number(sitesRow?.total ?? 0);

  const productsRow = await db
    .select({ total: count(products.id) })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.isActive, true)))
    .get();
  const productCount = Number(productsRow?.total ?? 0);

  const usersRow = await db
    .select({ total: count(users.id) })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)))
    .get();
  const userCount = Number(usersRow?.total ?? 0);

  const peripheralsRow = await db
    .select({ total: count(sitePeripherals.id) })
    .from(sitePeripherals)
    .where(and(eq(sitePeripherals.tenantId, tenantId), eq(sitePeripherals.isActive, true)))
    .get();
  const peripheralCount = Number(peripheralsRow?.total ?? 0);

  const openSessionRow = await db
    .select({ total: count(cashSessions.id) })
    .from(cashSessions)
    .where(and(eq(cashSessions.tenantId, tenantId), eq(cashSessions.status, 'open')))
    .get();
  const openCashSessionCount = Number(openSessionRow?.total ?? 0);

  const section = (
    id: SetupReadinessSection['id'],
    status: SetupReadinessSection['status'],
    target?: { route?: string; tab?: string }
  ): SetupReadinessSection => {
    const route = target?.route ?? '/company';
    const tab = target?.tab ?? (route === '/company' ? id : undefined);
    return {
      id,
      status,
      cta: status === 'not-applicable' ? null : { route, ...(tab ? { tab } : {}) },
    };
  };

  const localeStatus: SetupReadinessSection['status'] =
    localeRow?.countryCode && localeRow.countryCode.trim().length > 0 ? 'ready' : 'blocker';
  const sitesStatus: SetupReadinessSection['status'] = siteCount >= 1 ? 'ready' : 'blocker';

  // ENG-184 — fiscal readiness depends on the market profile. Colombia keeps
  // DIAN optional and never blocks selling; other markets retain the legacy
  // kill-switch behavior.
  const profile = resolveReadinessProfile(localeRow?.countryCode);
  let fiscalStatus: SetupReadinessSection['status'];
  if (profile.surfaceFiscalReminders) {
    const fiscalState = readFiscalConfigState(settings);
    if (!fiscalState.enabled) {
      fiscalStatus = 'optional-pending';
    } else if (!fiscalState.configured) {
      fiscalStatus = 'warning';
    } else {
      const outboxFailures = await countFiscalOutboxFailures(db, tenantId);
      fiscalStatus = outboxFailures > 0 ? 'warning' : 'ready';
    }
  } else {
    const fiscalEnabled = settings['fiscal_dian_enabled'] === true;
    const fiscalBlob = settings['fiscal'];
    const hasFiscalProfile =
      fiscalBlob && typeof fiscalBlob === 'object'
        ? Object.values(fiscalBlob as Record<string, unknown>).some(hasPopulatedSettingsValue)
        : false;
    fiscalStatus = fiscalEnabled ? (hasFiscalProfile ? 'ready' : 'blocker') : 'not-applicable';
  }

  const peripheralsStatus: SetupReadinessSection['status'] =
    peripheralCount >= 1 ? 'ready' : 'optional-pending';
  const configuredRailCount = PAYMENT_RAIL_IDS.filter(
    railId => Object.keys(readPaymentRailCredentials(settings, railId)).length > 0
  ).length;
  const paymentsStatus: SetupReadinessSection['status'] =
    configuredRailCount >= 1 ? 'ready' : 'optional-pending';

  const modulesBlob =
    settings['modules'] && typeof settings['modules'] === 'object'
      ? (settings['modules'] as Record<string, unknown>)
      : undefined;
  const effectiveModules = resolveModulesState(modulesBlob);
  const enabledModuleCount = Object.values(effectiveModules).filter(value => value === true).length;
  const modulesStatus: SetupReadinessSection['status'] =
    enabledModuleCount >= 1 ? 'ready' : 'optional-pending';
  const usersStatus: SetupReadinessSection['status'] =
    userCount >= 2 ? 'ready' : 'optional-pending';

  const aiBlob =
    settings['ai'] && typeof settings['ai'] === 'object'
      ? (settings['ai'] as Record<string, unknown>)
      : undefined;
  const aiEnabled = aiBlob?.['enabled'] === true;
  const aiProvidersBlob = aiBlob?.['providers'];
  const aiProviderCount =
    aiProvidersBlob && typeof aiProvidersBlob === 'object'
      ? Object.keys(aiProvidersBlob as Record<string, unknown>).length
      : 0;
  const aiStatus: SetupReadinessSection['status'] = !aiEnabled
    ? 'not-applicable'
    : aiProviderCount >= 1
      ? 'ready'
      : 'optional-pending';

  const catalogStatus: SetupReadinessSection['status'] = productCount >= 1 ? 'ready' : 'blocker';
  const cashSessionStatus: SetupReadinessSection['status'] =
    openCashSessionCount >= 1 ? 'ready' : 'optional-pending';

  // ENG-184 — local-first replication never blocks. A sustained backlog or
  // unresolved conflict is visible as a warning only.
  const syncBacklog = await readSyncBacklog(db, tenantId);
  const syncStatus: SetupReadinessSection['status'] =
    syncBacklog.conflicts > 0 || syncBacklog.pending > SYNC_BACKLOG_WARN_THRESHOLD
      ? 'warning'
      : 'ready';

  const sections: SetupReadinessSection[] = [
    section('locale', localeStatus, { tab: 'locale' }),
    section('sites', sitesStatus, { route: '/sites' }),
    section('fiscal', fiscalStatus, { tab: 'fiscal' }),
    section('peripherals', peripheralsStatus, { route: '/peripherals' }),
    section('payments', paymentsStatus, { tab: 'payments' }),
    section('modules', modulesStatus, { tab: 'modules' }),
    section('users', usersStatus, { route: '/users' }),
    section('ai', aiStatus, { tab: 'ai' }),
    section('catalog', catalogStatus, { route: '/products' }),
    section('cashSession', cashSessionStatus, { route: '/sales' }),
    section('sync', syncStatus, { route: '/operations' }),
  ];

  const applicable = sections.filter(s => s.status !== 'not-applicable');
  const readyCount = applicable.filter(s => s.status === 'ready').length;
  // ENG-184 — warning and optional-pending states both carry half weight.
  const halfWeightCount = applicable.filter(
    s => s.status === 'optional-pending' || s.status === 'warning'
  ).length;
  const blockerCount = applicable.filter(s => s.status === 'blocker').length;
  const score =
    applicable.length === 0
      ? 0
      : Math.round(((readyCount + 0.5 * halfWeightCount) / applicable.length) * 100);

  const acknowledgedAt =
    typeof settings['setupAcknowledgedAt'] === 'string'
      ? (settings['setupAcknowledgedAt'] as string)
      : null;

  return { score, blockerCount, sections, acknowledgedAt };
}
