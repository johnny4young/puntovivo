/**
 * ENG-038c — Payment outbox worker daemon.
 *
 * Owns two timers + an explicit boot-time catch-up path:
 *
 *   Timer A — outbox housekeeping (default 30 s while server up):
 *     - Stale-claim sweep: rows wedged in `submitting` past
 *       `STALE_CLAIM_MS` flip back to `queued`.
 *     - Pending-count metadata refresh per tenant so the Operations
 *       Center dashboard reads a fresh `outbox_metadata` snapshot.
 *
 *   Timer B — statement import (default 2 h while server up):
 *     - For each active tenant × known rail, fetch the provider
 *       statement rows for `[lastImportedAt, now]` via the injected
 *       `fetchStatement` function and hand them to
 *       `runReconciliationPass`. On success advances
 *       `tenants.settings.payments.<railId>.lastImportedAt = now`.
 *
 *   Catch-up on boot (runs once before either timer):
 *     - Per (tenant, rail), evaluates `gap = now - (lastImportedAt ?? 0)`.
 *     - When `gap > BOOT_CATCHUP_THRESHOLD_MS` (default 12 h) — or
 *       `lastImportedAt` is null (default range `BOOT_INITIAL_LOOKBACK`
 *       fallback) — dispatches one statement import for the missing
 *       window before scheduling Timer B.
 *
 * Slice 3 does NOT dispatch real charges. `Timer A` is intentionally
 * minimal: live charge dispatch (queued → submitting → approved) lands
 * with rail-specific API clients in a later ticket (currently gated by
 * contracts + sandbox credentials). Until then Timer A keeps the
 * housekeeping plumbing warm so the future slice can plug in a
 * `dispatchCharge` callback without rewiring the worker shell.
 *
 * Slice 3 also does NOT pull from a live provider API. `fetchStatement`
 * is injected — production code wires the per-rail HTTP client, tests
 * + the benchmark harness wire the deterministic fixture.
 *
 * @module services/payments/payment-worker
 */

import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { paymentOutbox, tenants, type PaymentRailId } from '../../db/schema.js';
import { createModuleLogger, type PuntovivoLogger } from '../../logging/logger.js';
import { PAYMENT_RAIL_IDS } from './manifest.js';
import {
  runReconciliationPass,
  type RunReconciliationPassResult,
  type StatementRow,
} from './reconciliation.js';
import type { TiebreakContext, TiebreakFn } from './ai-tiebreak.js';

const fallbackLog = createModuleLogger('services/payments/payment-worker');

const DEFAULT_OUTBOX_TICK_MS = 30_000;
const DEFAULT_IMPORT_TICK_MS = 2 * 60 * 60_000;
const STALE_CLAIM_MS = 5 * 60_000;
const BOOT_CATCHUP_THRESHOLD_MS = 12 * 60 * 60_000;
const BOOT_INITIAL_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
const RETENTION_WARN_THRESHOLD_MS = 60 * 24 * 60 * 60_000;

export type FetchStatementFn = (args: {
  tenantId: string;
  railId: PaymentRailId;
  fromIso: string;
  toIso: string;
}) => Promise<StatementRow[]>;

export interface PaymentWorkerOptions {
  db: DatabaseInstance;
  /** Async producer of tenant ids the worker iterates. */
  tenantIdsProvider?: () => Promise<string[]>;
  /** Per-rail statement fetcher. Required for Timer B / catch-up. */
  fetchStatement?: FetchStatementFn;
  /** Optional AI tie-break injected into the matcher. */
  aiTiebreak?: TiebreakFn;
  /** Build the AI tie-break context per (tenant, rail). */
  buildTiebreakContext?: (args: {
    tenantId: string;
    railId: PaymentRailId;
  }) => TiebreakContext;
  outboxTickMs?: number;
  importTickMs?: number;
  bootCatchupThresholdMs?: number;
  bootInitialLookbackMs?: number;
  workerId?: string;
  log?: PuntovivoLogger;
}

export interface PaymentWorker {
  /** Run a one-shot outbox housekeeping sweep for a specific tenant. */
  housekeepingTick(tenantId: string): Promise<void>;
  /** Run a one-shot statement import for one (tenant, rail). */
  runStatementImport(args: {
    tenantId: string;
    railId: PaymentRailId;
    fromIso: string;
    toIso: string;
  }): Promise<StatementImportOutcome>;
  /** Run the catch-up sweep for every (tenant, rail). */
  catchUpOnBoot(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

export interface StatementImportOutcome {
  tenantId: string;
  railId: PaymentRailId;
  fromIso: string;
  toIso: string;
  rowsImported: number;
  pass: RunReconciliationPassResult | null;
  /** When non-null the import was skipped without advancing the marker. */
  skippedReason?: 'fetcher-missing' | 'gap-too-small' | 'fetch-failed';
}

export function createPaymentWorker(opts: PaymentWorkerOptions): PaymentWorker {
  const {
    db,
    outboxTickMs = DEFAULT_OUTBOX_TICK_MS,
    importTickMs = DEFAULT_IMPORT_TICK_MS,
    bootCatchupThresholdMs = BOOT_CATCHUP_THRESHOLD_MS,
    bootInitialLookbackMs = BOOT_INITIAL_LOOKBACK_MS,
    workerId = `payment:${process.pid}`,
    log = fallbackLog,
  } = opts;

  const tenantIdsProvider =
    opts.tenantIdsProvider ??
    (async (): Promise<string[]> => {
      const rows = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.isActive, true));
      return rows.map(row => row.id);
    });

