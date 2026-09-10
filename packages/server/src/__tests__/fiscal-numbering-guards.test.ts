/**
 * The three guards around the fiscal consecutive.
 *
 * All three emission paths advance `fiscal_numbering_resolutions.current_number`
 * and then check `changes !== 1` to catch a concurrent advance. Only
 * `intents.ts` could: the other two pinned `id`, `tenantId`, `siteId` and
 * `kind`, every one of which is immutable for that row, so `changes` was
 * always 1 and `FISCAL_SEQUENTIAL_NOT_ADVANCED` could only fire if somebody
 * deleted the resolution mid-transaction. `emit.ts`'s own docstring claimed a
 * versioned WHERE that was not there.
 *
 * Two more, in the same block and fixed in the same pass because they touch
 * the same arithmetic:
 *
 * - the range and validity-window checks existed on the intent path and on
 *   neither of the others, so the same product validated a consecutive on one
 *   path and issued an expired or out-of-range one on the other;
 * - all three transactions were deferred, which is the read-to-write upgrade
 *   `runFreshSale` documents as losing the race and surfacing SQLITE_BUSY
 *   immediately, bypassing `busy_timeout`.
 *
 * @module __tests__/fiscal-numbering-guards.test
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { checkResolutionUsable } from '../services/fiscal/orchestrator/helpers.js';

const ORCHESTRATOR = path.resolve(process.cwd(), 'src/services/fiscal/orchestrator');

/** The three files that advance a resolution. */
const ADVANCING_PATHS = ['enqueue.ts', 'emit.ts', 'intents.ts'];

function source(name: string): string {
  return readFileSync(path.join(ORCHESTRATOR, name), 'utf8');
}

/** A resolution valid for a year, with room to issue. */
function usableResolution(overrides: Partial<Parameters<typeof checkResolutionUsable>[0]> = {}) {
  return {
    id: 'resolution-1',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-12-31T23:59:59.000Z',
    currentNumber: 10,
    fromNumber: 1,
    toNumber: 1000,
    ...overrides,
  };
}

const AT = '2026-06-01T12:00:00.000Z';

describe('numbering resolution usability', () => {
  it('accepts a resolution inside its window with room left', () => {
    expect(checkResolutionUsable(usableResolution(), AT)).toEqual({ ok: true });
  });

  it('refuses a request before the window opens and after it closes', () => {
    expect(checkResolutionUsable(usableResolution(), '2025-12-31T23:59:59.000Z')).toMatchObject({
      ok: false,
      reason: 'numbering_resolution_not_effective',
    });
    expect(checkResolutionUsable(usableResolution(), '2027-01-01T00:00:00.000Z')).toMatchObject({
      ok: false,
      reason: 'numbering_resolution_not_effective',
    });
  });

  it('accepts both edges of the window, which are inclusive', () => {
    // A resolution is valid ON its start and end dates; excluding them would
    // silently lose two days of issuing at each end.
    expect(checkResolutionUsable(usableResolution(), '2026-01-01T00:00:00.000Z')).toEqual({
      ok: true,
    });
    expect(checkResolutionUsable(usableResolution(), '2026-12-31T23:59:59.000Z')).toEqual({
      ok: true,
    });
  });

  it('refuses once the last issuable number has been used', () => {
    // `currentNumber` is the LAST issued number, so `toNumber` itself is
    // issuable and the resolution is spent only once currentNumber reaches it.
    expect(checkResolutionUsable(usableResolution({ currentNumber: 999 }), AT)).toEqual({
      ok: true,
    });
    expect(checkResolutionUsable(usableResolution({ currentNumber: 1000 }), AT)).toMatchObject({
      ok: false,
      reason: 'numbering_resolution_exhausted',
    });
  });

  it('refuses a resolution whose counter sits below its own range', () => {
    // fromNumber 500 means the first issuable number is 500, so a counter of
    // 498 would issue 499 -- outside the authorised range.
    expect(
      checkResolutionUsable(usableResolution({ fromNumber: 500, currentNumber: 498 }), AT)
    ).toMatchObject({ ok: false, reason: 'numbering_resolution_exhausted' });
    expect(
      checkResolutionUsable(usableResolution({ fromNumber: 500, currentNumber: 499 }), AT)
    ).toEqual({ ok: true });
  });

  it('refuses an unparseable window rather than treating it as open', () => {
    expect(checkResolutionUsable(usableResolution({ validUntil: 'not a date' }), AT)).toMatchObject(
      {
        ok: false,
        reason: 'numbering_resolution_not_effective',
      }
    );
  });

  it('carries the coordinates an operator needs to act on it', () => {
    const expired = checkResolutionUsable(usableResolution(), '2027-06-01T00:00:00.000Z');
    expect(expired).toMatchObject({
      ok: false,
      details: { resolutionId: 'resolution-1', validUntil: '2026-12-31T23:59:59.000Z' },
    });
    const spent = checkResolutionUsable(usableResolution({ currentNumber: 1000 }), AT);
    expect(spent).toMatchObject({
      ok: false,
      details: { resolutionId: 'resolution-1', currentNumber: 1000, toNumber: 1000 },
    });
  });
});

