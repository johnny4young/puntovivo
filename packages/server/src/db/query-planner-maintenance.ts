import type Database from 'better-sqlite3';
import { createModuleLogger } from '../logging/logger.js';

const log = createModuleLogger('db');

export interface QueryPlannerMaintenanceOptions {
  /** Quiet time without HTTP traffic before a step may run. */
  idleMs?: number;
  /** Well under the renderer's 5 s polls, or a check in phase with them never sees a gap. */
  checkIntervalMs?: number;
  /** Synchronous work allowed per step; one large table may exceed it alone. */
  stepBudgetMs?: number;
  optimizeIntervalMs?: number;
  now?: () => number;
}

export interface QueryPlannerMaintenance {
  start(): void;
  stop(): void;
  noteActivity(): void;
  /** Runs one step now, ignoring idleness. True while first-pass tables remain. */
  runStep(): boolean;
}

/** Tables the planner has no statistics for, which SQLite then plans for blindly. */
export function tablesMissingStatistics(sqlite: Database.Database): string[] {
  const hasStatTable = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1'")
    .get();
  return (
    sqlite
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
            AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'
            ${hasStatTable ? 'AND name NOT IN (SELECT tbl FROM sqlite_stat1)' : ''}
          ORDER BY name`
      )
      .all() as Array<{ name: string }>
  ).map(row => row.name);
}

/**
 * Keeps `sqlite_stat1` current without stalling the event loop for seconds.
 *
 * A database that never ran ANALYZE gets its statistics one table at a time,
 * only while the server is idle: a whole-database pass took seconds on an
 * encrypted year of sales. Afterwards `PRAGMA optimize` is cheap and runs
 * periodically. `analysis_limit` is set when the connection opens.
 */
export function createQueryPlannerMaintenance(
  sqlite: Database.Database,
  {
    idleMs = 3_000,
    checkIntervalMs = 500,
    stepBudgetMs = 50,
    optimizeIntervalMs = 6 * 60 * 60 * 1_000,
    now = Date.now,
  }: QueryPlannerMaintenanceOptions = {}
): QueryPlannerMaintenance {
  let timer: NodeJS.Timeout | null = null;
  let pending: string[] | null = null;
  let lastActivityAt = now();
  let lastOptimizeAt = now();

  const runStep = (): boolean => {
    if (!sqlite.open) return false;
    pending ??= tablesMissingStatistics(sqlite);
    if (pending.length > 0) {
      const startedAt = now();
      do {
        const table = pending.shift()!;
        sqlite.exec(`ANALYZE "${table.replaceAll('"', '""')}"`);
      } while (pending.length > 0 && now() - startedAt < stepBudgetMs);
      return pending.length > 0;
    }
    if (now() - lastOptimizeAt >= optimizeIntervalMs) {
      sqlite.pragma('optimize');
      lastOptimizeAt = now();
    }
    return false;
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (now() - lastActivityAt < idleMs) return;
        try {
          runStep();
        } catch (error) {
          log.warn(
            { err: error instanceof Error ? { message: error.message } : error },
            'query planner statistics step failed; that table waits for the next server start'
          );
        }
      }, checkIntervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    noteActivity() {
      lastActivityAt = now();
    },
    runStep,
  };
}