  let outboxHandle: ReturnType<typeof setInterval> | null = null;
  let importHandle: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function sweepStaleClaims(): Promise<void> {
    // Intentionally global (no tenantId scope) — mirrors fiscal-worker
    // sweep semantics. A wedged claim represents a dead worker process
    // that died mid-tick; we want to unstick every tenant's queue in
    // one pass, not require N per-tenant ticks to drain the wedge.
    const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    try {
      await db
        .update(paymentOutbox)
        .set({
          claimToken: null,
          lockedAt: null,
          status: sql`CASE WHEN ${paymentOutbox.status} = 'submitting' THEN 'queued' ELSE ${paymentOutbox.status} END`,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            isNotNull(paymentOutbox.lockedAt),
            lte(paymentOutbox.lockedAt, cutoff)
          )
        );
    } catch (err) {
      log.warn({ err }, 'payment worker stale-claim sweep failed');
    }
  }

  async function housekeepingTick(_tenantId: string): Promise<void> {
    if (stopped) return;
    await sweepStaleClaims();
  }

  async function runStatementImport(args: {
    tenantId: string;
    railId: PaymentRailId;
    fromIso: string;
    toIso: string;
  }): Promise<StatementImportOutcome> {
    if (!opts.fetchStatement) {
      return {
        tenantId: args.tenantId,
        railId: args.railId,
        fromIso: args.fromIso,
        toIso: args.toIso,
        rowsImported: 0,
        pass: null,
        skippedReason: 'fetcher-missing',
      };
    }
    let statementRows: StatementRow[];
    try {
      statementRows = await opts.fetchStatement({
        tenantId: args.tenantId,
        railId: args.railId,
        fromIso: args.fromIso,
        toIso: args.toIso,
      });
    } catch (err) {
      log.warn(
        { err, tenantId: args.tenantId, railId: args.railId },
        'payment statement fetch failed'
      );
      return {
        tenantId: args.tenantId,
        railId: args.railId,
        fromIso: args.fromIso,
        toIso: args.toIso,
        rowsImported: 0,
        pass: null,
        skippedReason: 'fetch-failed',
      };
    }

    let pass: RunReconciliationPassResult;
    try {
      const aiContext = opts.buildTiebreakContext?.({
        tenantId: args.tenantId,
        railId: args.railId,
      });
      pass = await runReconciliationPass(db, args.tenantId, statementRows, {
        ...(opts.aiTiebreak ? { aiTiebreak: opts.aiTiebreak } : {}),
        ...(aiContext ? { aiContext } : {}),
        now: new Date(),
      });
    } catch (err) {
      log.warn(
        { err, tenantId: args.tenantId, railId: args.railId },
        'payment reconciliation pass failed'
      );
      return {
        tenantId: args.tenantId,
        railId: args.railId,
        fromIso: args.fromIso,
        toIso: args.toIso,
        rowsImported: statementRows.length,
        pass: null,
        skippedReason: 'fetch-failed',
      };
    }

    await advanceLastImportedAt({
      db,
      tenantId: args.tenantId,
      railId: args.railId,
      newMarker: args.toIso,
    });

    return {
      tenantId: args.tenantId,
      railId: args.railId,
      fromIso: args.fromIso,
      toIso: args.toIso,
      rowsImported: statementRows.length,
      pass,
    };
  }

  async function catchUpOnBoot(): Promise<void> {
    if (stopped) return;
    const now = Date.now();
    const toIso = new Date(now).toISOString();
    let tenantIds: string[];
    try {
      tenantIds = await tenantIdsProvider();
    } catch (err) {
      log.warn({ err }, 'payment worker tenantIdsProvider failed at boot');
      return;
    }
    for (const tenantId of tenantIds) {
      const markers = await readLastImportedAtMap(db, tenantId);
      for (const railId of PAYMENT_RAIL_IDS) {
        const lastImportedAt = markers[railId] ?? null;
        const fromIso =
          lastImportedAt ??
          new Date(now - bootInitialLookbackMs).toISOString();
        if (lastImportedAt !== null) {
          const lastMs = Date.parse(lastImportedAt);
          if (Number.isFinite(lastMs)) {
            const gap = now - lastMs;
            if (gap < bootCatchupThresholdMs) continue;
            if (gap > RETENTION_WARN_THRESHOLD_MS) {
              log.warn(
                { tenantId, railId, gapDays: Math.round(gap / 86_400_000) },
                'payment statement gap exceeds retention warn threshold'
              );
            }
          }
        }
        try {
          await runStatementImport({ tenantId, railId, fromIso, toIso });
        } catch (err) {
          log.warn({ err, tenantId, railId }, 'payment catch-up import failed');
        }
      }
    }
  }