describe('the advancing UPDATE is a real compare-and-swap', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE fiscal_numbering_resolutions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        current_number INTEGER NOT NULL
      );
      INSERT INTO fiscal_numbering_resolutions VALUES ('r1', 't1', 's1', 'DEE', 10);
    `);
  });

  afterAll(() => {
    db.close();
  });

  it('reports zero changes when another writer advanced first', () => {
    // The semantics the guard depends on. Pinning only the immutable columns
    // always matches the row, which is why the old predicate could never fire.
    const immutableOnly = db.prepare(
      'UPDATE fiscal_numbering_resolutions SET current_number = ? WHERE id = ? AND tenant_id = ? AND site_id = ? AND kind = ?'
    );
    expect(immutableOnly.run(11, 'r1', 't1', 's1', 'DEE').changes).toBe(1);

    const versioned = db.prepare(
      'UPDATE fiscal_numbering_resolutions SET current_number = ? WHERE id = ? AND tenant_id = ? AND site_id = ? AND kind = ? AND current_number = ?'
    );
    // A writer that read 10 loses, because 11 is already committed.
    expect(versioned.run(11, 'r1', 't1', 's1', 'DEE', 10).changes).toBe(0);
    // A writer that read the current value wins exactly once.
    expect(versioned.run(12, 'r1', 't1', 's1', 'DEE', 11).changes).toBe(1);
    expect(versioned.run(12, 'r1', 't1', 's1', 'DEE', 11).changes).toBe(0);
  });

  it('is the predicate every advancing path actually uses', () => {
    // Source-level because the race itself needs two real connections
    // contending for one SQLite writer, which a single-process suite cannot
    // stage honestly. Reverting any of the three fails here.
    for (const name of ADVANCING_PATHS) {
      expect(source(name), `${name} lost the compare-and-swap`).toMatch(
        /eq\(\s*fiscalNumberingResolutions\.currentNumber,\s*resolution\.currentNumber\s*\)/
      );
    }
  });

  it('still throws the specific conflict when the swap loses', () => {
    for (const name of ADVANCING_PATHS) {
      expect(source(name)).toContain('FISCAL_SEQUENTIAL_NOT_ADVANCED');
    }
  });
});

describe('the fiscal writers reserve the SQLite writer', () => {
  it('opens every fiscal write transaction as immediate', () => {
    // A deferred transaction reads the resolution and then writes it, and can
    // lose that upgrade to a concurrent sale -- surfacing SQLITE_BUSY at once,
    // bypassing busy_timeout. runFreshSale documents the rule; the fiscal
    // paths were the ones not following it.
    for (const name of ADVANCING_PATHS) {
      expect(source(name), `${name} still opens a deferred transaction`).toMatch(
        /\{ behavior: 'immediate' \}/
      );
    }
  });

  it('checks the resolution on every path, not just the intent one', () => {
    for (const name of ADVANCING_PATHS) {
      expect(source(name), `${name} does not check the resolution`).toContain(
        'checkResolutionUsable'
      );
    }
  });
});
