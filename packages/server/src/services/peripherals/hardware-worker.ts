/**
 * ENG-062 — Hardware worker daemon.
 *
 * Drains `hardware_outbox` rows. Each tick: claim one row scoped to
 * a tenant, instantiate the adapter via the peripherals registry,
 * dispatch the kind-appropriate method (`print` for `print-*`
 * kinds, `kick` for `kick-drawer`), transition the outbox row via
 * the kernel.
 *
 * Lifecycle:
 *
 *   queued -> submitting -> printed | failed
 *                       \-> retrying -> dead_letter
 *
 * Mirrors the fiscal worker (ENG-057) structurally: stale-claim
 * sweep at startup + periodic, BOUNDED_EXPONENTIAL_BACKOFF retry
 * policy, per-tenant fan-out with a hard cap so a hot tenant
 * doesn't starve others. The two outboxes do NOT share a kernel
 * because their status enums differ — copying the structure is the
 * simplest way to keep both readable.
 *
 * The adapter result IS the outbox verdict — we don't sync to a
 * separate `last_error` field on the peripheral row because the
 * outbox row itself is the audit trail. ENG-065 (Operations
 * Center) will surface dead-letter rows via `peekHardwareOutbox`.
 *
 * @module services/peripherals/hardware-worker
 */

import { and, count, eq, isNotNull, lte, min, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  hardwareOutbox,
  sitePeripherals,
  tenants,
  type HardwareOutboxKind,
  type HardwareOutboxStatus,
  type SitePeripheralRow,
} from '../../db/schema.js';
import {
  BOUNDED_EXPONENTIAL_BACKOFF,
  createOutboxKernel,
  recordFailure,
  recordSuccess,
  refreshPendingCount,
  tickOutbox,
  type OutboxRetryPolicy,
  type OutboxRow,
} from '../../lib/outbox/index.js';
import { createModuleLogger, type PuntovivoLogger } from '../../logging/logger.js';
import { instantiateAdapter } from './registry.js';
import type {
  CashDrawerAdapter,
  ReceiptPrinterAdapter,
} from './index.js';
import type { ReceiptDocument } from './escpos/byte-builder.js';
import type { NormalizedHardwareError } from './types.js';
import type { NormalizedOutboxError } from '../../lib/outbox/types.js';

const fallbackLog = createModuleLogger('services/peripherals/hardware-worker');

const DEFAULT_INTERVAL_MS = 30_000;
const STALE_CLAIM_MS = 5 * 60_000;
const ADAPTER_TIMEOUT_MS = 30_000;

/**
 * Payload shape stored in `hardware_outbox.payload`. Discriminator
 * matches the `kind` column so the worker dispatches correctly
 * even after a crash + restart.
 */
export type HardwareOutboxPayload =
  | {
      kind: 'print-receipt' | 'print-fiscal-dee' | 'print-quotation' | 'print-kitchen-ticket';
      document: ReceiptDocument;
      escposBytes?: number[]; // serialized via JSON.stringify; rebuilt as Uint8Array on read
      saleId?: string;
      siteId: string;
    }
  | {
      kind: 'kick-drawer';
      siteId: string;
    };

export interface HardwareWorker {
  tickOnce(tenantId: string): Promise<TickOutcome>;
  start(): void;
  stop(): Promise<void>;
}

export interface TickOutcome {
  processed: boolean;
  rowId?: string;
  outcome?: 'completed' | 'retrying' | 'dead_letter';
}

export interface CreateHardwareWorkerOptions {
  db: DatabaseInstance;
  tenantIdsProvider?: () => Promise<string[]>;
  intervalMs?: number;
  workerId?: string;
  log?: PuntovivoLogger;
  retryPolicy?: OutboxRetryPolicy;
}

export function createHardwareOutboxKernel(
  retryPolicy: OutboxRetryPolicy = BOUNDED_EXPONENTIAL_BACKOFF
) {
  return createOutboxKernel<HardwareOutboxStatus, HardwareOutboxPayload>({
    table: hardwareOutbox,
    kind: 'hardware',
    initialStatus: 'queued',
    processingStatus: 'submitting',
    succeededStatus: 'printed',
    retryingStatus: 'retrying',
    deadLetterStatus: 'dead_letter',
    terminalStatuses: ['printed', 'failed', 'dead_letter'] as const,
    retryPolicy,
  });
}

