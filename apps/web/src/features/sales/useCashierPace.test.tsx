/** ENG-209 — the live pace query owns the bounded polling contract. */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCashierPace } from './useCashierPace';

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(() => ({ data: null })),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    cashSessions: {
      myPace: { useQuery: useQueryMock },
    },
  },
}));

describe('useCashierPace', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useQueryMock.mockClear();
  });

  it('polls the authenticated active shift at a bounded cadence', () => {
    renderHook(() => useCashierPace('site-a'));

    expect(useQueryMock).toHaveBeenLastCalledWith(
      { siteId: 'site-a' },
      expect.objectContaining({ refetchInterval: 60_000, staleTime: 30_000 })
    );
  });
});
