import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import {
  createQueryPlannerMaintenance,
  tablesMissingStatistics,
} from '../db/query-planner-maintenance.js';

let sqlite: Database.Database;
let clock = 0;
const now = () => clock;

function analyzedTables(exec: { mock: { calls: unknown[][] } }): string[] {
  return exec.mock.calls
    .map(call => /^ANALYZE "(.+)"$/.exec(String(call[0]))?.[1])
    .filter((table): table is string => table !== undefined);
}

beforeEach(async () => {
  await initDatabase({ dbPath: ':memory:', runMigrations: true, seedData: true });
  sqlite = (getDatabase() as unknown as { $client: Database.Database }).$client;
  clock = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  closeDatabase();
});

describe('query planner maintenance', () => {
  it('analyzes every ordinary table once, one step at a time', () => {
    const tables = tablesMissingStatistics(sqlite);
    expect(tables).toContain('sales');
    expect(tables).not.toContain('product_search_fts');
    expect(tables).toContain('product_search_fts_data');
    const exec = vi.spyOn(sqlite, 'exec');
    const maintenance = createQueryPlannerMaintenance(sqlite, { stepBudgetMs: 0, now });

    let steps = 1;
    while (maintenance.runStep()) steps += 1;

    expect(steps).toBe(tables.length);
    expect(analyzedTables(exec)).toEqual(tables);
    expect(sqlite.prepare('SELECT count(*) AS n FROM sqlite_stat1').get()).toMatchObject({
      n: expect.any(Number),
    });
    exec.mockClear();
    maintenance.runStep();
    expect(exec).not.toHaveBeenCalled();
  });

  it('runs PRAGMA optimize once the first pass is done and the interval elapses', () => {
    const maintenance = createQueryPlannerMaintenance(sqlite, { optimizeIntervalMs: 1_000, now });
    while (maintenance.runStep());
    const pragma = vi.spyOn(sqlite, 'pragma');

    maintenance.runStep();
    expect(pragma).not.toHaveBeenCalledWith('optimize');
    clock += 1_000;
    maintenance.runStep();
    expect(pragma).toHaveBeenCalledWith('optimize');
  });

  it('steps only while the server is idle', () => {
    vi.useFakeTimers();
    const exec = vi.spyOn(sqlite, 'exec');
    const maintenance = createQueryPlannerMaintenance(sqlite, {
      idleMs: 3_000,
      checkIntervalMs: 1_000,
      now,
    });
    maintenance.start();

    for (let second = 0; second < 5; second += 1) {
      clock += 1_000;
      maintenance.noteActivity();
      vi.advanceTimersByTime(1_000);
    }
    expect(analyzedTables(exec)).toEqual([]);

    clock += 3_000;
    vi.advanceTimersByTime(1_000);
    expect(analyzedTables(exec).length).toBeGreaterThan(0);

    maintenance.stop();
    exec.mockClear();
    clock += 10_000;
    vi.advanceTimersByTime(10_000);
    expect(exec).not.toHaveBeenCalled();
  });
});
