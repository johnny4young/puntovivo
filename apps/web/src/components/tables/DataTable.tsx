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
  type Row,
  type RowData,
} from '@tanstack/react-table';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
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

// ENG-172 — row virtualisation. Above AUTO_VIRTUALISE_THRESHOLD rows the
// table renders a single continuous scroll (windowed via
// `@tanstack/react-virtual`) instead of the paged-button footer, so a
// ≥10k-row dataset scrolls at 60 fps without mounting every <tr>. Below
// the threshold the legacy TanStack-paginated path is used byte-for-byte.
// The threshold and the bounded scroll height pin the invariant that the
// E2E `data-row-id` contract still resolves: both e2e row selectors target
// the newest row (top of a desc(createdAt) list), which is always inside
// the initial virtual window at scrollOffset 0.
const AUTO_VIRTUALISE_THRESHOLD = 30;
const VIRTUAL_ESTIMATED_ROW_PX = 49;
const VIRTUAL_OVERSCAN_ROWS = 8;
const VIRTUAL_MAX_HEIGHT_PX = 560;

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
  /**
   * ENG-172 — opt a table into row virtualisation. When `undefined`
   * (the default), the table auto-flips to the virtualised single-scroll
   * renderer once `data.length > 30` ({@link AUTO_VIRTUALISE_THRESHOLD}) and
   * stays on the legacy TanStack-paginated footer below it. Pass an explicit
   * boolean to override the heuristic in either direction (e.g.
   * `virtualised={false}` to force pagination on a large table, or
   * `virtualised` to virtualise a small one in a test). The public API is
   * unchanged for every existing caller: omitting the prop preserves today's
   * paged behaviour for any table with ≤30 rows. The `data-row-id` E2E
   * attribute and keyboard roving-tabindex navigation are preserved in both
   * modes.
   */
  virtualised?: boolean | undefined;
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
  virtualised,
}: DataTableProps<TData, TValue>) {
  // ENG-172 — explicit prop wins; otherwise auto-flip on row count.
  const isVirtual = virtualised ?? data.length > AUTO_VIRTUALISE_THRESHOLD;
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
  // ENG-172 — in virtual mode bypass `getPaginationRowModel` and render the
  // full filtered + sorted set (`getSortedRowModel`) inside the windowing
  // scroll container; the paged path keeps the final (paginated) row model.
  // Keyboard navigation, the empty state, and the roving tabindex all index
  // into this single `visibleRows` array regardless of mode.
  const visibleRows = isVirtual
    ? table.getSortedRowModel().rows
    : table.getRowModel().rows;
  const searchColumn = searchKey ? table.getColumn(searchKey) : undefined;
  const selectedRowCount = Object.keys(rowSelection).filter(key => rowSelection[key]).length;
  const resolvedFocusedRowIndex =
    visibleRows.length === 0 ? -1 : Math.min(focusedRowIndex, visibleRows.length - 1);

  // ENG-172 — the windowing engine. `enabled: isVirtual` keeps it inert (no
  // ResizeObserver, empty virtual items) on the paged path. The scroll
  // element is the existing `.data-table-scroll` wrapper, which gains a
  // bounded max-height only when virtual so it actually scrolls.
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => tableWrapperRef.current,
    estimateSize: () => VIRTUAL_ESTIMATED_ROW_PX,
    overscan: VIRTUAL_OVERSCAN_ROWS,
    enabled: isVirtual,
  });

  // ENG-172 — a keyboard move in virtual mode may target a row that is not
  // yet mounted; `scrollToIndex` brings it into the window and this ref lets
  // the post-render effect land focus once the <tr> exists.
  const pendingFocusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isVirtual) {
      return;
    }
    const target = pendingFocusIndexRef.current;
    if (target === null) {
      return;
    }
    const element = rowRefs.current[target];
    if (element) {
      element.focus();
      pendingFocusIndexRef.current = null;
    }
  });

  const focusRow = (index: number) => {
    if (visibleRows.length === 0) {
      return;
    }

    const nextIndex = Math.min(Math.max(index, 0), visibleRows.length - 1);
    setFocusedRowIndex(nextIndex);
    if (isVirtual) {
      // Scroll the target into the window, then focus it now if it is
      // already mounted (small moves) — otherwise the effect above focuses
      // it after the virtualiser re-renders (Home/End across the full list).
      rowVirtualizer.scrollToIndex(nextIndex);
      pendingFocusIndexRef.current = nextIndex;
    }
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

  // ENG-172 — single source of truth for a body `<tr>`, shared by the paged
  // and virtualised paths so the markup, `data-row-id` contract, keyboard
  // handlers and roving tabindex stay identical in both modes. `rowIndex` is
  // the absolute index into `visibleRows`.
  const renderRow = (row: Row<TData>, rowIndex: number) => {
    // Surface the domain id on the <tr> when the row data carries one. This is
    // cheap (read-only attribute, no React tree change) and unblocks E2E tests
    // that need to pick a specific row deterministically — especially under
    // parallelism where position-based selectors (.first()) race.
    const domainId = (row.original as { id?: unknown } | null | undefined)?.id;
    return (
      <tr
        key={row.id}
        data-index={rowIndex}
        ref={element => {
          rowRefs.current[rowIndex] = element;
          // ENG-172 — pixel-accurate measurement keeps the virtual window
          // aligned when a row wraps taller than the estimate. No-op (and
          // unobserved) on the paged path.
          if (isVirtual && element) {
            rowVirtualizer.measureElement(element);
          }
        }}
        data-state={row.getIsSelected() && 'selected'}
        data-row-id={typeof domainId === 'string' ? domainId : undefined}
        data-app-selected={isRowSelected && isRowSelected(row.original) ? 'true' : undefined}
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
          // Announce focus changes on click too so parent-level selection
          // tracking stays in sync with mouse users.
          if (onRowFocusChange) {
            onRowFocusChange(row.original);
          }
        }}
        onBlur={event => {
          // BUG-004 — clear the parent focus state only when focus leaves the
          // WHOLE table, not on intra-row or row-to-row moves. relatedTarget
          // === null (focus went nowhere focusable) or a target outside the
          // table wrapper both count as "left the table". Moving to another
          // row / a nested cell control stays inside the wrapper, so selection
          // is preserved. The roving tabindex is untouched.
          if (!onRowFocusChange) {
            return;
          }
          const nextFocus = event.relatedTarget as Node | null;
          const stayedInTable =
            nextFocus !== null && tableWrapperRef.current?.contains(nextFocus) === true;
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
  };

  // ENG-172 — virtual-window geometry. The spacer-row technique (a leading
  // and trailing <tr> sized to the off-window height) preserves native
  // <table>/<td> column alignment and the sticky `.pv-table` header, which
  // absolute-positioning the rows would break.
  const virtualItems = isVirtual ? rowVirtualizer.getVirtualItems() : [];
  const firstVirtualItem = virtualItems[0];
  const lastVirtualItem = virtualItems[virtualItems.length - 1];
  const virtualPaddingTop = firstVirtualItem ? firstVirtualItem.start : 0;
  const virtualPaddingBottom = lastVirtualItem
    ? rowVirtualizer.getTotalSize() - lastVirtualItem.end
    : 0;

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
          // ENG-172 — bound the height only in virtual mode so the wrapper
          // becomes the windowing scroll container; the paged path keeps its
          // natural content height. `data-virtualised` lets tests + the live
          // smoke assert the mode flipped without depending on layout math.
          data-virtualised={isVirtual ? 'true' : undefined}
          style={isVirtual ? { maxHeight: VIRTUAL_MAX_HEIGHT_PX, overflowY: 'auto' } : undefined}
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
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="h-28 text-center text-secondary-500">
                    {t('table.noResults')}
                  </td>
                </tr>
              ) : isVirtual ? (
                <>
                  {virtualPaddingTop > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={columns.length}
                        style={{ height: virtualPaddingTop, padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                  {virtualItems.map(virtualRow => {
                    const row = visibleRows[virtualRow.index];
                    return row ? renderRow(row, virtualRow.index) : null;
                  })}
                  {virtualPaddingBottom > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={columns.length}
                        style={{ height: virtualPaddingBottom, padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                </>
              ) : (
                visibleRows.map((row, rowIndex) => renderRow(row, rowIndex))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isVirtual ? (
        // ENG-172 — virtualised tables scroll instead of paging, so the
        // paged footer is replaced by a plain total-row count.
        <div className="data-table-pagination">
          <div className="text-sm text-secondary-600">
            {table.getFilteredRowModel().rows.length === 0
              ? t('table.noEntries')
              : t('table.totalRows', { count: table.getFilteredRowModel().rows.length })}
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
}
