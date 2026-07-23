import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Boxes, CheckCircle2, MapPin, Package } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { KpiTile, Button } from '@/components/ui';
import { useToast } from '@/components/feedback/ToastProvider';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { cn } from '@/lib/utils';
import type { InventoryBalanceListItem } from '@/types';
import type { InventoryTransferFormValues } from './InventoryTransferModal';
import { InventoryTransferHistory } from './InventoryTransferHistory';

// exact serial selection makes the transfer form materially heavier.
// Keep it out of the already budget-sensitive inventory route until requested.
const InventoryTransferModal = lazy(() =>
  import('./InventoryTransferModal').then(module => ({
    default: module.InventoryTransferModal,
  }))
);
export interface InventoryBalancesPanelSite {
  id: string;
  name: string;
  isActive: boolean | null;
}
interface InventoryBalancesPanelProps {
  sites: InventoryBalancesPanelSite[];
  sitesLoading: boolean;
}
function buildBalanceColumns(t: (key: string) => string): ColumnDef<InventoryBalanceListItem>[] {
  return [
    {
      accessorKey: 'productName',
      header: () => t('balances.columns.product'),
      size: 280,
      // celda ancla (.pv-table .prod/.pic/.pname/.sku):
      // glifo tonal + nombre fuerte + SKU mono debajo.
      cell: ({ row }) => (
        <div className="prod">
          <span className="pic">
            <Package className="h-4 w-4" />
          </span>
          <div>
            <p className="pname">{row.original.productName}</p>
            <p className="sku">{row.original.productSku}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'onHand',
      header: () => t('balances.columns.onHand'),
      size: 130,
      meta: {
        cellClassName: 'num',
        headerClassName: 'num',
      },
      cell: ({ row }) => row.original.onHand.toLocaleString(),
    },
    {
      accessorKey: 'reserved',
      header: () => t('balances.columns.reserved'),
      size: 130,
      meta: {
        cellClassName: 'num',
        headerClassName: 'num',
      },
      cell: ({ row }) => row.original.reserved.toLocaleString(),
    },
    {
      accessorKey: 'available',
      header: () => t('balances.columns.available'),
      size: 130,
      meta: {
        cellClassName: 'num',
        headerClassName: 'num',
      },
      cell: ({ row }) => (
        <span className={cn(row.original.isLowStock && 'text-danger-700')}>
          {row.original.available.toLocaleString()}
        </span>
      ),
    },
  ];
}

/**
 * "By Site" panel — per-site inventory balances plus the immediate
 * transfer mutation (site-scoped balance read and atomic transfer write).
 *
 * Balances are seeded lazily from `products.stock` onto the primary site on
 * first read. Once rows exist they are authoritative and every inventory
 * lifecycle path updates them directly.
 */
export function InventoryBalancesPanel({ sites, sitesLoading }: InventoryBalancesPanelProps) {
  const { t } = useTranslation(['inventory', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const activeSites = useMemo(() => sites.filter(site => site.isActive !== false), [sites]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>(() => activeSites[0]?.id ?? '');
  const [isTransferOpen, setIsTransferOpen] = useState(false);

  // If `sites` changes and the current selection is no longer valid, fall back.
  const effectiveSiteId = useMemo(() => {
    if (selectedSiteId && activeSites.some(site => site.id === selectedSiteId)) {
      return selectedSiteId;
    }
    return activeSites[0]?.id ?? '';
  }, [selectedSiteId, activeSites]);
  const balancesQuery = trpc.inventory.listBalancesBySite.useQuery(
    {
      siteId: effectiveSiteId,
    },
    {
      enabled: effectiveSiteId.length > 0,
    }
  );
  const createTransferMutation = useCriticalMutation('transfers.create', {
    onSuccess: async () => {
      await Promise.all([
        utils.inventory.listBalancesBySite.invalidate(),
        utils.transfers.list.invalidate(),
        utils.productSerials.list.invalidate(),
        utils.productSerials.lookup.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      setIsTransferOpen(false);
      toast.success({
        title: t('transferModal.success'),
      });
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
        items: [
          {
            productId: values.productId,
            quantity: values.quantity,
            ...(values.serialIds
              ? {
                  serialIds: values.serialIds,
                }
              : {}),
          },
        ],
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
    // estado vacío único (.pv-empty) cuando no hay sedes
    // activas; conserva el mensaje guía como descripción.
    return (
      <div className="card p-6">
        <EmptyState
          icon={MapPin}
          title={t('balances.noSitesTitle')}
          description={t('balances.noSites')}
        />
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
      {/* selector de sede con receta de formulario
          (.pv-field/.pv-input) y Button tipado para el traslado. */}
      <div className="card p-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="pv-field md:max-w-sm md:flex-1">
          <label htmlFor="inventory-balances-site" className="label">
            {t('balances.siteSelector')}
          </label>
          <select
            id="inventory-balances-site"
            className="pv-input"
            value={effectiveSiteId}
            onChange={event => setSelectedSiteId(event.target.value)}
          >
            {activeSites.map(site => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>

        <Button
          type="button"
          className="flex items-center gap-2"
          disabled={!canTransfer}
          title={canTransfer ? undefined : t('balances.transferRequiresTwoSites')}
          onClick={() => setIsTransferOpen(true)}
          variant="primary"
        >
          <ArrowLeftRight className="h-4 w-4" />
          {t('balances.transferButton')}
        </Button>
      </div>

      {/* KPIs por sede con la receta única (.pv-kpi). */}
      <div className="pv-kpis grid gap-4 md:grid-cols-3">
        <KpiTile
          icon={Boxes}
          tone="primary"
          mono
          label={t('balances.summary.onHand')}
          value={summary.totalOnHand.toLocaleString()}
        />
        <KpiTile
          icon={CheckCircle2}
          tone="success"
          mono
          label={t('balances.summary.available')}
          value={summary.totalAvailable.toLocaleString()}
        />
        <KpiTile
          icon={Package}
          tone={summary.lowStockCount > 0 ? 'danger' : 'ink'}
          label={t('balances.summary.lowStock')}
          value={summary.lowStockCount.toLocaleString()}
        />
      </div>

      <div className="card p-6">
        {balancesQuery.isLoading && (
          <TableLoadingState message={t('balances.loading')} rowCount={6} />
        )}
        {balancesQuery.error && (
          <TableErrorState
            title={t('balances.error')}
            message={translateServerError(balancesQuery.error, t, t('balances.error'))}
            onRetry={() => {
              void balancesQuery.refetch();
            }}
          />
        )}
        {!balancesQuery.isLoading && !balancesQuery.error && (
          <DataTable
            variant="dense"
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

      {isTransferOpen && (
        <Suspense fallback={null}>
          <InventoryTransferModal
            key="open"
            isOpen
            sites={activeSites}
            sourceBalances={items}
            initialFromSiteId={effectiveSiteId}
            isSaving={createTransferMutation.isPending}
            error={
              createTransferMutation.error
                ? translateServerError(createTransferMutation.error, t, t('errors:server.unknown'))
                : null
            }
            onClose={handleCloseTransferModal}
            onSubmit={handleSubmitTransfer}
          />
        </Suspense>
      )}
    </div>
  );
}
