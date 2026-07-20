// Inventory screen data panel: the movements / stock / entries DataTables with
// their loading / error / export states + the stock-filter slot, extracted from
// InventoryPage.tsx ( slice 33).

import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { TableExportActions } from '@/components/tables/TableExportActions';
import { getStockColumns } from '@/features/inventory/inventoryStockColumns';
import { getMovementColumns } from '@/features/inventory/inventoryMovementColumns';
import { getEntryColumns } from '@/features/inventory/inventoryEntryColumns';
import {
  inventoryEntryExportColumns,
  inventoryMovementExportColumns,
  inventoryStockExportColumns,
} from '@/features/inventory/inventoryExport';
import { type InventoryView } from '@/features/inventory/inventoryViews';
import type { InitialInventoryEntry, InventoryMovement, InventoryStockItem } from '@/types';

interface InventoryDataPanelProps {
  activeView: InventoryView;
  movementsLoading: boolean;
  movementsError: string | null;
  onRetryMovements: () => void;
  stockLoading: boolean;
  stockError: string | null;
  onRetryStock: () => void;
  entriesLoading: boolean;
  entriesError: string | null;
  onRetryEntries: () => void;
  movements: InventoryMovement[];
  stockItems: InventoryStockItem[];
  entries: InitialInventoryEntry[];
  canManage: boolean;
  onAdjust: (product: InventoryStockItem) => void;
  onViewStockDetails: (product: InventoryStockItem) => void;
  onViewMovementDetails: (movement: InventoryMovement) => void;
  onViewEntryDetails: (entry: InitialInventoryEntry) => void;
  stockFilters: ReactNode;
}

export function InventoryDataPanel({
  activeView,
  movementsLoading,
  movementsError,
  onRetryMovements,
  stockLoading,
  stockError,
  onRetryStock,
  entriesLoading,
  entriesError,
  onRetryEntries,
  movements,
  stockItems,
  entries,
  canManage,
  onAdjust,
  onViewStockDetails,
  onViewMovementDetails,
  onViewEntryDetails,
  stockFilters,
}: InventoryDataPanelProps) {
  const { t } = useTranslation('inventory');
  return (
    <div className="card p-6">
      {activeView === 'movements' && (
        <>
          {movementsLoading && <TableLoadingState message={t('movements.loading')} rowCount={8} />}
          {movementsError && (
            <TableErrorState
              title={t('movements.error')}
              message={movementsError}
              onRetry={onRetryMovements}
            />
          )}
          {!movementsLoading && !movementsError && (
            <div className="space-y-4">
              <TableExportActions
                key="inventory-movements-export"
                data={movements}
                columns={inventoryMovementExportColumns}
                filename="inventory-movements"
                title={t('movements.exportTitle')}
              />
              <DataTable
                variant="dense"
                columns={getMovementColumns(onViewMovementDetails)}
                data={movements}
                searchKey="productName"
                searchPlaceholder={t('movements.search')}
                pageSize={10}
              />
            </div>
          )}
        </>
      )}

      {activeView === 'stock' && (
        <div className="space-y-4">
          {/* Rediseño §10 — los filtros propios de esta vista (categoría +
              "solo stock bajo") viven dentro del card de stock, separados por
              una línea, en vez de flotar como un card suelto encima. */}
          <div className="border-b border-line/60 pb-4">{stockFilters}</div>
          {stockLoading && <TableLoadingState message={t('stock.loading')} rowCount={8} />}
          {stockError && (
            <TableErrorState title={t('stock.error')} message={stockError} onRetry={onRetryStock} />
          )}
          {!stockLoading && !stockError && (
            <div className="space-y-4">
              <TableExportActions
                key="inventory-stock-export"
                data={stockItems}
                columns={inventoryStockExportColumns}
                filename="inventory-stock"
                title={t('stock.exportTitle')}
              />
              <DataTable
                variant="dense"
                columns={getStockColumns(onViewStockDetails, onAdjust, canManage)}
                data={stockItems}
                searchKey="name"
                searchPlaceholder={t('stock.search')}
                pageSize={10}
              />
            </div>
          )}
        </div>
      )}

      {activeView === 'entries' && (
        <>
          {entriesLoading && <TableLoadingState message={t('entries.loading')} rowCount={8} />}
          {entriesError && (
            <TableErrorState
              title={t('entries.error')}
              message={entriesError}
              onRetry={onRetryEntries}
            />
          )}
          {!entriesLoading && !entriesError && (
            <div className="space-y-4">
              <TableExportActions
                key="inventory-entries-export"
                data={entries}
                columns={inventoryEntryExportColumns}
                filename="inventory-entries"
                title={t('entries.exportTitle')}
              />
              <DataTable
                variant="dense"
                columns={getEntryColumns(onViewEntryDetails)}
                data={entries}
                searchKey="productName"
                searchPlaceholder={t('entries.search')}
                pageSize={10}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
