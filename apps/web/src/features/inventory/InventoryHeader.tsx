// Inventory screen header: title + the segmented view tabs + the new-entry /
// new-adjustment buttons, extracted from InventoryPage.tsx (ENG-178 slice 33).

import { useTranslation } from 'react-i18next';
import { ClipboardList, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { viewKeys, type InventoryView } from '@/features/inventory/inventoryViews';

interface InventoryHeaderProps {
  activeView: InventoryView;
  canManage: boolean;
  onViewChange: (view: InventoryView) => void;
  onNewEntry: () => void;
  onNewAdjustment: () => void;
}

export function InventoryHeader({
  activeView,
  canManage,
  onViewChange,
  onNewEntry,
  onNewAdjustment,
}: InventoryHeaderProps) {
  const { t } = useTranslation('inventory');
  return (
    <div className="page-header-row">
      <h1 className="text-2xl font-bold text-secondary-900">{t('page.title')}</h1>

      <div className="page-header-actions">
        <div className="segmented-control">
          {(Object.keys(viewKeys) as InventoryView[]).map(view => (
            <button
              key={view}
              className={cn('segmented-tab', activeView === view ? 'segmented-tab-active' : '')}
              onClick={() => onViewChange(view)}
            >
              {t(viewKeys[view])}
            </button>
          ))}
        </div>

        <button
          className="btn-secondary flex items-center gap-2"
          onClick={onNewEntry}
          disabled={!canManage}
        >
          <ClipboardList className="h-4 w-4" />
          {t('newEntry')}
        </button>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={onNewAdjustment}
          disabled={!canManage}
        >
          <Search className="h-4 w-4" />
          {t('newAdjustment')}
        </button>
      </div>
    </div>
  );
}
