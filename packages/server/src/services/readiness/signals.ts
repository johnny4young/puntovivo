/**
 * Shared readiness signal readers.
 *
 * One implementation of each "is X ready?" probe, consumed by BOTH the
 * company-level `setupReadiness.get` aggregator AND the cashier-facing
 * `setupReadiness.checkout` query, so the two surfaces never drift.
 * Every reader is tenant-scoped (and site-scoped where the signal is
 * site-specific); none throws.
 *
 * These probes gate on configuration PRESENCE + outbox/sync health, not
 * on cryptographic fiscal validity (certificate / CUFE signing /
 * provider transmission are mock and deferred to ).
 *
 * @module services/readiness/signals
 */

import { and, count, eq, inArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { fiscalOutbox, sitePeripherals, syncConflicts, syncOutbox } from '../../db/schema.js';
import { isCountryFiscalEnabled, isDianFlagOn } from '../fiscal/orchestrator/helpers.js';
import { readCoFiscalSettings, validateCoEmissionConfig } from '../fiscal/packs/co/settings.js';
import {
  numberingEnvironmentFromSettings,
  peekNumberingRange,
} from '../fiscal/numbering/select.js';
import { getFiscalAdapter } from '../fiscal/registry.js';
import { readPaymentRailCredentials } from '../payments/credentials.js';
import { PAYMENT_RAIL_IDS } from '../payments/manifest.js';

/**
 * What the next sale at a site gets from the Colombian DIAN path.
 * `issuing` means a document intent will queue; every other state means the
 * sale completes without an electronic document.
 */
export type CheckoutFiscalState =
  | 'issuing'
  | 'disabled'
  | 'issuer_incomplete'
  | 'numbering_missing'
  // No DEE range, but a buyer-requested invoice can still be numbered.
  | 'numbering_fev_only';

/**
 * Mirror the sale fiscal-intent gates for one site: the DIAN switch, the
 * issuer checks emission runs, and a usable active DEE range in the numbering
 * table. The blob's resolution fields are not read: emission never reads them.
 */
export async function readCheckoutFiscalState(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    settings: Record<string, unknown>;
    at?: string;
  }
): Promise<CheckoutFiscalState> {
  const { tenantId, siteId, settings } = args;
  if (!isDianFlagOn(settings) || !isCountryFiscalEnabled(settings, 'CO')) return 'disabled';
  if (!validateCoEmissionConfig(readCoFiscalSettings(settings)).ok) return 'issuer_incomplete';

  const lookup = {
    tenantId,
    siteId,
    environment: numberingEnvironmentFromSettings(settings),
    at: args.at ?? new Date().toISOString(),
  };
  if (peekNumberingRange(db, { ...lookup, kind: 'DEE' }).ok) return 'issuing';
  return peekNumberingRange(db, { ...lookup, kind: 'FEV' }).ok
    ? 'numbering_fev_only'
    : 'numbering_missing';
}

/**
 * Tenant-wide view for the setup overview: the worst state across the active
 * sites, so the admin checklist and every register agree.
 */
export async function readTenantFiscalState(
  db: DatabaseInstance,
  args: { tenantId: string; siteIds: readonly string[]; settings: Record<string, unknown> }
): Promise<CheckoutFiscalState> {
  if (args.siteIds.length === 0) {
    return readCheckoutFiscalState(db, { ...args, siteId: '' });
  }
  const states = await Promise.all(
    args.siteIds.map(siteId => readCheckoutFiscalState(db, { ...args, siteId }))
  );
  const worst: CheckoutFiscalState[] = [
    'disabled',
    'issuer_incomplete',
    'numbering_missing',
    'numbering_fev_only',
  ];
  return worst.find(state => states.includes(state)) ?? 'issuing';
}

/**
 * Count configured payment rails on a `tenants.settings` blob — a rail
 * is configured when it has a non-empty credentials map. Pure (no DB).
 */
export function countConfiguredPaymentRails(
  settings: Record<string, unknown> | null | undefined
): number {
  const blob = settings ?? {};
  return PAYMENT_RAIL_IDS.filter(
    railId => Object.keys(readPaymentRailCredentials(blob, railId)).length > 0
  ).length;
}

