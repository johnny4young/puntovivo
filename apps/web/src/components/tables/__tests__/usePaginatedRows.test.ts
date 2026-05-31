import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePaginatedRows } from '../usePaginatedRows';

const makeRows = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

describe('usePaginatedRows', () => {
  it('returns only the first page slice and reports totals', () => {
    const { result } = renderHook(() => usePaginatedRows(makeRows(20), 8));

    expect(result.current.pageRows).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.current.page).toBe(0);
    expect(result.current.pageCount).toBe(3);
    expect(result.current.total).toBe(20);
    expect(result.current.rangeStart).toBe(1);
    expect(result.current.rangeEnd).toBe(8);
    expect(result.current.hasPagination).toBe(true);
  });

  it('exposes the requested page slice and a clamped trailing range', () => {
    const { result } = renderHook(() => usePaginatedRows(makeRows(20), 8));

    act(() => result.current.setPage(2));

    expect(result.current.page).toBe(2);
    expect(result.current.pageRows).toEqual([17, 18, 19, 20]);
    expect(result.current.rangeStart).toBe(17);
    expect(result.current.rangeEnd).toBe(20);
  });

  it('defaults to a page size of 8', () => {
    const { result } = renderHook(() => usePaginatedRows(makeRows(10)));

    expect(result.current.pageRows).toHaveLength(8);
    expect(result.current.pageCount).toBe(2);
  });

  it('reports hasPagination=false when the total fits on one page', () => {
    const { result } = renderHook(() => usePaginatedRows(makeRows(8), 8));

    expect(result.current.hasPagination).toBe(false);
    expect(result.current.pageCount).toBe(1);
  });

  it('handles an empty list with a zeroed range and a single page', () => {
    const { result } = renderHook(() => usePaginatedRows<number>([], 8));

    expect(result.current.pageRows).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.pageCount).toBe(1);
    expect(result.current.rangeStart).toBe(0);
    expect(result.current.rangeEnd).toBe(0);
    expect(result.current.hasPagination).toBe(false);
  });

  it('keeps the current page when a same-length list is swapped in', () => {
    const { result, rerender } = renderHook(({ rows }) => usePaginatedRows(rows, 8), {
      initialProps: { rows: makeRows(20) },
    });

    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);

    // A brand-new array of the SAME length (e.g. a refetch returning the same
    // count). The page is preserved — the reset keys on row count, not array
    // identity, so inline-derived arrays never force a render loop.
    rerender({ rows: makeRows(20) });

    expect(result.current.page).toBe(2);
    expect(result.current.pageRows).toEqual([17, 18, 19, 20]);
  });

  it('does not loop when the caller passes a fresh array identity every render', () => {
    // makeRows() runs on every render here, so `rows` is a new reference each
    // time. A length-keyed reset must stay stable rather than re-render forever.
    const { result, rerender } = renderHook(() => usePaginatedRows(makeRows(20), 8));

    act(() => result.current.setPage(2));
    rerender();

    expect(result.current.page).toBe(2);
    expect(result.current.pageRows).toEqual([17, 18, 19, 20]);
  });

  it('resets to the first page when a narrowing filter drops the row count', () => {
    const { result, rerender } = renderHook(({ rows }) => usePaginatedRows(rows, 8), {
      initialProps: { rows: makeRows(20) },
    });

    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);

    rerender({ rows: makeRows(3) });

    expect(result.current.page).toBe(0);
    expect(result.current.pageRows).toEqual([1, 2, 3]);
    expect(result.current.hasPagination).toBe(false);
  });

  it('treats a non-positive page size as one row per page', () => {
    const { result } = renderHook(() => usePaginatedRows(makeRows(3), 0));

    expect(result.current.pageRows).toEqual([1]);
    expect(result.current.pageCount).toBe(3);
  });
});
