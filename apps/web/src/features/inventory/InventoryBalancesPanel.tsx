import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { useToast } from '@/components/feedback/ToastProvider';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import type { InventoryBalanceListItem } from '@/types';
import {
  InventoryTransferModal,
  type InventoryTransferFormValues,
} from './InventoryTransferModal';
import { InventoryTransferHistory } from './InventoryTransferHistory';

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
 * Phase 2 "By Site" panel — per-site inventory balances plus the immediate
 * transfer mutation (DB-101 / API-101 read + DB-102 / API-102 write).
 *
 * Balances are seeded lazily from `products.stock` onto the primary site on
 * first read. Once rows exist they are authoritative — `transfers.create` is
 * the only write path wired up so far; future sale/purchase integrations
 * will mutate balances too.
 */
export function InventoryBalancesPanel({ sites, sitesLoading }: InventoryBalancesPanelProps) {
  const { t } = useTranslation(['inventory', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const activeSites = useMemo(
    () => sites.filter(site => site.isActive !== false),
    [sites]
  );
  const [selectedSiteId, setSelectedSiteId] = useState<string>(
    () => activeSites[0]?.id ?? ''
  );
  const [isTransferOpen, setIsTransferOpen] = useState(false);

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

  const createTransferMutation = useCriticalMutation('transfers.create', {
    onSuccess: async () => {
      await Promise.all([
        utils.inventory.listBalancesBySite.invalidate(),
        utils.transfers.list.invalidate(),
      ]);
      setIsTransferOpen(false);
      toast.success({ title: t('transferModal.success') });
    },
  });

  const columns = useMemo(() => buildBalanceColumns(t), [t]);
  const canTransfer = activeSites.length >= 2;

  const handleCloseTransferModal = useCallback(() => {
    setIsTransferOpen(false);
    createTransferMutation.reset();
  }, [createTransferMutation]);

  const handleSubmitTransfer = useCallback(
    async (values: InventoryTransferFormValues) => {
      await createTransferMutation.mutateAsync({
        fromSiteId: values.fromSiteId,
        toSiteId: values.toSiteId,
        items: [{ productId: values.productId, quantity: values.quantity }],
        notes: values.notes || undefined,
        defer: values.defer,
      });
    },
    [createTransferMutation]
  );

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
      <div className="card p-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <label className="block md:max-w-sm md:flex-1">
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

        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          disabled={!canTransfer}
          title={canTransfer ? undefined : t('balances.transferRequiresTwoSites')}
          onClick={() => setIsTransferOpen(true)}
        >
          <ArrowLeftRight className="h-4 w-4" />
          {t('balances.transferButton')}
        </button>
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
            message={translateServerError(
              balancesQuery.error,
              t,
              t('balances.error')
            )}
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

      <InventoryTransferHistory />

      <InventoryTransferModal
        // Remount on open/close so form state resets without a useEffect
        // that would fire twice under StrictMode.
        key={isTransferOpen ? 'open' : 'closed'}
        isOpen={isTransferOpen}
        sites={activeSites}
        sourceBalances={items}
        initialFromSiteId={effectiveSiteId}
        isSaving={createTransferMutation.isPending}
        error={
          createTransferMutation.error
            ? translateServerError(
                createTransferMutation.error,
                t,
                t('errors:server.unknown')
              )
            : null
        }
        onClose={handleCloseTransferModal}
        onSubmit={handleSubmitTransfer}
      />
    </div>
  );
}
