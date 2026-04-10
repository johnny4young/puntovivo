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
} from '@tanstack/react-table';
import { useRef, useState, type KeyboardEvent } from 'react';
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

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string;
  searchPlaceholder?: string;
  enableRowSelection?: boolean;
  onRowSelectionChange?: (rows: TData[]) => void;
  pageSize?: number;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = 'Search...',
  enableRowSelection = false,
  onRowSelectionChange,
  pageSize = 10,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = useState('');
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

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
        const selectedRows = Object.keys(newSelection)
          .filter(key => newSelection[key])
          .map(key => data[parseInt(key)]);
        onRowSelectionChange(selectedRows);
      }
    },
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: 'includesString',
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
    },
    enableRowSelection,
    initialState: {
      pagination: {
        pageSize,
      },
    },
  });
  const visibleRows = table.getRowModel().rows;
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
            value={globalFilter ?? ''}
            onChange={e => setGlobalFilter(e.target.value)}
            className="input max-w-sm"
          />
        )}
        <div className="flex items-center gap-2">
          {enableRowSelection && Object.keys(rowSelection).length > 0 && (
            <span className="text-sm text-secondary-600">
              {Object.keys(rowSelection).filter(k => rowSelection[k]).length} selected
            </span>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-line/80 bg-card/82 shadow-[var(--shadow-card)]">
        <table className="data-table">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className={cn(header.column.getCanSort() && 'cursor-pointer select-none')}
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
              visibleRows.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  ref={element => {
                    rowRefs.current[rowIndex] = element;
                  }}
                  data-state={row.getIsSelected() && 'selected'}
                  tabIndex={rowIndex === resolvedFocusedRowIndex ? 0 : -1}
                  aria-selected={enableRowSelection ? row.getIsSelected() : undefined}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
                  onFocus={() => {
                    setFocusedRowIndex(rowIndex);
                  }}
                  onKeyDown={event => {
                    handleRowKeyDown(event, rowIndex, row.getCanSelect(), () => {
                      row.toggleSelected();
                    });
                  }}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="h-28 text-center text-secondary-500">
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="data-table-pagination">
        <div className="text-sm text-secondary-600">
          {table.getFilteredRowModel().rows.length === 0
            ? 'No entries to display'
            : `Showing ${
                table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1
              } to ${Math.min(
                (table.getState().pagination.pageIndex + 1) *
                  table.getState().pagination.pageSize,
                table.getFilteredRowModel().rows.length
              )} of ${table.getFilteredRowModel().rows.length} entries`}
        </div>
        <div className="flex items-center space-x-2">
          <button
            className="btn-outline btn-icon"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            aria-label="Go to first page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            className="btn-outline btn-icon"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Go to previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-secondary-600">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <button
            className="btn-outline btn-icon"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Go to next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            className="btn-outline btn-icon"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            aria-label="Go to last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
