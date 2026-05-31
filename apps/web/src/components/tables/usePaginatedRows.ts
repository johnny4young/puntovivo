import { useMemo, useState } from 'react';

/**
 * Shape returned by {@link usePaginatedRows}. Designed to be spread directly
 * into the presentational `TablePagination` footer plus the table body that
 * renders `pageRows`.
 *
 * @typeParam T - Row element type. The hook is fully generic and never reads
 * any field of `T`, so it works for any row shape (products, sales, audit
 * entries, etc.).
 */
export interface PaginatedRows<T> {
  /** The slice of `rows` belonging to the current page. */
  pageRows: T[];
  /** Zero-based index of the current page. */
  page: number;
  /**
   * Imperatively move to a page. Callers normally wire this to the
   * `onPageChange` prop of `TablePagination`. The hook clamps reads to a
   * valid range, but callers should still pass an in-range index.
   */
  setPage: (page: number) => void;
  /** Total number of pages (always at least 1, even when `rows` is empty). */
  pageCount: number;
  /** Total number of rows across all pages (`rows.length`). */
  total: number;
  /**
   * One-based index of the first row shown on the current page, suitable for
   * a "Showing {rangeStart}-{rangeEnd} of {total}" label. Equals 0 when there
   * are no rows at all.
   */
  rangeStart: number;
  /**
   * One-based index of the last row shown on the current page. Equals 0 when
   * there are no rows at all.
   */
  rangeEnd: number;
  /**
   * `true` when there is more than one page worth of rows (`total > pageSize`).
   * Consumers use this to decide whether to render the pagination footer at
   * all — a single short page needs no controls.
   */
  hasPagination: boolean;
}

/**
 * Client-side pagination over an in-memory array of rows.
 *
 * This is a pure presentation helper: it owns only the current page index and
 * derives every other value from `rows` + `pageSize`. It performs no fetching,
 * sorting, or filtering — feed it the already-sorted/filtered array and render
 * the returned `pageRows`.
 *
 * The page index resets to 0 whenever the number of `rows` changes. This keeps
 * the user from being stranded on a now-empty trailing page after a filter
 * narrows (or a query grows) the result set. A content swap that keeps the
 * same length does not jump back to page 0, but the current page is always
 * clamped into range so the returned slice is never out of bounds. The reset
 * keys on row count rather than array identity so callers can safely pass an
 * inline-derived array (`rows.filter(...)`) without triggering a render loop.
 *
 * @typeParam T - Row element type.
 * @param rows - The full, already-prepared list of rows to paginate.
 * @param pageSize - Rows per page. Defaults to 8. Values `< 1` are treated as
 * 1 so the hook never divides by zero or produces an empty page.
 * @returns A {@link PaginatedRows} bag of the current page slice plus the
 * derived metadata needed to render a pagination footer.
 *
 * @example
 * ```tsx
 * const { pageRows, hasPagination, ...pagination } = usePaginatedRows(filtered);
 * return (
 *   <>
 *     <ul>{pageRows.map(row => <Row key={row.id} {...row} />)}</ul>
 *     {hasPagination && (
 *       <TablePagination {...pagination} onPageChange={pagination.setPage} />
 *     )}
 *   </>
 * );
 * ```
 */
export function usePaginatedRows<T>(rows: T[], pageSize = 8): PaginatedRows<T> {
  // Guard against a non-positive page size: a size of 0 would make pageCount
  // Infinity and slice nothing. Clamp to at least one row per page.
  const safePageSize = pageSize >= 1 ? Math.floor(pageSize) : 1;

  const [page, setPage] = useState(0);

  const total = rows.length;

  // Reset to the first page when the result set changes size. This uses the
  // React "adjust state while rendering" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes):
  // tracking the previous length and calling setState during render is cheaper
  // and tear-free compared with an effect, and avoids the extra commit that
  // would briefly render a stale trailing page.
  //
  // The trigger is the row COUNT, not the array reference, on purpose: callers
  // commonly pass an inline-derived array (rows.filter(...)) whose identity
  // changes every render. Keying the reset on identity would loop infinitely
  // for those callers; keying on length is loop-proof for any caller. A
  // same-length content swap (e.g. a fresh query returning the same number of
  // rows) does not force page 0, but the every-render clamp below still keeps
  // the page index inside the valid range, so the slice is never stale.
  const [prevTotal, setPrevTotal] = useState(total);
  if (total !== prevTotal) {
    setPrevTotal(total);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(total / safePageSize));

  // Clamp the requested page into the valid range every render. This protects
  // the slice when the list shrinks (without changing to a smaller count that
  // already triggered the reset above) and when a caller passes a stale index.
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);

  const pageRows = useMemo(() => {
    const start = safePage * safePageSize;
    return rows.slice(start, start + safePageSize);
  }, [rows, safePage, safePageSize]);

  // One-based display range. Both collapse to 0 when there are no rows so the
  // label can read "Showing 0-0 of 0" without negative or off-by-one numbers.
  const rangeStart = total === 0 ? 0 : safePage * safePageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(rangeStart + safePageSize - 1, total);

  const hasPagination = total > safePageSize;

  return {
    pageRows,
    page: safePage,
    setPage,
    pageCount,
    total,
    rangeStart,
    rangeEnd,
    hasPagination,
  };
}
