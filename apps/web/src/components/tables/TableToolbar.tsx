import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Printer,
  Columns,
  Search,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  File,
  X,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ExportFormat } from '@/hooks/useTableExport';

export interface TableToolbarColumn {
  key: string;
  header: string;
}

export interface TableToolbarProps {
  /** Columns available for visibility toggle */
  columns: TableToolbarColumn[];
  /** Set of visible column keys */
  visibleColumns: Set<string>;
  /** Callback to toggle column visibility */
  onToggleColumn: (columnKey: string) => void;
  /** Callback to show all columns */
  onShowAllColumns: () => void;
  /** Global search value */
  searchValue?: string;
  /** Callback for search value change */
  onSearchChange?: (value: string) => void;
  /** Search placeholder text */
  searchPlaceholder?: string;
  /** Number of selected rows */
  selectedCount?: number;
  /** Total number of rows */
  totalCount?: number;
  /** Whether export is in progress */
  isExporting?: boolean;
  /** Current export format being processed */
  exportFormat?: ExportFormat | null;
  /** Callback for CSV export */
  onExportCSV?: () => void;
  /** Callback for Excel export */
  onExportExcel?: () => void;
  /** Callback for PDF export */
  onExportPDF?: () => void;
  /** Callback for print */
  onPrint?: () => void;
  /** Additional class names */
  className?: string;
  /** Show search input */
  showSearch?: boolean;
  /** Show export buttons */
  showExport?: boolean;
  /** Show column visibility toggle */
  showColumnToggle?: boolean;
  /** Show print button */
  showPrint?: boolean;
}

interface DropdownProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

function Dropdown({ isOpen, onClose, children, className }: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={ref}
      className={cn(
        'absolute top-full left-0 mt-1 z-50 min-w-[180px] rounded-md border border-secondary-200 bg-white shadow-lg ring-1 ring-black ring-opacity-5',
        className
      )}
    >
      {children}
    </div>
  );
}

export function TableToolbar({
  columns,
  visibleColumns,
  onToggleColumn,
  onShowAllColumns,
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Search...',
  selectedCount = 0,
  totalCount,
  isExporting = false,
  exportFormat,
  onExportCSV,
  onExportExcel,
  onExportPDF,
  onPrint,
  className,
  showSearch = true,
  showExport = true,
  showColumnToggle = true,
  showPrint = true,
}: TableToolbarProps) {
  const { t } = useTranslation('common');
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);

  const hasExportOptions = onExportCSV || onExportExcel || onExportPDF;

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-4', className)}>
      {/* Left section: Search and selection info */}
      <div className="flex items-center gap-4">
        {showSearch && onSearchChange && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
            <input
              type="text"
              value={searchValue}
              onChange={e => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="input pl-10 pr-8 w-64"
            />
            {searchValue && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-secondary-100 text-secondary-400 hover:text-secondary-600"
                aria-label={t('toolbar.clearSearch')}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {selectedCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="badge-primary">{selectedCount} {t('toolbar.selected')}</span>
            {totalCount !== undefined && (
              <span className="text-secondary-500">{t('toolbar.ofTotal', { total: totalCount })}</span>
            )}
          </div>
        )}
      </div>

      {/* Right section: Actions */}
      <div className="flex items-center gap-2">
        {/* Column visibility toggle */}
        {showColumnToggle && (
          <div className="relative">
            <button
              onClick={() => setColumnsDropdownOpen(!columnsDropdownOpen)}
              className="btn-outline h-9 px-3 gap-2"
              aria-label={t('toolbar.toggleColumns')}
              aria-expanded={columnsDropdownOpen}
            >
              <Columns className="h-4 w-4" />
              <span className="hidden sm:inline">{t('toolbar.columns')}</span>
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', columnsDropdownOpen && 'rotate-180')}
              />
            </button>

            <Dropdown
              isOpen={columnsDropdownOpen}
              onClose={() => setColumnsDropdownOpen(false)}
              className="right-0 left-auto max-h-64 overflow-y-auto"
            >
              <div className="p-2">
                <div className="px-2 py-1.5 text-xs font-semibold text-secondary-500 uppercase tracking-wider">
                  {t('toolbar.toggleColumns')}
                </div>
                <div className="my-1 h-px bg-secondary-200" />
                {columns.map(column => (
                  <label
                    key={column.key}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(column.key)}
                      onChange={() => onToggleColumn(column.key)}
                      className="h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-secondary-700">{column.header}</span>
                  </label>
                ))}
                <div className="my-1 h-px bg-secondary-200" />
                <button
                  onClick={() => {
                    onShowAllColumns();
                    setColumnsDropdownOpen(false);
                  }}
                  className="w-full px-2 py-1.5 text-sm text-left text-primary-800 hover:bg-primary-50 rounded"
                >
                  {t('toolbar.showAllColumns')}
                </button>
              </div>
            </Dropdown>
          </div>
        )}

        {/* Export dropdown */}
        {showExport && hasExportOptions && (
          <div className="relative">
            <button
              onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
              disabled={isExporting}
              className={cn('btn-outline h-9 px-3 gap-2', isExporting && 'opacity-70 cursor-wait')}
              aria-label={t('toolbar.export')}
              aria-expanded={exportDropdownOpen}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">{isExporting ? t('toolbar.exporting') : t('toolbar.export')}</span>
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', exportDropdownOpen && 'rotate-180')}
              />
            </button>

            <Dropdown
              isOpen={exportDropdownOpen && !isExporting}
              onClose={() => setExportDropdownOpen(false)}
              className="right-0 left-auto"
            >
              <div className="py-1">
                {onExportCSV && (
                  <button
                    onClick={() => {
                      onExportCSV();
                      setExportDropdownOpen(false);
                    }}
                    disabled={isExporting}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
                  >
                    <File className="h-4 w-4 text-green-600" />
                    <div className="flex flex-col items-start">
                      <span>{t('toolbar.exportCSV')}</span>
                      <span className="text-xs text-secondary-400">{t('toolbar.exportCSVDesc')}</span>
                    </div>
                    {exportFormat === 'csv' && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
                  </button>
                )}
                {onExportExcel && (
                  <button
                    onClick={() => {
                      onExportExcel();
                      setExportDropdownOpen(false);
                    }}
                    disabled={isExporting}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-green-700" />
                    <div className="flex flex-col items-start">
                      <span>{t('toolbar.exportExcel')}</span>
                      <span className="text-xs text-secondary-400">{t('toolbar.exportExcelDesc')}</span>
                    </div>
                    {exportFormat === 'excel' && (
                      <Loader2 className="ml-auto h-4 w-4 animate-spin" />
                    )}
                  </button>
                )}
                {onExportPDF && (
                  <button
                    onClick={() => {
                      onExportPDF();
                      setExportDropdownOpen(false);
                    }}
                    disabled={isExporting}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
                  >
                    <FileText className="h-4 w-4 text-red-600" />
                    <div className="flex flex-col items-start">
                      <span>{t('toolbar.exportPDF')}</span>
                      <span className="text-xs text-secondary-400">{t('toolbar.exportPDFDesc')}</span>
                    </div>
                    {exportFormat === 'pdf' && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
                  </button>
                )}
              </div>
            </Dropdown>
          </div>
        )}

        {/* Print button */}
        {showPrint && onPrint && (
          <button onClick={onPrint} className="btn-outline h-9 px-3 gap-2" aria-label={t('toolbar.print')}>
            <Printer className="h-4 w-4" />
            <span className="hidden sm:inline">{t('toolbar.print')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
