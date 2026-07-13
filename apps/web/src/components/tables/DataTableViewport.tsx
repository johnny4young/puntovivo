/** ENG-178 — Accessible paged and virtual table viewport for DataTable. */
import { flexRender, type ColumnDef, type Row, type Table } from '@tanstack/react-table';
import type { VirtualItem } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import type { KeyboardEvent, MutableRefObject, RefObject } from 'react';

import { cn } from '@/lib/utils';

const VIRTUAL_MAX_HEIGHT_PX = 560;

interface DataTableViewportProps<TData, TValue> {
  table: Table<TData>;
  columns: readonly ColumnDef<TData, TValue>[];
  visibleRows: readonly Row<TData>[];
  isVirtual: boolean;
  variant: 'default' | 'dense';
  virtualItems: readonly VirtualItem[];
  virtualPaddingTop: number;
  virtualPaddingBottom: number;
  resolvedFocusedRowIndex: number;
  enableRowSelection: boolean;
  rowRefs: MutableRefObject<Array<HTMLTableRowElement | null>>;
  tableWrapperRef: RefObject<HTMLDivElement | null>;
  scrollableLabel: string;
  noResultsLabel: string;
  isRowSelected: ((row: TData) => boolean) | undefined;
  onRowFocusChange: ((row: TData | null) => void) | undefined;
  onRowActivate: ((row: TData) => void) | undefined;
  onFocusedRowIndexChange: (index: number) => void;
  onFocusRow: (index: number) => void;
  onMeasureRow: (element: HTMLTableRowElement) => void;
}

export function DataTableViewport<TData, TValue>({
  table,
  columns,
  visibleRows,
  isVirtual,
  variant,
  virtualItems,
  virtualPaddingTop,
  virtualPaddingBottom,
  resolvedFocusedRowIndex,
  enableRowSelection,
  rowRefs,
  tableWrapperRef,
  scrollableLabel,
  noResultsLabel,
  isRowSelected,
  onRowFocusChange,
  onRowActivate,
  onFocusedRowIndexChange,
  onFocusRow,
  onMeasureRow,
}: DataTableViewportProps<TData, TValue>) {
  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    rowIndex: number,
    row: Row<TData>
  ) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        onFocusRow(rowIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        onFocusRow(rowIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        onFocusRow(0);
        break;
      case 'End':
        event.preventDefault();
        onFocusRow(visibleRows.length - 1);
        break;
      case ' ':
      case 'Space':
      case 'Enter':
        // ENG-134f — app-level activation has priority over TanStack selection.
        if (onRowActivate) {
          event.preventDefault();
          onRowActivate(row.original);
          return;
        }
        if (!enableRowSelection || !row.getCanSelect()) {
          return;
        }
        event.preventDefault();
        row.toggleSelected();
        break;
      default:
        break;
    }
  };

  // ENG-172 — one row renderer preserves markup and keyboard contracts in
  // both the paged and windowed paths.
  const renderRow = (row: Row<TData>, rowIndex: number) => {
    const domainId = (row.original as { id?: unknown } | null | undefined)?.id;
    const appSelected = isRowSelected?.(row.original) ?? false;

    return (
      <tr
        key={row.id}
        data-index={rowIndex}
        ref={element => {
          rowRefs.current[rowIndex] = element;
          if (isVirtual && element) {
            onMeasureRow(element);
          }
        }}
        data-state={row.getIsSelected() && 'selected'}
        data-row-id={typeof domainId === 'string' ? domainId : undefined}
        data-app-selected={appSelected ? 'true' : undefined}
        tabIndex={rowIndex === resolvedFocusedRowIndex ? 0 : -1}
        aria-selected={
          isRowSelected ? appSelected : enableRowSelection ? row.getIsSelected() : undefined
        }
        className={cn(
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset',
          appSelected && 'bg-primary-50/70'
        )}
        onFocus={() => {
          onFocusedRowIndexChange(rowIndex);
          onRowFocusChange?.(row.original);
        }}
        onClick={() => onRowFocusChange?.(row.original)}
        onBlur={event => {
          // BUG-004 — only clear app focus when focus leaves the whole table.
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
        onKeyDown={event => handleRowKeyDown(event, rowIndex, row)}
      >
        {row.getVisibleCells().map(cell => (
          <td key={cell.id} className={cell.column.columnDef.meta?.cellClassName}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div className="overflow-hidden rounded-[24px] border border-line/80 bg-card/82 shadow-[var(--shadow-card)]">
      {/* ENG-134c — keyboard-reachable named region satisfies axe for
       * horizontally scrollable seeded tables. */}
      <div
        ref={tableWrapperRef}
        className="data-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={scrollableLabel}
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
                  {noResultsLabel}
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
  );
}
