import { useState, useCallback, useMemo } from 'react';
import {
  exportToCSV,
  exportToExcel,
  exportToPDF,
  printTable,
  ExportColumn,
  ExportOptions,
} from '@/services/export/exportService';

export type ExportFormat = 'csv' | 'excel' | 'pdf';

export interface UseTableExportOptions<T> {
  /** Default filename for exports */
  filename?: string;
  /** Title for exports (used in PDF/Excel headers) */
  title?: string;
  /** Columns configuration for export */
  columns: ExportColumn<T>[];
  /** Initially visible columns (by key) */
  initialVisibleColumns?: string[];
}

export interface UseTableExportReturn<T> {
  /** Current export loading state */
  isExporting: boolean;
  /** Current export format being processed */
  exportFormat: ExportFormat | null;
  /** Export error message if any */
  error: string | null;
  /** Set of visible column keys */
  visibleColumns: Set<string>;
  /** Toggle visibility of a column */
  toggleColumnVisibility: (columnKey: string) => void;
  /** Set visibility for multiple columns at once */
  setColumnsVisibility: (columnKeys: string[], visible: boolean) => void;
  /** Show all columns */
  showAllColumns: () => void;
  /** Hide all columns */
  hideAllColumns: () => void;
  /** Check if a column is visible */
  isColumnVisible: (columnKey: string) => boolean;
  /** Get only the visible columns */
  getVisibleColumns: () => ExportColumn<T>[];
  /** Export data to CSV */
  handleExportCSV: (data: T[]) => void;
  /** Export data to Excel */
  handleExportExcel: (data: T[]) => Promise<void>;
  /** Export data to PDF */
  handleExportPDF: (data: T[]) => Promise<void>;
  /** Export data to specified format */
  handleExport: (data: T[], format: ExportFormat) => Promise<void>;
  /** Print table data */
  handlePrint: (data: T[]) => void;
  /** Clear any export error */
  clearError: () => void;
}

/**
 * Custom hook for managing table export functionality
 *
 * @example
 * ```tsx
 * const {
 *   isExporting,
 *   visibleColumns,
 *   toggleColumnVisibility,
 *   handleExportCSV,
 *   handleExportExcel,
 *   handleExportPDF,
 *   handlePrint,
 * } = useTableExport({
 *   filename: 'products',
 *   title: 'Products Report',
 *   columns: [
 *     { key: 'name', header: 'Name' },
 *     { key: 'price', header: 'Price', formatter: (v) => `$${v}` },
 *   ],
 * });
 * ```
 */
export function useTableExport<T extends object>(
  options: UseTableExportOptions<T>
): UseTableExportReturn<T> {
  const { filename = 'export', title, columns, initialVisibleColumns } = options;

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    if (initialVisibleColumns) {
      return new Set(initialVisibleColumns);
    }
    return new Set(columns.map(col => col.key));
  });

  // Export options
  const exportOptions: ExportOptions = useMemo(
    () => ({
      title,
      includeTimestamp: true,
    }),
    [title]
  );

  // Get visible columns for export
  const getVisibleColumns = useCallback((): ExportColumn<T>[] => {
    return columns.filter(col => visibleColumns.has(col.key));
  }, [columns, visibleColumns]);

  // Column visibility handlers
  const toggleColumnVisibility = useCallback((columnKey: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnKey)) {
        // Don't allow hiding all columns
        if (next.size > 1) {
          next.delete(columnKey);
        }
      } else {
        next.add(columnKey);
      }
      return next;
    });
  }, []);

  const setColumnsVisibility = useCallback(
    (columnKeys: string[], visible: boolean) => {
      setVisibleColumns(prev => {
        const next = new Set(prev);
        columnKeys.forEach(key => {
          if (visible) {
            next.add(key);
          } else {
            next.delete(key);
          }
        });
        // Ensure at least one column is visible
        if (next.size === 0 && columns.length > 0) {
          next.add(columns[0].key);
        }
        return next;
      });
    },
    [columns]
  );

  const showAllColumns = useCallback(() => {
    setVisibleColumns(new Set(columns.map(col => col.key)));
  }, [columns]);

  const hideAllColumns = useCallback(() => {
    // Keep at least the first column visible
    if (columns.length > 0) {
      setVisibleColumns(new Set([columns[0].key]));
    }
  }, [columns]);

  const isColumnVisible = useCallback(
    (columnKey: string): boolean => {
      return visibleColumns.has(columnKey);
    },
    [visibleColumns]
  );

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Export handlers
  const handleExportCSV = useCallback(
    (data: T[]) => {
      try {
        setIsExporting(true);
        setExportFormat('csv');
        setError(null);
        const visibleCols = getVisibleColumns();
        exportToCSV(data, visibleCols, filename, exportOptions);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to export CSV';
        setError(message);
        console.error('CSV export error:', err);
      } finally {
        setIsExporting(false);
        setExportFormat(null);
      }
    },
    [filename, exportOptions, getVisibleColumns]
  );

  const handleExportExcel = useCallback(
    async (data: T[]) => {
      try {
        setIsExporting(true);
        setExportFormat('excel');
        setError(null);
        const visibleCols = getVisibleColumns();
        await exportToExcel(data, visibleCols, filename, exportOptions);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to export Excel';
        setError(message);
        console.error('Excel export error:', err);
      } finally {
        setIsExporting(false);
        setExportFormat(null);
      }
    },
    [filename, exportOptions, getVisibleColumns]
  );

  const handleExportPDF = useCallback(
    async (data: T[]) => {
      try {
        setIsExporting(true);
        setExportFormat('pdf');
        setError(null);
        const visibleCols = getVisibleColumns();
        await exportToPDF(data, visibleCols, filename, exportOptions);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to export PDF';
        setError(message);
        console.error('PDF export error:', err);
      } finally {
        setIsExporting(false);
        setExportFormat(null);
      }
    },
    [filename, exportOptions, getVisibleColumns]
  );

  const handleExport = useCallback(
    async (data: T[], format: ExportFormat) => {
      switch (format) {
        case 'csv':
          handleExportCSV(data);
          break;
        case 'excel':
          await handleExportExcel(data);
          break;
        case 'pdf':
          await handleExportPDF(data);
          break;
        default:
          setError(`Unknown export format: ${format}`);
      }
    },
    [handleExportCSV, handleExportExcel, handleExportPDF]
  );

  const handlePrint = useCallback(
    (data: T[]) => {
      try {
        setError(null);
        const visibleCols = getVisibleColumns();
        printTable(data, visibleCols, exportOptions);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to print';
        setError(message);
        console.error('Print error:', err);
      }
    },
    [exportOptions, getVisibleColumns]
  );

  return {
    isExporting,
    exportFormat,
    error,
    visibleColumns,
    toggleColumnVisibility,
    setColumnsVisibility,
    showAllColumns,
    hideAllColumns,
    isColumnVisible,
    getVisibleColumns,
    handleExportCSV,
    handleExportExcel,
    handleExportPDF,
    handleExport,
    handlePrint,
    clearError,
  };
}
