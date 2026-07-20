import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadPaletteUsage,
  rankRecentActions,
  recordPaletteActionUsage,
  MAX_RECENT_ACTIONS,
  __clearPaletteUsageForTests,
  type PaletteUsageMap,
} from '../paletteUsage';

// pins the device-local usage store contract: counting,
// recency tiebreaks, tenant scoping, defensive parsing, and the
// best-effort write semantics (a broken storage never throws).

const TENANT = 'tenant-usage-test';
const OTHER_TENANT = 'tenant-other';

beforeEach(() => {
  __clearPaletteUsageForTests(TENANT);
  __clearPaletteUsageForTests(OTHER_TENANT);
});

afterEach(() => {
  __clearPaletteUsageForTests(TENANT);
  __clearPaletteUsageForTests(OTHER_TENANT);
  vi.restoreAllMocks();
});

describe('recordPaletteActionUsage / loadPaletteUsage', () => {
  it('records a first use with count 1 and accumulates on repeat', () => {
    recordPaletteActionUsage('navigate.sales', TENANT);
    expect(loadPaletteUsage(TENANT)['navigate.sales']?.count).toBe(1);

    recordPaletteActionUsage('navigate.sales', TENANT);
    recordPaletteActionUsage('navigate.sales', TENANT);
    expect(loadPaletteUsage(TENANT)['navigate.sales']?.count).toBe(3);
  });

  it('scopes usage by tenant — two tenants never mix rankings', () => {
    recordPaletteActionUsage('navigate.sales', TENANT);
    recordPaletteActionUsage('navigate.products', OTHER_TENANT);

    expect(loadPaletteUsage(TENANT)['navigate.products']).toBeUndefined();
    expect(loadPaletteUsage(OTHER_TENANT)['navigate.sales']).toBeUndefined();
  });

  it('is a no-op without a tenant id', () => {
    recordPaletteActionUsage('navigate.sales', null);
    recordPaletteActionUsage('navigate.sales', undefined);
    expect(loadPaletteUsage(null)).toEqual({});
  });

  it('returns an empty map on corrupt JSON and drops invalid entries individually', () => {
    window.localStorage.setItem(`palette_usage:${TENANT}`, '{not json');
    expect(loadPaletteUsage(TENANT)).toEqual({});

    window.localStorage.setItem(
      `palette_usage:${TENANT}`,
      JSON.stringify({
        'navigate.sales': { count: 2, lastUsedAt: 100 },
        'navigate.bad': { count: 'NaN-ish', lastUsedAt: null },
        'navigate.worse': 'not-an-object',
      })
    );
    const usage = loadPaletteUsage(TENANT);
    expect(usage['navigate.sales']).toEqual({ count: 2, lastUsedAt: 100 });
    expect(usage['navigate.bad']).toBeUndefined();
    expect(usage['navigate.worse']).toBeUndefined();
  });

  it('returns an empty map when the stored blob is an array or primitive', () => {
    window.localStorage.setItem(`palette_usage:${TENANT}`, '[1,2,3]');
    expect(loadPaletteUsage(TENANT)).toEqual({});
    window.localStorage.setItem(`palette_usage:${TENANT}`, '"hello"');
    expect(loadPaletteUsage(TENANT)).toEqual({});
  });

  it('never throws when the storage write fails (quota / private mode)', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => recordPaletteActionUsage('navigate.sales', TENANT)).not.toThrow();
  });

  it('evicts the least-recently-used entries past the tracked cap', () => {
    const bloated: PaletteUsageMap = {};
    for (let i = 0; i < 64; i += 1) {
      bloated[`retired.action${i}`] = { count: 1, lastUsedAt: i };
    }
    window.localStorage.setItem(`palette_usage:${TENANT}`, JSON.stringify(bloated));

    recordPaletteActionUsage('navigate.sales', TENANT);
    const usage = loadPaletteUsage(TENANT);
    expect(Object.keys(usage)).toHaveLength(64);
    expect(usage['navigate.sales']?.count).toBe(1);
    // The oldest entry (lastUsedAt 0) was evicted.
    expect(usage['retired.action0']).toBeUndefined();
    expect(usage['retired.action63']).toBeDefined();
  });
});

describe('rankRecentActions', () => {
  const actions = [
    { id: 'navigate.dashboard' },
    { id: 'navigate.sales' },
    { id: 'navigate.products' },
    { id: 'navigate.customers' },
    { id: 'navigate.inventory' },
    { id: 'navigate.orders' },
    { id: 'command.logout' },
  ];

  it('returns empty with no usage (the palette keeps catalogue order)', () => {
    expect(rankRecentActions(actions, {})).toEqual([]);
  });

  it('orders by count desc, tiebreak by lastUsedAt desc', () => {
    const usage: PaletteUsageMap = {
      'navigate.sales': { count: 5, lastUsedAt: 100 },
      'navigate.products': { count: 2, lastUsedAt: 300 },
      'navigate.customers': { count: 2, lastUsedAt: 200 },
    };
    expect(rankRecentActions(actions, usage).map(a => a.id)).toEqual([
      'navigate.sales',
      'navigate.products',
      'navigate.customers',
    ]);
  });

  it('caps the section at MAX_RECENT_ACTIONS', () => {
    const usage: PaletteUsageMap = {};
    for (const action of actions) {
      usage[action.id] = { count: 1, lastUsedAt: 1 };
    }
    expect(rankRecentActions(actions, usage)).toHaveLength(MAX_RECENT_ACTIONS);
  });

  it('prunes usage ids that are not in the provided action list (retired or role-gated)', () => {
    const usage: PaletteUsageMap = {
      'navigate.retired-route': { count: 99, lastUsedAt: 999 },
      'navigate.sales': { count: 1, lastUsedAt: 1 },
    };
    expect(rankRecentActions(actions, usage).map(a => a.id)).toEqual(['navigate.sales']);
  });
});
