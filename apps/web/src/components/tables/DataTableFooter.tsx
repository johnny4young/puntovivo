/** ENG-178 — Paged and virtual row-count footers for DataTable. */
import type { Table } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DataTableFooterProps<TData> {
  table: Table<TData>;
  isVirtual: boolean;
}

export function DataTableFooter<TData>({ table, isVirtual }: DataTableFooterProps<TData>) {
  const { t } = useTranslation('common');
  const filteredCount = table.getFilteredRowModel().rows.length;

  if (isVirtual) {
    // ENG-172 — virtualised tables scroll instead of paging.
    return (
      <div className="data-table-pagination">
        <div className="text-sm text-secondary-600">
          {filteredCount === 0
            ? t('table.noEntries')
            : t('table.totalRows', { count: filteredCount })}
        </div>
      </div>
    );
  }

  const { pageIndex, pageSize } = table.getState().pagination;
  return (
    <div className="data-table-pagination">
      <div className="text-sm text-secondary-600">
        {filteredCount === 0
          ? t('table.noEntries')
          : t('table.showing', {
              from: pageIndex * pageSize + 1,
              to: Math.min((pageIndex + 1) * pageSize, filteredCount),
              total: filteredCount,
            })}
      </div>
      <div className="flex items-center space-x-2">
        <button
          className="btn-outline btn-icon"
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
          aria-label={t('pagination.goToFirst')}
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button
          className="btn-outline btn-icon"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          aria-label={t('pagination.goToPrevious')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm text-secondary-600">
          {t('table.page', { current: pageIndex + 1, total: table.getPageCount() })}
        </span>
        <button
          className="btn-outline btn-icon"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          aria-label={t('pagination.goToNext')}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          className="btn-outline btn-icon"
          onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          disabled={!table.getCanNextPage()}
          aria-label={t('pagination.goToLast')}
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
