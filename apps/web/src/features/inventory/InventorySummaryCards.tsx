// Inventory screen summary KPI cards (total units / value / low stock / recent
// flow), extracted from InventoryPage.tsx (ENG-178 slice 33).

import { useTranslation } from 'react-i18next';
import { ArrowDownCircle, Boxes, ClipboardList, RefreshCw } from 'lucide-react';
import { KpiTile } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';

interface InventorySummaryProps {
  isLoading: boolean;
  totalUnits: number;
  totalValue: number;
  lowStockCount: number;
  recentInbound: number;
  recentOutbound: number;
  entriesCount: number;
  entriesLoading: boolean;
}

export function InventorySummaryCards({
  isLoading,
  totalUnits,
  totalValue,
  lowStockCount,
  recentInbound,
  recentOutbound,
  entriesCount,
  entriesLoading,
}: InventorySummaryProps) {
  const { t } = useTranslation('inventory');
  // Rediseño FASE 2 — receta KpiTile compartida (igual que Dashboard / POS):
  // glifo tonal, microetiqueta, cifra alineada. `danger` para stock bajo,
  // `mono` para el valor de inventario (dinero). La rejilla replica la del
  // Dashboard para que los cuatro grupos de KPIs se lean idénticos.
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      <KpiTile
        icon={Boxes}
        tone="primary"
        label={t('stats.totalUnits')}
        value={isLoading ? '—' : totalUnits.toLocaleString()}
      />
      <KpiTile
        icon={ArrowDownCircle}
        tone="success"
        mono
        label={t('stats.inventoryValue')}
        value={isLoading ? '—' : formatCurrency(totalValue)}
      />
      <KpiTile
        icon={RefreshCw}
        tone="danger"
        label={t('stats.lowStockItems')}
        value={isLoading ? '—' : lowStockCount.toLocaleString()}
      />
      <KpiTile
        icon={ClipboardList}
        tone="ink"
        label={t('stats.recentFlow')}
        value={`+${recentInbound} / -${recentOutbound}`}
        context={
          entriesLoading
            ? t('entries.loadingShort')
            : t('stats.recentFlowDetail', { count: entriesCount })
        }
      />
    </div>
  );
}
