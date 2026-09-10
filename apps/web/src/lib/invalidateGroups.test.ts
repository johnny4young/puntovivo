import { describe, expect, it, vi } from 'vitest';
import {
  invalidateCommittedGroups,
  invalidateGroups,
  INVENTORY_RESERVATION_INVALIDATIONS,
  SALE_COMPLETION_INVALIDATIONS,
  SERIAL_INVENTORY_INVALIDATIONS,
} from './invalidateGroups';

// We deliberately use a hand-rolled `utils` shape so the test stays
// decoupled from the real tRPC proxy. The helper only depends on the
// `.invalidate()` contract on each picked leaf.
function buildFakeUtils() {
  return {
    sales: {
      list: { invalidate: vi.fn().mockResolvedValue(undefined) },
      summary: { invalidate: vi.fn().mockResolvedValue(undefined) },
    },
    products: {
      list: { invalidate: vi.fn().mockResolvedValue(undefined) },
    },
    productSerials: {
      list: { invalidate: vi.fn().mockResolvedValue(undefined) },
      lookup: { invalidate: vi.fn().mockResolvedValue(undefined) },
    },
  };
}

describe('invalidateGroups', () => {
  it('resolves immediately for an empty picker array without calling invalidate', async () => {
    const utils = buildFakeUtils();
    await invalidateGroups(utils as unknown as Parameters<typeof invalidateGroups>[0], []);
    expect(utils.sales.list.invalidate).not.toHaveBeenCalled();
    expect(utils.sales.summary.invalidate).not.toHaveBeenCalled();
    expect(utils.products.list.invalidate).not.toHaveBeenCalled();
  });

  it('invokes invalidate on every picked leaf exactly once', async () => {
    const utils = buildFakeUtils();
    await invalidateGroups(utils as unknown as Parameters<typeof invalidateGroups>[0], [
      u => u.sales.list,
      u => u.sales.summary,
      u => u.products.list,
    ]);
    expect(utils.sales.list.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.sales.summary.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.products.list.invalidate).toHaveBeenCalledTimes(1);
  });

  it('keeps availability and warranty serial caches in one invalidation group', async () => {
    const utils = buildFakeUtils();

    await invalidateGroups(
      utils as unknown as Parameters<typeof invalidateGroups>[0],
      SERIAL_INVENTORY_INVALIDATIONS
    );

    expect(utils.productSerials.list.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.productSerials.lookup.invalidate).toHaveBeenCalledTimes(1);
  });

  it('keeps every stock-reservation projection in one invalidation group', () => {
    const visitedPaths = new Set<string>();
    const pathProbe = (path: string[] = []): unknown =>
      new Proxy(() => undefined, {
        get: (_target, property) => {
          const nextPath = [...path, String(property)];
          visitedPaths.add(nextPath.join('.'));
          return pathProbe(nextPath);
        },
      });

    for (const picker of INVENTORY_RESERVATION_INVALIDATIONS) {
      picker(pathProbe() as Parameters<typeof picker>[0]);
    }

    expect(visitedPaths).toEqual(
      new Set([
        'inventory',
        'inventory.listMovements',
        'inventory.listStock',
        'products',
        'products.list',
        'products.search',
        'productSerials',
        'productSerials.list',
        'productSerials.lookup',
      ])
    );
  });

  it('refreshes both restaurant projections after completing a sale', () => {
    const visitedPaths = new Set<string>();
    const pathProbe = (path: string[] = []): unknown =>
      new Proxy(() => undefined, {
        get: (_target, property) => {
          const nextPath = [...path, String(property)];
          visitedPaths.add(nextPath.join('.'));
          return pathProbe(nextPath);
        },
      });

    for (const picker of SALE_COMPLETION_INVALIDATIONS) {
      picker(pathProbe() as Parameters<typeof picker>[0]);
    }

    expect(visitedPaths).toContain('restaurantTables.listWithDraftStatus');
    expect(visitedPaths).toContain('restaurantServices.getTableState');
    expect(visitedPaths).toContain('reservations.list');
  });

  it('rejects when any single picker rejects (Promise.all semantics)', async () => {
    const utils = buildFakeUtils();
    utils.sales.summary.invalidate = vi.fn().mockRejectedValue(new Error('network'));

    await expect(
      invalidateGroups(utils as unknown as Parameters<typeof invalidateGroups>[0], [
        u => u.sales.list,
        u => u.sales.summary,
      ])
    ).rejects.toThrow('network');
  });

  it('reports a committed-command refresh failure without rejecting', async () => {
    const utils = buildFakeUtils();
    utils.sales.summary.invalidate = vi.fn().mockRejectedValue(new Error('network'));

    await expect(
      invalidateCommittedGroups(utils as unknown as Parameters<typeof invalidateGroups>[0], [
        u => u.sales.list,
        u => u.sales.summary,
      ])
    ).resolves.toBe(false);
    expect(utils.sales.list.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.sales.summary.invalidate).toHaveBeenCalledTimes(1);
  });

  it('reports a successful committed-command refresh', async () => {
    const utils = buildFakeUtils();

    await expect(
      invalidateCommittedGroups(utils as unknown as Parameters<typeof invalidateGroups>[0], [
        u => u.sales.list,
        u => u.sales.summary,
      ])
    ).resolves.toBe(true);
  });

  it('runs all invalidations in parallel rather than sequentially', async () => {
    const utils = buildFakeUtils();
    const order: string[] = [];
    utils.sales.list.invalidate = vi.fn(async () => {
      order.push('list-start');
      await new Promise(resolve => setTimeout(resolve, 10));
      order.push('list-end');
    });
    utils.sales.summary.invalidate = vi.fn(async () => {
      order.push('summary-start');
      await new Promise(resolve => setTimeout(resolve, 5));
      order.push('summary-end');
    });

    await invalidateGroups(utils as unknown as Parameters<typeof invalidateGroups>[0], [
      u => u.sales.list,
      u => u.sales.summary,
    ]);

    // Both starts must precede either end — that is the parallel signature.
    expect(order.indexOf('list-start')).toBeLessThan(order.indexOf('summary-end'));
    expect(order.indexOf('summary-start')).toBeLessThan(order.indexOf('list-end'));
  });
});
