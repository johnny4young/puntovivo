import { TableToolbar } from '@/components/tables/TableToolbar';
import { useTableExport } from '@/hooks/useTableExport';
import type { ExportColumn } from '@/services/export/exportService';
import { cn } from '@/lib/utils';

interface TableExportActionsProps<T extends object> {
  data: T[];
  columns: ExportColumn<T>[];
  filename: string;
  title: string;
  className?: string;
}

export function TableExportActions<T extends object>({
  data,
  columns,
  filename,
  title,
  className,
}: TableExportActionsProps<T>) {
  const {
    error,
    exportFormat,
    handleExportCSV,
    handleExportExcel,
    handleExportPDF,
    handlePrint,
    isExporting,
    showAllColumns,
    toggleColumnVisibility,
    visibleColumns,
  } = useTableExport({
    filename,
    title,
    columns,
  });

  return (
    <div className={cn('space-y-3', className)}>
      <TableToolbar
        columns={columns.map(column => ({
          key: column.key,
          header: column.header,
        }))}
        visibleColumns={visibleColumns}
        onToggleColumn={toggleColumnVisibility}
        onShowAllColumns={showAllColumns}
        isExporting={isExporting}
        exportFormat={exportFormat}
        onExportCSV={() => handleExportCSV(data)}
        onExportExcel={() => void handleExportExcel(data)}
        onExportPDF={() => void handleExportPDF(data)}
        onPrint={() => handlePrint(data)}
        showSearch={false}
      />

      {error && <p className="text-sm text-danger-500">{error}</p>}
    </div>
  );
}
