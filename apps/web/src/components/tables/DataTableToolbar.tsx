/** ENG-178 — Search and selection summary for DataTable. */
import { useTranslation } from 'react-i18next';

interface DataTableToolbarProps {
  searchEnabled: boolean;
  searchPlaceholder: string;
  searchValue: string;
  selectedRowCount: number;
  selectionEnabled: boolean;
  onSearchChange: (value: string) => void;
}

export function DataTableToolbar({
  searchEnabled,
  searchPlaceholder,
  searchValue,
  selectedRowCount,
  selectionEnabled,
  onSearchChange,
}: DataTableToolbarProps) {
  const { t } = useTranslation('common');

  return (
    <div className="data-table-toolbar">
      {searchEnabled && (
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={event => onSearchChange(event.target.value)}
          className="input max-w-sm"
        />
      )}
      <div className="flex items-center gap-2">
        {selectionEnabled && selectedRowCount > 0 && (
          <span className="text-sm text-secondary-600">
            {t('table.selectedRows', { count: selectedRowCount })}
          </span>
        )}
      </div>
    </div>
  );
}
