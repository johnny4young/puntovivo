/**
 * usePrefetchSales unit test. Pins the hover-prefetch contract:
 * the four SalesPage entry queries are warmed with the exact inputs the
 * page subscribes to, and `cashSessions.getActive` is only prefetched when
 * a site is active.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { useUtilsMock, useTenantMock, prefetchSpies } = vi.hoisted(() => {
  const prefetchSpies = {
    salesList: vi.fn(),
    salesSummary: vi.fn(),
    customersList: vi.fn(),
    cashGetActive: vi.fn(),
  };
  return {
    prefetchSpies,
    useUtilsMock: vi.fn(() => ({
      sales: {
        list: { prefetch: prefetchSpies.salesList },
        summary: { prefetch: prefetchSpies.salesSummary },
      },
      customers: { list: { prefetch: prefetchSpies.customersList } },
      cashSessions: { getActive: { prefetch: prefetchSpies.cashGetActive } },
    })),
    useTenantMock: vi.fn(),
  };
});

vi.mock('@/lib/trpc', () => ({ trpc: { useUtils: useUtilsMock } }));
vi.mock('@/features/tenant/TenantProvider', () => ({ useTenant: useTenantMock }));

import { usePrefetchSales } from './usePrefetchSales';

beforeEach(() => {
  Object.values(prefetchSpies).forEach(spy => spy.mockReset());
  useTenantMock.mockReset();
});

describe('usePrefetchSales', () => {
  it('prefetches all four entry queries with the page inputs when a site is active', () => {
    useTenantMock.mockReturnValue({ currentSite: { id: 'site-1' } });

    const { result } = renderHook(() => usePrefetchSales());
    result.current();

    expect(prefetchSpies.salesList).toHaveBeenCalledWith({ page: 1, perPage: 50 });
    expect(prefetchSpies.salesSummary).toHaveBeenCalled();
    expect(prefetchSpies.customersList).toHaveBeenCalledWith({
      page: 1,
      perPage: 100,
      isActive: true,
    });
    expect(prefetchSpies.cashGetActive).toHaveBeenCalledWith({ siteId: 'site-1' });
  });

  it('skips cashSessions.getActive when no site is active', () => {
    useTenantMock.mockReturnValue({ currentSite: null });

    const { result } = renderHook(() => usePrefetchSales());
    result.current();

    expect(prefetchSpies.salesList).toHaveBeenCalled();
    expect(prefetchSpies.salesSummary).toHaveBeenCalled();
    expect(prefetchSpies.customersList).toHaveBeenCalled();
    expect(prefetchSpies.cashGetActive).not.toHaveBeenCalled();
  });
});