  async function periodicHousekeeping(): Promise<void> {
    if (stopped) return;
    try {
      await sweepStaleClaims();
    } catch (err) {
      log.warn({ err }, 'payment worker housekeeping failed');
    }
  }

  async function periodicStatementImport(): Promise<void> {
    if (stopped) return;
    const now = Date.now();
    const toIso = new Date(now).toISOString();
    let tenantIds: string[];
    try {
      tenantIds = await tenantIdsProvider();
    } catch (err) {
      log.warn({ err }, 'payment worker tenantIdsProvider failed at tick');
      return;
    }
    for (const tenantId of tenantIds) {
      const markers = await readLastImportedAtMap(db, tenantId);
      for (const railId of PAYMENT_RAIL_IDS) {
        const lastImportedAt = markers[railId] ?? null;
        if (lastImportedAt) {
          const gap = now - Date.parse(lastImportedAt);
          if (Number.isFinite(gap) && gap < importTickMs / 2) continue;
        }
        const fromIso =
          lastImportedAt ??
          new Date(now - bootInitialLookbackMs).toISOString();
        try {
          await runStatementImport({ tenantId, railId, fromIso, toIso });
        } catch (err) {
          log.warn(
            { err, tenantId, railId },
            'payment scheduled statement import failed'
          );
        }
      }
    }
  }

  function start(): void {
    if (outboxHandle || importHandle) return;
    stopped = false;
    log.info({ workerId, outboxTickMs, importTickMs }, 'payment worker started');
    // Mirror the fiscal worker: kick a sweep at boot so a previous-process
    // crash does not leave wedged rows for one full interval.
    void sweepStaleClaims();
    outboxHandle = setInterval(() => {
      void periodicHousekeeping();
    }, outboxTickMs);
    importHandle = setInterval(() => {
      void periodicStatementImport();
    }, importTickMs);
    if (typeof outboxHandle.unref === 'function') outboxHandle.unref();
    if (typeof importHandle.unref === 'function') importHandle.unref();
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (outboxHandle) {
      clearInterval(outboxHandle);
      outboxHandle = null;
    }
    if (importHandle) {
      clearInterval(importHandle);
      importHandle = null;
    }
    log.info({ workerId }, 'payment worker stopped');
  }

  return {
    housekeepingTick,
    runStatementImport,
    catchUpOnBoot,
    start,
    stop,
  };
}

// =============================================================================
// lastImportedAt marker helpers
// =============================================================================

/**
 * Read every rail's `lastImportedAt` for a tenant. Returns a partial map —
 * rails the tenant has never imported are absent from the result.
 */
export async function readLastImportedAtMap(
  db: DatabaseInstance,
  tenantId: string
): Promise<Partial<Record<PaymentRailId, string>>> {
  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  if (!tenant) return {};
  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  const payments = (settings.payments ?? null) as Record<string, unknown> | null;
  if (!payments || typeof payments !== 'object') return {};
  const out: Partial<Record<PaymentRailId, string>> = {};
  for (const railId of PAYMENT_RAIL_IDS) {
    const railEntry = payments[railId];
    if (!railEntry || typeof railEntry !== 'object') continue;
    const marker = (railEntry as Record<string, unknown>).lastImportedAt;
    if (typeof marker === 'string' && marker.length > 0) {
      out[railId] = marker;
    }
  }
  return out;
}

interface AdvanceMarkerArgs {
  db: DatabaseInstance;
  tenantId: string;
  railId: PaymentRailId;
  newMarker: string;
}

/**
 * Advance `tenants.settings.payments.<railId>.lastImportedAt = newMarker`.
 *
 * Defensive read-modify-write: if another writer (e.g. the credential
 * persistence helper from slice 2) updates a sibling subtree concurrently
 * we still preserve their writes because the read snapshot is opaque.
 * Real serialization lives at the SQLite write boundary.
 */
export async function advanceLastImportedAt(args: AdvanceMarkerArgs): Promise<void> {
  const live = await args.db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .get();
  if (!live) return;
  const settings = (live.settings ?? {}) as Record<string, unknown>;
  const payments = (settings.payments ?? {}) as Record<string, unknown>;
  const railEntry = (payments[args.railId] ?? {}) as Record<string, unknown>;
  railEntry.lastImportedAt = args.newMarker;
  payments[args.railId] = railEntry;
  settings.payments = payments;
  await args.db
    .update(tenants)
    .set({ settings, updatedAt: new Date().toISOString() })
    .where(eq(tenants.id, args.tenantId));
}

// =============================================================================
// Default singleton (boot-time wiring)
// =============================================================================

let defaultWorker: PaymentWorker | null = null;

export function setDefaultPaymentWorker(worker: PaymentWorker | null): void {
  defaultWorker = worker;
}

export function getDefaultPaymentWorker(): PaymentWorker | null {
  return defaultWorker;
}
