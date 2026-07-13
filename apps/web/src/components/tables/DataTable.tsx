import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTableFooter } from './DataTableFooter';
import { DataTableToolbar } from './DataTableToolbar';
import { DataTableViewport } from './DataTableViewport';

// ENG-172 — datasets above the threshold render one windowed scroll instead
// of pagination. The initial virtual window still includes newest-first E2E rows.
const AUTO_VIRTUALISE_THRESHOLD = 30;
const VIRTUAL_ESTIMATED_ROW_PX = 49;
const VIRTUAL_OVERSCAN_ROWS = 8;

// Rediseño FASE 3 — typed per-column class hooks for dense consumers.
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    cellClassName?: string;
    headerClassName?: string;
  }
}

// ENG-179b — explicit undefined supports parent prop spreads under
// exactOptionalPropertyTypes.
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string | undefined;
  searchPlaceholder?: string | undefined;
  enableRowSelection?: boolean | undefined;
  onRowSelectionChange?: ((rows: TData[]) => void) | undefined;
  pageSize?: number | undefined;
  /** ENG-018b — Fires for row focus and null when focus leaves the table. */
  onRowFocusChange?: ((row: TData | null) => void) | undefined;
  /** ENG-018b — App-level selected predicate, independent from TanStack selection. */
  isRowSelected?: ((row: TData) => boolean) | undefined;
  /** ENG-134f — Enter/Space primary row action, independent from selection. */
  onRowActivate?: ((row: TData) => void) | undefined;
  /** Rediseño FASE 3 — dense opts into the pv-table visual recipe. */
  variant?: 'default' | 'dense' | undefined;
  /** ENG-172 — explicit override for the automatic virtualisation threshold. */
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
  const { t } = useTranslation('common');
  // ENG-172 — explicit prop wins; otherwise auto-flip on row count.
  const isVirtual = virtualised ?? data.length > AUTO_VIRTUALISE_THRESHOLD;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  // BUG-004 — distinguishes focus moving within the table from leaving it.
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
        // Ignore stale index keys after a concurrent data refresh.
        const selectedRows = Object.keys(newSelection)
          .filter(key => newSelection[key])
          .map(key => data[parseInt(key)])
          .filter((row): row is TData => row !== undefined);
        onRowSelectionChange(selectedRows);
      }
    },
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    enableRowSelection,
    initialState: { pagination: { pageSize } },
  });

  // ENG-172 — virtual mode bypasses pagination but preserves filtering/sorting.
  const visibleRows = isVirtual ? table.getSortedRowModel().rows : table.getRowModel().rows;
  const searchColumn = searchKey ? table.getColumn(searchKey) : undefined;
  const selectedRowCount = Object.keys(rowSelection).filter(key => rowSelection[key]).length;
  const resolvedFocusedRowIndex =
    visibleRows.length === 0 ? -1 : Math.min(focusedRowIndex, visibleRows.length - 1);

  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => tableWrapperRef.current,
    estimateSize: () => VIRTUAL_ESTIMATED_ROW_PX,
    overscan: VIRTUAL_OVERSCAN_ROWS,
    enabled: isVirtual,
  });
  // ENG-172 — Home/End can target an unmounted row; focus after windowing.
  const pendingFocusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isVirtual || pendingFocusIndexRef.current === null) {
      return;
    }
    const target = pendingFocusIndexRef.current;
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
      rowVirtualizer.scrollToIndex(nextIndex);
      pendingFocusIndexRef.current = nextIndex;
    }
    rowRefs.current[nextIndex]?.focus();
  };

  // ENG-172 — spacer rows preserve native table column alignment.
  const virtualItems = isVirtual ? rowVirtualizer.getVirtualItems() : [];
  const firstVirtualItem = virtualItems[0];
  const lastVirtualItem = virtualItems[virtualItems.length - 1];
  const virtualPaddingTop = firstVirtualItem?.start ?? 0;
  const virtualPaddingBottom = lastVirtualItem
    ? rowVirtualizer.getTotalSize() - lastVirtualItem.end
    : 0;

  return (
    <div className="space-y-4">
      <DataTableToolbar
        searchEnabled={Boolean(searchKey)}
        searchPlaceholder={searchPlaceholder}
        searchValue={(searchColumn?.getFilterValue() as string | undefined) ?? ''}
        selectedRowCount={selectedRowCount}
        selectionEnabled={enableRowSelection}
        onSearchChange={value => searchColumn?.setFilterValue(value)}
      />
      <DataTableViewport
        table={table}
        columns={columns}
        visibleRows={visibleRows}
        isVirtual={isVirtual}
        variant={variant}
        virtualItems={virtualItems}
        virtualPaddingTop={virtualPaddingTop}
        virtualPaddingBottom={virtualPaddingBottom}
        resolvedFocusedRowIndex={resolvedFocusedRowIndex}
        enableRowSelection={enableRowSelection}
        rowRefs={rowRefs}
        tableWrapperRef={tableWrapperRef}
        scrollableLabel={t('table.scrollableLabel')}
        noResultsLabel={t('table.noResults')}
        isRowSelected={isRowSelected}
        onRowFocusChange={onRowFocusChange}
        onRowActivate={onRowActivate}
        onFocusedRowIndexChange={setFocusedRowIndex}
        onFocusRow={focusRow}
        onMeasureRow={element => rowVirtualizer.measureElement(element)}
      />
      <DataTableFooter table={table} isVirtual={isVirtual} />
    </div>
  );
}
