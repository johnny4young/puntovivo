/**
 * ENG-104 — `setupReadiness.*` tRPC router.
 *
 * Aggregates the per-section readiness signals that live across the
 * fiscal, payments, peripherals, modules, users, sites, products, AI
 * and locale procedures into a single payload the renderer can
 * consume from one place. The matrix anchors on `docs/SELLABILITY.md`
 * lines 28-37 so any future pilot blocker added there gets a section
 * here in lockstep.
 *
 * The procedure deliberately does NOT call other tRPC procedures
 * server-side (would re-walk middleware stacks); it reads the same
 * tables directly via Drizzle, scoped by `ctx.tenantId`.
 *
 * Score formula:
 *   applicable = sections with status !== 'not-applicable'
 *   softStates = optional-pending + warning
 *   score = round( (ready + 0.5 × softStates) / applicable × 100 )
 *   blocker contributions count 0 toward the numerator.
 *
 * @module trpc/routers/setupReadiness
 */

import { and, count, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessions,
  products,
  sitePeripherals,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../../db/schema.js';
import { resolveModulesState } from '../../services/modules/manifest.js';
import { readPaymentRailCredentials } from '../../services/payments/credentials.js';
import { PAYMENT_RAIL_IDS } from '../../services/payments/manifest.js';
import { resolveReadinessProfile } from '../../services/readiness/profile.js';
import {
  countActiveReceiptPrinters,
  countConfiguredPaymentRails,
  countFiscalOutboxFailures,
  readFiscalConfigState,
  readSyncBacklog,
} from '../../services/readiness/signals.js';
import { router } from '../init.js';
import {
  cashierManagerOrAdminProcedure,
  managerOrAdminProcedure,
} from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  checkoutReadinessInputSchema,
  checkoutReadinessOutputSchema,
  setupReadinessOutputSchema,
  type CheckoutReadinessItem,
  type CheckoutReadinessOutput,
  type SetupReadinessOutput,
  type SetupReadinessSection,
} from '../schemas/setupReadiness.js';

/**
 * ENG-184 — a sync backlog above this many pending rows trips the
 * `sync` readiness warning. Small transient backlogs are normal in a
 * local-first app; only a sustained queue is worth a reminder.
 */
const SYNC_BACKLOG_WARN_THRESHOLD = 25;

function hasPopulatedSettingsValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return value === true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasPopulatedSettingsValue);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(
      hasPopulatedSettingsValue
    );
  }
  return false;
}

/**
 * Resolve the per-tenant readiness payload. All queries scope by
 * `tenantId`. Returns a stable shape (11 sections, one per id in
 * `setupReadinessSectionIdEnum`) regardless of tenant state —
 * sections never disappear; their `status` carries the meaning.
 */
