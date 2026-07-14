/**
 * ENG-129d — daily enforcement of each active tenant's data-retention policy.
 *
 * The timer is armed only after Fastify starts listening, matching every other
 * worker. A global system-audit row records aggregate counts without exposing
 * tenant data through the tenant-scoped audit viewer.
 */

import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import { systemAuditLogs, type NewSystemAuditLog } from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';
import {
  listRetentionTenantIds,
  runDataRetentionSweep,
  type DataRetentionSweepResult,
} from '../data-retention.js';

const retentionLog = createModuleLogger('services/cleanup/data-retention');
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface DataRetentionCleanupSummary {
  evaluatedAt: string;
  tenantCount: number;
  deleted: DataRetentionSweepResult['deleted'];
}

export interface DataRetentionCleanupHandle {
  tickOnce: () => Promise<DataRetentionCleanupSummary>;
  /** Stop future ticks and drain any sweep already using the database. */
  stop: () => Promise<void>;
}

export interface DataRetentionCleanupOptions {
  db: DatabaseInstance;
  intervalMs?: number;
  now?: () => Date;
}

function emptyDeleted(): DataRetentionSweepResult['deleted'] {
  return {
    operationalAuditLogs: 0,
    privacyAuditLogs: 0,
    aiAuditLogs: 0,
    syncedOutboxRows: 0,
    total: 0,
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
}

function buildSystemAudit(args: {
  startedAt: Date;
  status: NewSystemAuditLog['status'];
  metadata: Record<string, unknown>;
}): NewSystemAuditLog {
  return {
    id: nanoid(),
    action: 'data_retention.cleanup',
    resourceType: 'data_retention',
    resourceId: 'all-active-tenants',
    status: args.status,
    metadata: args.metadata,
    createdAt: args.startedAt.toISOString(),
  };
}

export function createDataRetentionCleanup(
  options: DataRetentionCleanupOptions
): DataRetentionCleanupHandle & { start: () => void } {
  const { db, intervalMs = DEFAULT_INTERVAL_MS } = options;
  const now = options.now ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;
  const activeRuns = new Set<Promise<DataRetentionCleanupSummary>>();

  async function executeTick(): Promise<DataRetentionCleanupSummary> {
    const startedAt = now();
    const deleted = emptyDeleted();
    let tenantCount = 0;
    let completedTenantCount = 0;
    try {
      const tenantIds = listRetentionTenantIds(db);
      tenantCount = tenantIds.length;
      for (const tenantId of tenantIds) {
        const result = await runDataRetentionSweep(db, tenantId, startedAt);
        deleted.operationalAuditLogs += result.deleted.operationalAuditLogs;
        deleted.privacyAuditLogs += result.deleted.privacyAuditLogs;
        deleted.aiAuditLogs += result.deleted.aiAuditLogs;
        deleted.syncedOutboxRows += result.deleted.syncedOutboxRows;
        deleted.total += result.deleted.total;
        completedTenantCount += 1;
      }

      const summary = {
        evaluatedAt: startedAt.toISOString(),
        tenantCount,
        deleted,
      };
      db.insert(systemAuditLogs)
        .values(
          buildSystemAudit({
            startedAt,
            status: 'ok',
            metadata: summary,
          })
        )
        .run();
      if (deleted.total > 0) {
        retentionLog.info(summary, 'data-retention sweep deleted expired rows');
      }
      return summary;
    } catch (error) {
      try {
        db.insert(systemAuditLogs)
          .values(
            buildSystemAudit({
              startedAt,
              status: 'error',
              metadata: {
                tenantCount,
                completedTenantCount,
                deleted,
                error: serializeError(error),
              },
            })
          )
          .run();
      } catch (auditError) {
        retentionLog.warn(
          { err: serializeError(auditError) },
          'data-retention cleanup failed before system audit could be written'
        );
      }
      throw error;
    }
  }

  function tickOnce(): Promise<DataRetentionCleanupSummary> {
    const run = executeTick();
    activeRuns.add(run);
    void run.then(
      () => activeRuns.delete(run),
      () => activeRuns.delete(run)
    );
    return run;
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      void tickOnce().catch(error => {
        retentionLog.warn(
          { err: serializeError(error) },
          'data-retention cleanup tick failed; will retry next interval'
        );
      });
    }, intervalMs);
    timer.unref?.();
  }

  async function stop(): Promise<void> {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    await Promise.allSettled([...activeRuns]);
  }

  return { tickOnce, start, stop };
}
