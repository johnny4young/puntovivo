import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * Props for {@link TablePagination}. These line up 1:1 with the metadata
 * returned by `usePaginatedRows`, so a consumer can spread the hook result
 * (minus `pageRows` / `hasPagination`) and add `onPageChange`.
 */
export interface TablePaginationProps {
  /** Zero-based index of the current page. */
  page: number;
  /** Total number of pages. The footer renders nothing when this is `<= 1`. */
  pageCount: number;
  /** Total number of rows across all pages (drives the "of {total}" label). */
  total: number;
  /** One-based index of the first row on the current page. */
  rangeStart: number;
  /** One-based index of the last row on the current page. */
  rangeEnd: number;
  /**
   * Called with the requested zero-based page index when the user activates
   * the previous / next control. The component itself clamps requests to the
   * valid range, so this never fires with an out-of-bounds index.
   */
  onPageChange: (page: number) => void;
}

/**
 * Accessible pagination footer for client-side paginated lists.
 *
 * Renders a localized "Showing {rangeStart}-{rangeEnd} of {total}" summary
 * alongside Previous / Next buttons from the shared Operator Deck primitive. The buttons are
 * disabled — and announce their disabled state to assistive tech — at the
 * first and last page respectively, and each carries an `aria-label` for
 * screen-reader users.
 *
 * The component is purely presentational and renders `null` when there is one
 * page or fewer, so callers can mount it unconditionally; pair it with
 * `usePaginatedRows`'s `hasPagination` flag to skip it entirely when desired.
 *
 * @example
 * ```tsx
 * const { pageRows, hasPagination, ...rest } = usePaginatedRows(rows);
 * // ...render pageRows...
 * {hasPagination && <TablePagination {...rest} onPageChange={rest.setPage} />}
 * ```
 */
export function TablePagination({
  page,
  pageCount,
  total,
  rangeStart,
  rangeEnd,
  onPageChange,
}: TablePaginationProps) {
  const { t } = useTranslation('common');

  // Nothing to page through — keep the surface clean.
  if (pageCount <= 1) {
    return null;
  }

  const isFirstPage = page <= 0;
  const isLastPage = page >= pageCount - 1;
  const requestPage = (nextPage: number) => {
    onPageChange(Math.min(Math.max(nextPage, 0), pageCount - 1));
  };

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 pt-1"
      aria-label={t('pagination.navigation')}
    >
      <p className="text-[13px] text-fg3" aria-live="polite">
        {t('pagination.showing', { rangeStart, rangeEnd, total })}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="compact"
          className="disabled:pointer-events-none disabled:opacity-50"
          onClick={() => requestPage(page - 1)}
          disabled={isFirstPage}
          aria-label={t('pagination.previous')}
        >
          <ChevronLeft aria-hidden="true" />
          {t('pagination.previous')}
        </Button>
        <Button
          variant="outline"
          size="compact"
          className="disabled:pointer-events-none disabled:opacity-50"
          onClick={() => requestPage(page + 1)}
          disabled={isLastPage}
          aria-label={t('pagination.next')}
        >
          {t('pagination.next')}
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