async function buildReadiness(args: {
  db: DatabaseInstance;
  tenantId: string;
}): Promise<SetupReadinessOutput> {
  const { db, tenantId } = args;

  // --- Raw signals -------------------------------------------------

  const tenantRow = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settingsBlob =
    (tenantRow?.settings as Record<string, unknown> | null | undefined) ?? null;
  const settings =
    settingsBlob && typeof settingsBlob === 'object'
      ? (settingsBlob as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const localeRow = await db
    .select({
      countryCode: tenantLocaleSettings.countryCode,
    })
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
    .where(
      and(
        eq(sitePeripherals.tenantId, tenantId),
        eq(sitePeripherals.isActive, true)
      )
    )
    .get();
  const peripheralCount = Number(peripheralsRow?.total ?? 0);

  const openSessionRow = await db
    .select({ total: count(cashSessions.id) })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.status, 'open')
      )
    )
    .get();
  const openCashSessionCount = Number(openSessionRow?.total ?? 0);

  // --- Section derivations ----------------------------------------

  /** Helper: build a section row with a deep-linked CTA. */
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
      cta:
        status === 'not-applicable'
          ? null
          : { route, ...(tab ? { tab } : {}) },
    };
  };

  // locale: present + countryCode populated.
  const localeStatus: SetupReadinessSection['status'] =
    localeRow?.countryCode && localeRow.countryCode.trim().length > 0
      ? 'ready'
      : 'blocker';

  // sites: at least one active site.
  const sitesStatus: SetupReadinessSection['status'] =
    siteCount >= 1 ? 'ready' : 'blocker';

  // fiscal: behaviour depends on the market profile (ENG-184).
  const profile = resolveReadinessProfile(localeRow?.countryCode);
  let fiscalStatus: SetupReadinessSection['status'];
  if (profile.surfaceFiscalReminders) {
    // Colombia: DIAN is OPTIONAL and NEVER blocks selling. Surface it
    // as a visible reminder so the merchant knows whether they are
    // issuing electronic invoices and can activate when ready.
    //   off                       → optional-pending (opt-in reminder)
    //   on + config incomplete    → warning (finish setup)
    //   on + complete + healthy   → ready
    //   on + complete + tx errors → warning (documents failing)
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
    // Legacy (non-Colombia) behaviour, unchanged: the master kill-switch
    // lives at `tenants.settings.fiscal_dian_enabled`; off → not-applicable.
    // On → 'ready' when any per-country profile is populated, else 'blocker'.
    const fiscalEnabled = settings['fiscal_dian_enabled'] === true;
    const fiscalBlob = settings['fiscal'];
    const hasFiscalProfile =
      fiscalBlob && typeof fiscalBlob === 'object'
        ? Object.values(fiscalBlob as Record<string, unknown>).some(
            hasPopulatedSettingsValue
          )
        : false;
    fiscalStatus = fiscalEnabled
      ? hasFiscalProfile
        ? 'ready'
        : 'blocker'
      : 'not-applicable';
  }

  // peripherals: hardware is opt-in, so zero is optional-pending
  // (not a blocker). One or more rows → ready.
  const peripheralsStatus: SetupReadinessSection['status'] =
    peripheralCount >= 1 ? 'ready' : 'optional-pending';

  // payments: the payment rails registry lives under
  // `tenants.settings.payments.<railId>`. If at least one rail has a
  // non-empty credentials blob the rail is considered configured.
  // Manual cash always works, so zero rails is optional-pending
  // rather than blocker.
  const configuredRailCount = PAYMENT_RAIL_IDS.filter(
    railId => Object.keys(readPaymentRailCredentials(settings, railId)).length > 0
  ).length;
  const paymentsStatus: SetupReadinessSection['status'] =
    configuredRailCount >= 1 ? 'ready' : 'optional-pending';

  // modules: the activation kernel always has at least one default-on
  // module (operations-center, copilot, etc.). The resolved state
  // therefore always reports something — we treat this as 'ready'
  // when ≥1 module is enabled.
  const modulesBlob =
    settings['modules'] && typeof settings['modules'] === 'object'
      ? (settings['modules'] as Record<string, unknown>)
      : undefined;
  const effectiveModules = resolveModulesState(modulesBlob);
  const enabledModuleCount = Object.values(effectiveModules).filter(
    v => v === true
  ).length;
  const modulesStatus: SetupReadinessSection['status'] =
    enabledModuleCount >= 1 ? 'ready' : 'optional-pending';

  // users: admin alone is a one-person shop (optional-pending);
  // adding at least one staff user makes the section ready.
  const usersStatus: SetupReadinessSection['status'] =
    userCount >= 2 ? 'ready' : 'optional-pending';

  // ai: opt-in. AI master toggle off → not-applicable. On + at least
  // one provider entry under `tenants.settings.ai.providers` →
  // ready. On + no providers → optional-pending.
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

  // catalog: products are the gate to selling. Zero products → blocker.
  const catalogStatus: SetupReadinessSection['status'] =
    productCount >= 1 ? 'ready' : 'blocker';

  // cashSession: at least one open session somewhere in the tenant
  // → ready. Zero open sessions is optional-pending (the cashier
  // can open one any time before ringing the first sale).
  const cashSessionStatus: SetupReadinessSection['status'] =
    openCashSessionCount >= 1 ? 'ready' : 'optional-pending';

  // sync (ENG-184): replication is local-first, so a backlog never
  // blocks — it surfaces a warning so the operator knows sync is behind
  // or has unresolved conflicts. Healthy / empty → ready.
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

  // --- Score ------------------------------------------------------

  const applicable = sections.filter(s => s.status !== 'not-applicable');
  const readyCount = applicable.filter(s => s.status === 'ready').length;
  // ENG-184 — `warning` scores at the same half-weight as
  // `optional-pending` (configured-but-degraded / opt-in reminder).
  const halfWeightCount = applicable.filter(
    s => s.status === 'optional-pending' || s.status === 'warning'
  ).length;
  const blockerCount = applicable.filter(s => s.status === 'blocker').length;
  const denominator = applicable.length;
  const score =
    denominator === 0
      ? 0
      : Math.round(
          ((readyCount + 0.5 * halfWeightCount) / denominator) * 100
        );

  // --- Acknowledged timestamp -------------------------------------

  const acknowledgedAt =
    typeof settings['setupAcknowledgedAt'] === 'string'
      ? (settings['setupAcknowledgedAt'] as string)
      : null;

  return {
    score,
    blockerCount,
    sections,
    acknowledgedAt,
  };
}

