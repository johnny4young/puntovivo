import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { trpc } from '@/lib/trpc';
import { getErrorMessage } from '@/lib/utils';
import type { InventoryBalanceListItem } from '@/types';

export interface InventoryBalancesPanelSite {
  id: string;
  name: string;
  isActive: boolean | null;
}

interface InventoryBalancesPanelProps {
  sites: InventoryBalancesPanelSite[];
  sitesLoading: boolean;
}

function buildBalanceColumns(
  t: (key: string) => string
): ColumnDef<InventoryBalanceListItem>[] {
  return [
    {
      accessorKey: 'productName',
      header: () => t('balances.columns.product'),
    },
    {
      accessorKey: 'productSku',
      header: () => t('balances.columns.sku'),
    },
    {
      accessorKey: 'onHand',
      header: () => t('balances.columns.onHand'),
      cell: ({ row }) => row.original.onHand.toLocaleString(),
    },
    {
      accessorKey: 'reserved',
      header: () => t('balances.columns.reserved'),
      cell: ({ row }) => row.original.reserved.toLocaleString(),
    },
    {
      accessorKey: 'available',
      header: () => t('balances.columns.available'),
      cell: ({ row }) => row.original.available.toLocaleString(),
    },
  ];
}

/**
 * Phase 2 DB-101 / API-101 — read-only panel showing on-hand balances per
 * site. Until transfer writes land this mirrors the tenant-wide product stock
 * seeded onto the primary site; other sites start at zero.
 */
export function InventoryBalancesPanel({ sites, sitesLoading }: InventoryBalancesPanelProps) {
  const { t } = useTranslation('inventory');
  const activeSites = useMemo(
    () => sites.filter(site => site.isActive !== false),
    [sites]
  );
  const [selectedSiteId, setSelectedSiteId] = useState<string>(
    () => activeSites[0]?.id ?? ''
  );

  // If `sites` changes and the current selection is no longer valid, fall back.
  const effectiveSiteId = useMemo(() => {
    if (selectedSiteId && activeSites.some(site => site.id === selectedSiteId)) {
      return selectedSiteId;
    }
    return activeSites[0]?.id ?? '';
  }, [selectedSiteId, activeSites]);

  const balancesQuery = trpc.inventory.listBalancesBySite.useQuery(
    { siteId: effectiveSiteId },
    { enabled: effectiveSiteId.length > 0 }
  );

  const columns = useMemo(() => buildBalanceColumns(t), [t]);

  if (sitesLoading) {
    return (
      <div className="card p-6">
        <TableLoadingState message={t('balances.loadingSites')} rowCount={4} />
      </div>
    );
  }

  if (activeSites.length === 0) {
    return (
      <div className="card p-6">
        <p className="text-sm text-secondary-600">{t('balances.noSites')}</p>
      </div>
    );
  }

  const items = balancesQuery.data?.items ?? [];
  const summary = balancesQuery.data?.summary ?? {
    totalOnHand: 0,
    totalReserved: 0,
    totalAvailable: 0,
    lowStockCount: 0,
    productsTracked: 0,
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <label className="block md:max-w-sm">
          <span className="label">{t('balances.siteSelector')}</span>
          <select
            className="input mt-1"
            value={effectiveSiteId}
            onChange={event => setSelectedSiteId(event.target.value)}
          >
            {activeSites.map(site => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-4">
          <p className="text-sm text-secondary-500">{t('balances.summary.onHand')}</p>
          <p className="mt-1 text-2xl font-semibold text-secondary-900">
            {summary.totalOnHand.toLocaleString()}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">{t('balances.summary.available')}</p>
          <p className="mt-1 text-2xl font-semibold text-secondary-900">
            {summary.totalAvailable.toLocaleString()}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">{t('balances.summary.lowStock')}</p>
          <p className="mt-1 text-2xl font-semibold text-secondary-900">
            {summary.lowStockCount.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="card p-6">
        {balancesQuery.isLoading && (
          <TableLoadingState message={t('balances.loading')} rowCount={6} />
        )}
        {balancesQuery.error && (
          <TableErrorState
            title={t('balances.error')}
            message={getErrorMessage(balancesQuery.error, t('balances.error'))}
            onRetry={() => {
              void balancesQuery.refetch();
            }}
          />
        )}
        {!balancesQuery.isLoading && !balancesQuery.error && (
          <DataTable
            columns={columns}
            data={items}
            searchKey="productName"
            searchPlaceholder={t('balances.search')}
            pageSize={10}
          />
        )}
      </div>

      <p className="surface-panel-muted text-sm text-secondary-600">
        {t('balances.projectionNote')}
      </p>
    </div>
  );
}