/** Fiscal-document outbox terminal-failure statuses that need attention. */
const FISCAL_OUTBOX_FAILURE_STATUSES = ['rejected', 'dead_letter'] as const;

/**
 * Count fiscal-document outbox rows in a terminal-failure state
 * (rejected / dead_letter) for the tenant. A positive count means
 * emitted documents are failing to reach DIAN — surfaced as a warning,
 * never a sale blocker (: emission is out-of-band).
 */
export async function countFiscalOutboxFailures(
  db: DatabaseInstance,
  tenantId: string
): Promise<number> {
  const row = await db
    .select({ total: count(fiscalOutbox.id) })
    .from(fiscalOutbox)
    .where(
      and(
        eq(fiscalOutbox.tenantId, tenantId),
        inArray(fiscalOutbox.status, [...FISCAL_OUTBOX_FAILURE_STATUSES])
      )
    )
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Count active receipt printers for the tenant, optionally scoped to a
 * site. Receipt hardware is optional (a broken/absent printer never
 * blocks a sale — the cashier reprints later), so this only feeds a
 * reminder.
 */
export async function countActiveReceiptPrinters(
  db: DatabaseInstance,
  tenantId: string,
  siteId?: string | null
): Promise<number> {
  const conditions = [
    eq(sitePeripherals.tenantId, tenantId),
    eq(sitePeripherals.kind, 'printer'),
    eq(sitePeripherals.isActive, true),
  ];
  if (siteId) {
    conditions.push(eq(sitePeripherals.siteId, siteId));
  }
  const row = await db
    .select({ total: count(sitePeripherals.id) })
    .from(sitePeripherals)
    .where(and(...conditions))
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Sync backlog snapshot: in-flight outbox work + unresolved conflicts.
 *
 * Pending conflicts live in `sync_conflicts`; legacy terminal outbox rows
 * (`conflict` / `dead_letter`) still count so older DB state does not fall
 * through the readiness / Operations attention probes.
 */
export interface SyncBacklog {
  /** Rows still pending sync (queued / submitting / retrying). */
  pending: number;
  /** Rows stuck in conflict or dead_letter — need operator attention. */
  conflicts: number;
}

const SYNC_PENDING_STATUSES = ['queued', 'submitting', 'retrying'] as const;
const SYNC_TERMINAL_CONFLICT_STATUSES = ['conflict', 'dead_letter'] as const;

/**
 * Read the sync backlog for the tenant. A backlog never blocks a sale
 * (the app is local-first; sync catches up out-of-band) — it only
 * feeds a reminder so the operator knows replication is behind.
 */
export async function readSyncBacklog(
  db: DatabaseInstance,
  tenantId: string
): Promise<SyncBacklog> {
  const [pendingRow, terminalOutboxRow, conflictRow] = await Promise.all([
    db
      .select({ total: count(syncOutbox.id) })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          inArray(syncOutbox.status, [...SYNC_PENDING_STATUSES])
        )
      )
      .get(),
    db
      .select({ total: count(syncOutbox.id) })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          inArray(syncOutbox.status, [...SYNC_TERMINAL_CONFLICT_STATUSES])
        )
      )
      .get(),
    db
      .select({ total: count(syncConflicts.id) })
      .from(syncConflicts)
      .where(and(eq(syncConflicts.tenantId, tenantId), eq(syncConflicts.status, 'pending')))
      .get(),
  ]);
  return {
    pending: Number(pendingRow?.total ?? 0),
    conflicts: Number(terminalOutboxRow?.total ?? 0) + Number(conflictRow?.total ?? 0),
  };
}

/**
 * True while Colombian documents are local only: the pack is not certified,
 * or the tenant runs the DIAN enablement environment.
 */
export function isCoFiscalTestMode(settings: Record<string, unknown>): boolean {
  return (
    getFiscalAdapter('CO').maturity !== 'certified' ||
    readCoFiscalSettings(settings).environment !== 'produccion'
  );
}
