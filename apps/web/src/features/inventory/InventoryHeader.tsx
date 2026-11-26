// Inventory screen header: title + 3 grouped primary tabs (with contextual sub-views) + action buttons.

import { useTranslation } from 'react-i18next';
import { ClipboardList, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  viewKeys,
  visibleInventoryViews,
  type InventoryView,
} from '@/features/inventory/inventoryViews';

interface InventoryHeaderProps {
  activeView: InventoryView;
  canManage: boolean;
  showPharmacy: boolean;
  onViewChange: (view: InventoryView) => void;
  onNewEntry: () => void;
  onNewAdjustment: () => void;
}

interface InventoryTabGroup {
  id: 'stock' | 'movements' | 'controlsExpiry' | 'pharmacy';
  labelKey: string;
  views: InventoryView[];
}

const INVENTORY_TAB_GROUPS: InventoryTabGroup[] = [
  { id: 'stock', labelKey: 'page.tabs.groupStock', views: ['stock', 'balances'] },
  {
    id: 'movements',
    labelKey: 'page.tabs.groupMovements',
    views: ['movements', 'entries', 'transformations'],
  },
  {
    id: 'controlsExpiry',
    labelKey: 'page.tabs.groupControlsExpiry',
    views: ['controls', 'expiry'],
  },
  { id: 'pharmacy', labelKey: 'page.tabs.pharmacy', views: ['pharmacy'] },
];

export function InventoryHeader({
  activeView,
  canManage,
  showPharmacy,
  onViewChange,
  onNewEntry,
  onNewAdjustment,
}: InventoryHeaderProps) {
  const { t } = useTranslation('inventory');
  const allowed = new Set(visibleInventoryViews({ canManage, showPharmacy }));
  const groups = INVENTORY_TAB_GROUPS.map(group => ({
    ...group,
    views: group.views.filter(view => allowed.has(view)),
  })).filter(group => group.views.length > 0);
  const activeGroup = groups.find(group => group.views.includes(activeView)) ?? groups[0];

  return (
    <div className="space-y-3">
      <div className="page-header-row">
        <h1 data-shell-title className="text-2xl font-bold text-secondary-900">
          {t('page.title')}
        </h1>

        <div className="page-header-actions">
          <div
            role="tablist"
            aria-label={t('page.title')}
            data-testid="inventory-tabs"
            className="segmented-control max-w-full flex-nowrap overflow-x-auto scrollbar-thin"
          >
            {groups.map(group => {
              const isSelected = activeGroup?.id === group.id;
              const defaultView = group.views[0]!;
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-testid={
                    group.id === 'pharmacy'
                      ? 'inventory-tab-pharmacy'
                      : `inventory-group-${group.id}`
                  }
                  className={cn(
                    'segmented-tab shrink-0 whitespace-nowrap',
                    isSelected ? 'segmented-tab-active' : ''
                  )}
                  onClick={() => {
                    if (!isSelected) onViewChange(defaultView);
                  }}
                >
                  {t(group.labelKey)}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="btn-secondary flex items-center gap-2"
            onClick={onNewEntry}
            disabled={!canManage}
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            {t('newEntry')}
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-2"
            onClick={onNewAdjustment}
            disabled={!canManage}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {t('newAdjustment')}
          </button>
        </div>
      </div>

      {activeGroup && activeGroup.views.length > 1 && (
        <div
          role="tablist"
          aria-label={t(activeGroup.labelKey)}
          data-testid="inventory-subtabs"
          className="flex flex-wrap items-center gap-1.5"
        >
          {activeGroup.views.map(view => {
            const isSelected = activeView === view;
            return (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-testid={`inventory-tab-${view}`}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  isSelected
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-line bg-surface text-secondary-700 hover:bg-surface-2'
                )}
                onClick={() => onViewChange(view)}
              >
                {t(viewKeys[view])}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
