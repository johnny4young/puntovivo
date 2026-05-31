import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  ColumnFiltersState,
  VisibilityState,
  RowSelectionState,
  type RowData,
} from '@tanstack/react-table';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Rediseño FASE 3 — per-column class hooks so dense (.pv-table) callers
// can opt cells into the recipe modifiers (`num` = right-aligned mono,
// the product anchor cell, etc.) without the DataTable hard-coding any
// column semantics. Augments TanStack's ColumnMeta so column defs stay
// fully typed (no `any` at the call sites).
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Extra className applied to each body `<td>` of this column. */
    cellClassName?: string;
    /** Extra className applied to the header `<th>` of this column. */
    headerClassName?: string;
  }
}

// ENG-179b — explicit `| undefined` on every optional field so callers
// can spread Props from parent state shapes carrying explicit-undefined
// fields under `exactOptionalPropertyTypes`.
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string | undefined;
  searchPlaceholder?: string | undefined;
  enableRowSelection?: boolean | undefined;
  onRowSelectionChange?: ((rows: TData[]) => void) | undefined;
  pageSize?: number | undefined;
  /**
   * Fires when the keyboard-focused row changes (click, ArrowUp/Down,
   * Home/End). `null` is emitted when focus leaves the table body. Used
   * by ENG-018b to let SalesHistoryTable surface the currently selected
   * sale id to Ctrl+Shift+P reprint.
   */
  onRowFocusChange?: ((row: TData | null) => void) | undefined;
  /**
   * Extra class applied to the `<tr>` when a predicate says the row is
   * in an app-level "selected" state (ENG-018b history-table
   * highlight). The predicate is called with the row's original data.
   */
  isRowSelected?: ((row: TData) => boolean) | undefined;
  /**
   * ENG-134f — Called when the keyboard user activates a row via
   * Enter or Space on the focused row. Mirrors what a mouse user
   * achieves by clicking the row's primary action button (View,
   * Edit, Open Details). When the prop is undefined, keyboard
   * activation falls back to the existing TanStack `toggleSelected`
   * behaviour (still gated by `enableRowSelection`).
   *
   * The activate path is unconditional — it does NOT require
   * `enableRowSelection` to be set. The two are orthogonal concerns:
   * `enableRowSelection` controls the multi-row checkbox state,
   * `onRowActivate` controls the "open detail" primary action.
   */
  onRowActivate?: ((row: TData) => void) | undefined;
  /**
   * Rediseño FASE 3 — visual density of the table chrome.
   * `default` keeps the legacy `.data-table` recipe; `dense` switches to
   * the redesign `.pv-table` recipe (sticky header, zebra, 48-52px rows,
   * 196px anchor first column). Opt in per consumer so anchor-style
   * tables (products, customers, inventory movements) adopt the dense
   * look while narrow CRUD tables keep the default until they are
   * migrated + smoked.
   */
  variant?: 'default' | 'dense' | undefined;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = 'Search...',
  enableRowSelection = false,
  onRowSelectionChange,
  pageSize = 10,
  onRowFocusChange,
  isRowSelected,
  onRowActivate,
  variant = 'default',
}: DataTableProps<TData, TValue>) {
  const { t } = useTranslation('common');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  // BUG-004 — wrapper anchor so a row blur can tell "focus moved to
  // another row / intra-row" (keep selection) from "focus left the
  // table entirely" (clear selection via onRowFocusChange(null)).
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: updater => {
      const newSelection = typeof updater === 'function' ? updater(rowSelection) : updater;
      setRowSelection(newSelection);
      if (onRowSelectionChange) {
        // Selection keys are array indices stringified by react-table.
        // Under `noUncheckedIndexedAccess`, `data[i]` is `TData | undefined`;
        // a stale key (race between data update + selection map) would
        // produce undefined. Filter those out so the callback contract
        // (`TData[]`) is honored.
        const selectedRows = Object.keys(newSelection)
          .filter(key => newSelection[key])
          .map(key => data[parseInt(key)])
          .filter((row): row is TData => row !== undefined);
        onRowSelectionChange(selectedRows);
      }
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
    enableRowSelection,
    initialState: {
      pagination: {
        pageSize,
      },
    },
  });
  const visibleRows = table.getRowModel().rows;
  const searchColumn = searchKey ? table.getColumn(searchKey) : undefined;
  const selectedRowCount = Object.keys(rowSelection).filter(key => rowSelection[key]).length;
  const resolvedFocusedRowIndex =
    visibleRows.length === 0 ? -1 : Math.min(focusedRowIndex, visibleRows.length - 1);

  const focusRow = (index: number) => {
    if (visibleRows.length === 0) {
      return;
    }

    const nextIndex = Math.min(Math.max(index, 0), visibleRows.length - 1);
    setFocusedRowIndex(nextIndex);
    rowRefs.current[nextIndex]?.focus();
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    rowIndex: number,
    rowCanSelect: boolean,
    rowData: TData,
    toggleSelected: () => void
  ) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(rowIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(rowIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusRow(0);
        break;
      case 'End':
        event.preventDefault();
        focusRow(visibleRows.length - 1);
        break;
      case ' ':
      case 'Space':
      case 'Enter':
        // ENG-134f — activate has priority over toggleSelected.
        // If the consumer wired `onRowActivate`, fire it
        // unconditionally (no enableRowSelection gate) — opening a
        // detail / edit modal is the cashier's primary keyboard
        // intent. Fall back to TanStack's row-selection toggle when
        // no activate handler is provided AND the consumer enabled
        // row selection (legacy checkbox-style workflow).
        if (onRowActivate) {
          event.preventDefault();
          onRowActivate(rowData);
          return;
        }
        if (!enableRowSelection || !rowCanSelect) {
          return;
        }
        event.preventDefault();
        toggleSelected();
        break;
      default:
        break;
    }
  };

  return (
    <div className="space-y-4">
      <div className="data-table-toolbar">
        {searchKey && (
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={(searchColumn?.getFilterValue() as string | undefined) ?? ''}
            onChange={e => searchColumn?.setFilterValue(e.target.value)}
            className="input max-w-sm"
          />
        )}
        <div className="flex items-center gap-2">
          {enableRowSelection && selectedRowCount > 0 && (
            <span className="text-sm text-secondary-600">
              {t('table.selectedRows', { count: selectedRowCount })}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-line/80 bg-card/82 shadow-[var(--shadow-card)]">
        {/* ENG-134c: the scrollable wrapper needs to satisfy axe rule
         * `scrollable-region-focusable` on wide tables (/products +
         * /purchases hit horizontal overflow under the seeded data).
         * axe requires the wrapper to be tab-reachable, not just
         * programmatically focusable, so we use `tabIndex={0}`.
         * `role="region"` + i18n `aria-label` give the region a
         * semantic name for screen readers; the label lives in
         * `common:table.scrollableLabel` (en + es neutral LATAM).
         * The first Tab now lands on the wrapper (screen-reader
         * announces "Scrollable table region"), the next Tab steps
         * into the first row that the roving tabindex on TR (line
         * ~248) keeps at 0. */}
        <div
          ref={tableWrapperRef}
          className="data-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t('table.scrollableLabel')}
        >
          <table className={variant === 'dense' ? 'pv-table' : 'data-table'}>
            <thead>
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() }}
                      className={cn(
                        header.column.getCanSort() && 'cursor-pointer select-none',
                        header.column.columnDef.meta?.headerClassName
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {header.isPlaceholder ? null : (
                        <div className="data-table-column-header">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <span className="ml-2">
                              {{
                                asc: <ChevronUp className="h-4 w-4" />,
                                desc: <ChevronDown className="h-4 w-4" />,
                              }[header.column.getIsSorted() as string] ?? (
                                <ChevronsUpDown className="h-4 w-4 text-secondary-400" />
                              )}
                            </span>
                          )}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {visibleRows.length ? (
                visibleRows.map((row, rowIndex) => {
                  // Surface the domain id on the <tr> when the row data carries
                  // one. This is cheap (read-only attribute, no React tree
                  // change) and unblocks E2E tests that need to pick a specific
                  // row deterministically — especially under parallelism where
                  // position-based selectors (.first()) race against each other.
                  const domainId = (row.original as { id?: unknown } | null | undefined)?.id;
                  return (
                    <tr
                      key={row.id}
                      ref={element => {
                        rowRefs.current[rowIndex] = element;
                      }}
                      data-state={row.getIsSelected() && 'selected'}
                      data-row-id={typeof domainId === 'string' ? domainId : undefined}
                      data-app-selected={
                        isRowSelected && isRowSelected(row.original) ? 'true' : undefined
                      }
                      tabIndex={rowIndex === resolvedFocusedRowIndex ? 0 : -1}
                      aria-selected={
                        isRowSelected
                          ? isRowSelected(row.original)
                          : enableRowSelection
                            ? row.getIsSelected()
                            : undefined
                      }
                      className={cn(
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset',
                        isRowSelected && isRowSelected(row.original) && 'bg-primary-50/70'
                      )}
                      onFocus={() => {
                        setFocusedRowIndex(rowIndex);
                        if (onRowFocusChange) {
                          onRowFocusChange(row.original);
                        }
                      }}
                      onClick={() => {
                        // Announce focus changes on click too so parent-level
                        // selection tracking stays in sync with mouse users.
                        if (onRowFocusChange) {
                          onRowFocusChange(row.original);
                        }
                      }}
                      onBlur={event => {
                        // BUG-004 — clear the parent focus state only when
                        // focus leaves the WHOLE table, not on intra-row or
                        // row-to-row moves. relatedTarget === null (focus went
                        // nowhere focusable, e.g. a click on empty page chrome)
                        // or a target outside the table wrapper both count as
                        // "left the table". Moving to another row / a nested
                        // cell control stays inside the wrapper, so selection
                        // is preserved (the operator can still tab between rows
                        // before reprinting). The roving tabindex is untouched.
                        if (!onRowFocusChange) {
                          return;
                        }
                        const nextFocus = event.relatedTarget as Node | null;
                        const stayedInTable =
                          nextFocus !== null &&
                          tableWrapperRef.current?.contains(nextFocus) === true;
                        if (!stayedInTable) {
                          onRowFocusChange(null);
                        }
                      }}
                      onKeyDown={event => {
                        handleRowKeyDown(event, rowIndex, row.getCanSelect(), row.original, () => {
                          row.toggleSelected();
                        });
                      }}
                    >
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className={cell.column.columnDef.meta?.cellClassName}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={columns.length} className="h-28 text-center text-secondary-500">
                    {t('table.noResults')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="data-table-pagination">
        <div className="text-sm text-secondary-600">
          {table.getFilteredRowModel().rows.length === 0
            ? t('table.noEntries')
            : t('table.showing', {
                from:
                  table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1,
                to: Math.min(
                  (table.getState().pagination.pageIndex + 1) *
                    table.getState().pagination.pageSize,
                  table.getFilteredRowModel().rows.length
                ),
                total: table.getFilteredRowModel().rows.length,
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
            {t('table.page', {
              current: table.getState().pagination.pageIndex + 1,
              total: table.getPageCount(),
            })}
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
    </div>
  );
}