/**
 * ENG-184 — Build the cashier-facing checkout readiness reminders for a
 * (tenant, site). EVERY item is a `warning`: selling is never blocked by
 * fiscal / hardware / payment / sync state (local-first + the
 * best-effort fiscal invariant — a sale never rolls back on fiscal
 * failure). Reminders are scoped to the Colombia retail profile today;
 * a non-CO tenant gets an empty list, so its checkout flow is unchanged.
 */
async function buildCheckoutReadiness(args: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
}): Promise<CheckoutReadinessOutput> {
  const { db, tenantId, siteId } = args;

  const tenantRow = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings =
    tenantRow?.settings && typeof tenantRow.settings === 'object'
      ? (tenantRow.settings as Record<string, unknown>)
      : {};

  const localeRow = await db
    .select({ countryCode: tenantLocaleSettings.countryCode })
    .from(tenantLocaleSettings)
    .where(eq(tenantLocaleSettings.tenantId, tenantId))
    .get();
  const profile = resolveReadinessProfile(localeRow?.countryCode);

  if (!profile.surfaceFiscalReminders) {
    return { items: [] };
  }

  const items: CheckoutReadinessItem[] = [];

  // fiscal: DIAN off or config incomplete → this sale will not emit an
  // electronic invoice. Reminder only; the sale proceeds.
  const fiscalState = readFiscalConfigState(settings);
  if (!fiscalState.enabled || !fiscalState.configured) {
    items.push({
      id: 'fiscal',
      severity: 'warning',
      cta: { route: '/company', tab: 'fiscal' },
    });
  }

  // receipt hardware: no active printer at this site → reprint later.
  const printers = await countActiveReceiptPrinters(db, tenantId, siteId);
  if (printers === 0) {
    items.push({
      id: 'receipt_hardware',
      severity: 'warning',
      cta: { route: '/peripherals' },
    });
  }

  // payment rails: only manual cash configured.
  if (countConfiguredPaymentRails(settings) === 0) {
    items.push({
      id: 'payment_rail',
      severity: 'warning',
      cta: { route: '/company', tab: 'payments' },
    });
  }

  // sync backlog: replication behind / unresolved conflicts.
  const backlog = await readSyncBacklog(db, tenantId);
  if (backlog.conflicts > 0 || backlog.pending > SYNC_BACKLOG_WARN_THRESHOLD) {
    items.push({
      id: 'sync',
      severity: 'warning',
      cta: { route: '/operations' },
    });
  }

  return { items };
}

export const setupReadinessRouter = router({
  /**
   * Aggregate the readiness payload for the active tenant. Returns
   * a fixed-shape array of 11 sections — sections never disappear,
   * the renderer uses the `status` enum to decide rendering.
   *
   * The query is cheap (a handful of small COUNT(*) + 1 settings read);
   * React Query staleTime keeps the call out of the hot path. The
   * procedure is read-only and emits no audit row.
   */
  get: managerOrAdminProcedure
    .output(setupReadinessOutputSchema)
    .query(async ({ ctx }) => {
      return buildReadiness({ db: ctx.db, tenantId: ctx.tenantId });
    }),

  /**
   * ENG-184 — Cashier-facing checkout readiness. Returns the reminder
   * rows the POS surfaces before charging (fiscal not active, no
   * printer, no payment rail, sync backlog). All `warning` severity —
   * never blocks the sale. Callable by sales roles; site-scoped and
   * tenant-validated via `ensureTenantSite`.
   */
  checkout: cashierManagerOrAdminProcedure
    .input(checkoutReadinessInputSchema)
    .output(checkoutReadinessOutputSchema)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return buildCheckoutReadiness({
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: input.siteId,
      });
    }),
});

export type SetupReadinessRouter = typeof setupReadinessRouter;