async function withAdapterTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Hardware adapter call exceeded ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toOutboxError(
  err: NormalizedHardwareError | { message: string }
): NormalizedOutboxError {
  // DRIVER_NOT_IMPLEMENTED + INVALID_CONFIG + PERMISSION_DENIED are
  // non-recoverable; everything else (DEVICE_OFFLINE, DEVICE_TIMEOUT,
  // PROTOCOL_ERROR, UNKNOWN) is recoverable. The kernel needs the
  // boolean to decide retry vs dead-letter.
  const kind = 'kind' in err ? err.kind : 'UNKNOWN';
  const recoverable =
    kind !== 'DRIVER_NOT_IMPLEMENTED' &&
    kind !== 'INVALID_CONFIG' &&
    kind !== 'PERMISSION_DENIED';
  return {
    errorCode: kind,
    providerMessage: err.message,
    recoverable,
    details: 'kind' in err ? err.details ?? null : null,
  };
}

export function createHardwareWorker(opts: CreateHardwareWorkerOptions): HardwareWorker {
  const {
    db,
    intervalMs = DEFAULT_INTERVAL_MS,
    workerId = `hardware:${process.pid}`,
    log = fallbackLog,
    retryPolicy = BOUNDED_EXPONENTIAL_BACKOFF,
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

  const kernel = createHardwareOutboxKernel(retryPolicy);

  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let staleSweepHandle: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function sweepStaleClaims(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    try {
      await db
        .update(hardwareOutbox)
        .set({
          claimToken: null,
          lockedAt: null,
          status: sql`CASE WHEN ${hardwareOutbox.status} = 'submitting' THEN 'queued' ELSE ${hardwareOutbox.status} END`,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            isNotNull(hardwareOutbox.lockedAt),
            lte(hardwareOutbox.lockedAt, cutoff)
          )
        );
    } catch (err) {
      log.warn({ err }, 'hardware worker stale-claim sweep failed');
    }
  }

  async function loadActivePeripheralForKind(
    tenantId: string,
    siteId: string,
    targetKind: 'printer' | 'cash_drawer'
  ): Promise<SitePeripheralRow | null> {
    const row = await db
      .select()
      .from(sitePeripherals)
      .where(
        and(
          eq(sitePeripherals.tenantId, tenantId),
          eq(sitePeripherals.siteId, siteId),
          eq(sitePeripherals.kind, targetKind),
          eq(sitePeripherals.isActive, true)
        )
      )
      .get();
    return row ?? null;
  }

  async function processHardwareRow(
    row: OutboxRow<HardwareOutboxPayload, HardwareOutboxStatus>
  ): Promise<{ ok: true } | { ok: false; error: NormalizedOutboxError }> {
    const payload = row.payload;
    const kind = payload.kind as HardwareOutboxKind;
    const targetPeripheralKind: 'printer' | 'cash_drawer' =
      kind === 'kick-drawer' ? 'cash_drawer' : 'printer';
    const peripheralRow = await loadActivePeripheralForKind(
      row.tenantId,
      payload.siteId,
      targetPeripheralKind
    );
    if (!peripheralRow) {
      return {
        ok: false,
        error: {
          errorCode: 'INVALID_CONFIG',
          providerMessage: `No active ${targetPeripheralKind} peripheral registered for the site`,
          recoverable: false,
        },
      };
    }
    const adapter = instantiateAdapter(peripheralRow);
    if (!adapter) {
      return {
        ok: false,
        error: {
          errorCode: 'DRIVER_NOT_IMPLEMENTED',
          providerMessage: `Driver "${peripheralRow.driver}" is not implemented for kind=${peripheralRow.kind}`,
          recoverable: false,
        },
      };
    }

    try {
      if (kind === 'kick-drawer') {
        if (adapter.kind !== 'cash_drawer') {
          return {
            ok: false,
            error: {
              errorCode: 'INVALID_CONFIG',
              providerMessage: 'Active drawer adapter has wrong kind',
              recoverable: false,
            },
          };
        }
        const result = await withAdapterTimeout(
          (adapter as CashDrawerAdapter).kick(),
          ADAPTER_TIMEOUT_MS
        );
        return result.status === 'ok'
          ? { ok: true }
          : { ok: false, error: toOutboxError(result.error ?? { message: 'kick failed' }) };
      }

      // print-* kinds
      if (adapter.kind !== 'printer') {
        return {
          ok: false,
          error: {
            errorCode: 'INVALID_CONFIG',
            providerMessage: 'Active printer adapter has wrong kind',
            recoverable: false,
          },
        };
      }
      const printPayload =
        payload.kind === 'kick-drawer'
          ? null
          : payload;
      if (!printPayload || !('document' in printPayload)) {
        return {
          ok: false,
          error: {
            errorCode: 'INVALID_CONFIG',
            providerMessage: 'Print payload missing document',
            recoverable: false,
          },
        };
      }
      const result = await withAdapterTimeout(
        (adapter as ReceiptPrinterAdapter).print({
          kind: payload.kind === 'print-receipt'
            ? 'sale-receipt'
            : payload.kind === 'print-fiscal-dee'
              ? 'fiscal-dee'
              : payload.kind === 'print-quotation'
                ? 'quotation'
                : 'kitchen-ticket',
          escposBytes: printPayload.escposBytes
            ? new Uint8Array(printPayload.escposBytes)
            : undefined,
          metadata: { document: printPayload.document, saleId: printPayload.saleId },
        }),
        ADAPTER_TIMEOUT_MS
      );
      return result.status === 'ok'
        ? { ok: true }
        : { ok: false, error: toOutboxError(result.error ?? { message: 'print failed' }) };
    } catch (err) {
      return {
        ok: false,
        error: toOutboxError({
          message: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  async function tickOnce(tenantId: string): Promise<TickOutcome> {
    if (stopped) return { processed: false };
    const result = await tickOutbox<HardwareOutboxPayload, HardwareOutboxStatus>(db, tenantId, {
      kernel,
      workerId,
      loggerLabel: 'hardware-outbox-worker',
      process: async ({ row }) => processHardwareRow(row),
    });
    if (result.processed) {
      try {
        if (result.outcome === 'completed') {
          await recordSuccess(db, { tenantId, outboxKind: 'hardware' });
        } else if (result.outcome === 'dead_letter') {
          await recordFailure(db, { tenantId, outboxKind: 'hardware' });
        }
      } catch (err) {
        log.debug({ err, tenantId }, 'hardware outbox metadata write failed (non-blocking)');
      }
      return {
        processed: true,
        rowId: result.rowId,
        outcome: result.outcome,
      };
    }
    return { processed: false };
  }

  async function refreshMetadataForAllTenants(): Promise<void> {
    try {
      const ids = await tenantIdsProvider();
      const nowIso = new Date().toISOString();
      for (const tenantId of ids) {
        const aggregate = await db
          .select({
            pendingCount: count(),
            oldestPendingAt: min(hardwareOutbox.createdAt),
          })
          .from(hardwareOutbox)
          .where(
            and(
              eq(hardwareOutbox.tenantId, tenantId),
              sql`${hardwareOutbox.status} IN ('queued', 'submitting', 'retrying', 'failed')`
            )
          )
          .get();
        await refreshPendingCount(db, {
          tenantId,
          outboxKind: 'hardware',
          pendingCount: aggregate?.pendingCount ?? 0,
          oldestPendingAt: aggregate?.oldestPendingAt ?? null,
          nowIso,
        });
      }
    } catch (err) {
      log.warn({ err }, 'hardware worker metadata refresh failed');
    }
  }

  async function periodicTick(): Promise<void> {
    if (stopped) return;
    try {
      const ids = await tenantIdsProvider();
      for (const tenantId of ids) {
        const MAX_PER_TENANT_PER_TICK = 25;
        for (let i = 0; i < MAX_PER_TENANT_PER_TICK; i++) {
          const result = await tickOnce(tenantId);
          if (!result.processed) break;
        }
      }
    } catch (err) {
      log.warn({ err }, 'hardware worker periodic tick failed');
    }
  }

  function start(): void {
    if (intervalHandle) return;
    stopped = false;
    log.info({ workerId, intervalMs }, 'hardware worker started');
    void sweepStaleClaims();
    intervalHandle = setInterval(() => {
      void periodicTick();
    }, intervalMs);
    staleSweepHandle = setInterval(() => {
      void sweepStaleClaims();
      void refreshMetadataForAllTenants();
    }, STALE_CLAIM_MS);
    if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
    if (typeof staleSweepHandle.unref === 'function') staleSweepHandle.unref();
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (staleSweepHandle) {
      clearInterval(staleSweepHandle);
      staleSweepHandle = null;
    }
    log.info({ workerId }, 'hardware worker stopped');
  }

  return { tickOnce, start, stop };
}

// =============================================================================
// Default singleton (boot wiring mirrors the fiscal worker)
// =============================================================================

let defaultWorker: HardwareWorker | null = null;

export function setDefaultHardwareWorker(worker: HardwareWorker | null): void {
  defaultWorker = worker;
}

export function getDefaultHardwareWorker(): HardwareWorker | null {
  return defaultWorker;
}

/**
 * Fire-and-forget tick on the default singleton. Callers (e.g. the
 * tRPC `printReceipt` procedure when it enqueues a fallback row)
 * use this to drain immediately without holding a worker reference.
 * No-ops when no worker is registered (test configurations).
 */
export async function tickDefaultHardwareWorker(tenantId: string): Promise<void> {
  const worker = defaultWorker;
  if (!worker) return;
  await worker.tickOnce(tenantId);
}
