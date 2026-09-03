import { useMemo, useState } from 'react';
import { AlertOctagon, ChevronRight, CircleOff, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { Badge, Button } from '@/components/ui';
import { TablePagination } from '@/components/tables/TablePagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatCalendarDay, formatDateTime } from '@/lib/utils';
import type { Product, Provider } from '@/types';

type RecallScope = 'product' | 'lot' | 'provider' | 'sanitary_registration';
type RecallStatusFilter = 'all' | 'active' | 'closed';

const RECALLS_PER_PAGE = 25;
const RECALL_DETAIL_PER_PAGE = 25;

function recallTargetLabel(recall: {
  scopeType: RecallScope;
  productId?: string | null;
  productName?: string | null;
  lotId?: string | null;
  lotNumber?: string | null;
  providerId?: string | null;
  providerName?: string | null;
  sanitaryRegistration?: string | null;
}): string {
  if (recall.scopeType === 'product') return recall.productName ?? recall.productId ?? '—';
  if (recall.scopeType === 'lot') return recall.lotNumber ?? recall.lotId ?? '—';
  if (recall.scopeType === 'provider') return recall.providerName ?? recall.providerId ?? '—';
  return recall.sanitaryRegistration ?? '—';
}

export function PharmacyRecallPanel() {
  const { t } = useTranslation(['pharmacy', 'pharmacyErrors', 'errors']);
  const { user } = useAuth();
  const { currentSite } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [scopeType, setScopeType] = useState<RecallScope>('product');
  const [productId, setProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductOption, setSelectedProductOption] = useState<Product | null>(null);
  const [lotSelection, setLotSelection] = useState({ id: '', productId: '', siteId: '' });
  const [providerId, setProviderId] = useState('');
  const [providerSearch, setProviderSearch] = useState('');
  const [selectedProviderOption, setSelectedProviderOption] = useState<Provider | null>(null);
  const [sanitaryRegistration, setSanitaryRegistration] = useState('');
  const [reason, setReason] = useState('');
  const [statusFilter, setStatusFilter] = useState<RecallStatusFilter>('active');
  const [recallPage, setRecallPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [lotPage, setLotPage] = useState(1);
  const [salesPage, setSalesPage] = useState(1);
  const [closeReason, setCloseReason] = useState('');

  const lotId =
    lotSelection.productId === productId && lotSelection.siteId === (currentSite?.id ?? '')
      ? lotSelection.id
      : '';

  const debouncedProductSearch = useDebouncedValue(productSearch.trim(), 200);
  const debouncedProviderSearch = useDebouncedValue(providerSearch.trim(), 200);
  const productsListQuery = trpc.products.list.useQuery(
    {
      page: 1,
      perPage: 50,
      pharmacyOnly: true,
    },
    {
      enabled: (scopeType === 'product' || scopeType === 'lot') && !debouncedProductSearch,
    }
  );
  const productsSearchQuery = trpc.products.search.useQuery(
    {
      q: debouncedProductSearch || '__disabled__',
      limit: 50,
      tracksStock: true,
      pharmacyOnly: true,
    },
    {
      enabled: (scopeType === 'product' || scopeType === 'lot') && !!debouncedProductSearch,
    }
  );
  const productsQuery = debouncedProductSearch ? productsSearchQuery : productsListQuery;
  const providersQuery = trpc.providers.list.useQuery(
    {
      page: 1,
      perPage: 50,
      search: debouncedProviderSearch || undefined,
    },
    { enabled: scopeType === 'provider' }
  );
  const recallsQuery = trpc.pharmacy.listRecalls.useQuery({
    page: recallPage,
    perPage: RECALLS_PER_PAGE,
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
  });
  const pharmacyProducts = useMemo(() => {
    const matches = ((productsQuery.data?.items ?? []) as Product[]).filter(
      product => product.pharmacy && product.tracksStock
    );
    if (
      selectedProductOption &&
      selectedProductOption.id === productId &&
      !matches.some(product => product.id === selectedProductOption.id)
    ) {
      return [selectedProductOption, ...matches];
    }
    return matches;
  }, [productId, productsQuery.data?.items, selectedProductOption]);
  const providers = useMemo(() => {
    const matches = (providersQuery.data?.items ?? []) as Provider[];
    if (
      selectedProviderOption &&
      selectedProviderOption.id === providerId &&
      !matches.some(provider => provider.id === selectedProviderOption.id)
    ) {
      return [selectedProviderOption, ...matches];
    }
    return matches;
  }, [providerId, providersQuery.data?.items, selectedProviderOption]);
  const lotsQuery = trpc.inventoryLots.list.useQuery(
    { siteId: currentSite?.id ?? '', productId, activeOnly: false },
    { enabled: scopeType === 'lot' && !!currentSite?.id && !!productId }
  );
  const detailQuery = trpc.pharmacy.getRecall.useQuery(
    {
      id: detailId ?? '',
      page: lotPage,
      perPage: RECALL_DETAIL_PER_PAGE,
    },
    { enabled: detailId !== null }
  );
  const affectedSalesQuery = trpc.pharmacy.affectedSales.useQuery(
    {
      id: detailId ?? '',
      page: salesPage,
      perPage: RECALL_DETAIL_PER_PAGE,
    },
    { enabled: detailId !== null }
  );

  function openRecallDetail(id: string) {
    setDetailId(id);
    setCloseReason('');
    setLotPage(1);
    setSalesPage(1);
  }

  function closeRecallDetail() {
    setDetailId(null);
    setCloseReason('');
    setLotPage(1);
    setSalesPage(1);
  }

  function changeScope(nextScope: RecallScope) {
    setScopeType(nextScope);
    setProductId('');
    setSelectedProductOption(null);
    setLotSelection({ id: '', productId: '', siteId: '' });
    setProviderId('');
    setSelectedProviderOption(null);
    setSanitaryRegistration('');
    setReason('');
  }

  async function invalidateRecalls() {
    await Promise.all([
      utils.pharmacy.listRecalls.invalidate(),
      utils.pharmacy.getRecall.invalidate(),
      utils.pharmacy.affectedSales.invalidate(),
      utils.inventoryLots.list.invalidate(),
      utils.inventoryLots.expiring.invalidate(),
      utils.inventory.listStock.invalidate(),
      utils.inventory.listBalancesBySite.invalidate(),
      utils.products.list.invalidate(),
      utils.products.search.invalidate(),
    ]);
  }

  const createRecall = useCriticalMutation('pharmacy.createRecall', {
    onSuccess: async data => {
      setRecallPage(1);
      await invalidateRecalls();
      setReason('');
      openRecallDetail(data.id);
      toast.success({
        title: t('pharmacy:recalls.toast.created'),
        description: t('pharmacy:recalls.toast.lotsBlocked', { count: data.lotCount }),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:recalls.toast.error' }),
  });
  const closeRecall = useCriticalMutation('pharmacy.closeRecall', {
    onSuccess: async () => {
      await invalidateRecalls();
      setCloseReason('');
      toast.success({
        title: t('pharmacy:recalls.toast.closed'),
        description: t('pharmacy:recalls.toast.releaseRequired'),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:recalls.toast.error' }),
  });

  const trimmedReason = reason.trim();
  const targetSelected =
    (scopeType === 'product' && !!productId) ||
    (scopeType === 'lot' && !!lotId) ||
    (scopeType === 'provider' && !!providerId) ||
    (scopeType === 'sanitary_registration' && sanitaryRegistration.trim().length > 0);
  const recalls = recallsQuery.data?.items ?? [];
  const recallTotal = recallsQuery.data?.total ?? recalls.length;
  const recallPageCount = Math.ceil(recallTotal / RECALLS_PER_PAGE);
  const displayRecallPage = recallsQuery.data?.page ?? recallPage;
  const detail = detailQuery.data;
  const lotTotal = detail?.lotsTotal ?? detail?.lots.length ?? 0;
  const lotPageCount = Math.ceil(lotTotal / RECALL_DETAIL_PER_PAGE);
  const displayLotPage = detail?.lotsPage ?? lotPage;
  const affectedSales = affectedSalesQuery.data?.items ?? [];
  const affectedSalesTotal = affectedSalesQuery.data?.total ?? affectedSales.length;
  const salesPageCount = Math.ceil(affectedSalesTotal / RECALL_DETAIL_PER_PAGE);
  const displaySalesPage = affectedSalesQuery.data?.page ?? salesPage;

  function submitRecall() {
    if (!targetSelected || trimmedReason.length < 3) return;
    createRecall.mutate({
      scopeType,
      ...(scopeType === 'product' ? { productId } : {}),
      ...(scopeType === 'lot' ? { lotId } : {}),
      ...(scopeType === 'provider' ? { providerId } : {}),
      ...(scopeType === 'sanitary_registration'
        ? { sanitaryRegistration: sanitaryRegistration.trim() }
        : {}),
      reason: trimmedReason,
    });
  }

  if (recallsQuery.error) {
    return (
      <QueryErrorState
        title={t('pharmacy:recalls.loadError')}
        message={translateServerError(recallsQuery.error, t, t('errors:server.unknown'))}
        onRetry={() => void recallsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="card p-5" aria-labelledby="pharmacy-recall-create-heading">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger-50 text-danger-700">
            <AlertOctagon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 id="pharmacy-recall-create-heading" className="font-semibold text-secondary-950">
              {t('pharmacy:recalls.createTitle')}
            </h3>
            <p className="mt-1 text-sm text-secondary-600">
              {t('pharmacy:recalls.createDescription')}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="pv-field">
            <label className="label" htmlFor="pharmacy-recall-scope">
              {t('pharmacy:recalls.scope')}
            </label>
            <select
              id="pharmacy-recall-scope"
              className="pv-input"
              value={scopeType}
              onChange={event => changeScope(event.target.value as RecallScope)}
            >
              <option value="product">{t('pharmacy:recalls.scopeOptions.product')}</option>
              <option value="lot">{t('pharmacy:recalls.scopeOptions.lot')}</option>
              <option value="provider">{t('pharmacy:recalls.scopeOptions.provider')}</option>
              <option value="sanitary_registration">
                {t('pharmacy:recalls.scopeOptions.sanitaryRegistration')}
              </option>
            </select>
          </div>

          {(scopeType === 'product' || scopeType === 'lot') && (
            <div className="pv-field">
              <label className="label" htmlFor="pharmacy-recall-product-search">
                {t('pharmacy:common.searchMedicine')}
              </label>
              <input
                id="pharmacy-recall-product-search"
                className="pv-input"
                type="search"
                value={productSearch}
                placeholder={t('pharmacy:common.searchMedicinePlaceholder')}
                onChange={event => setProductSearch(event.target.value)}
              />
            </div>
          )}

          {(scopeType === 'product' || scopeType === 'lot') && (
            <div className="pv-field">
              <label className="label" htmlFor="pharmacy-recall-product">
                {t('pharmacy:recalls.product')}
              </label>
              <select
                id="pharmacy-recall-product"
                className="pv-input"
                value={productId}
                disabled={productsQuery.isLoading}
                onChange={event => {
                  const nextProductId = event.target.value;
                  setProductId(nextProductId);
                  setSelectedProductOption(
                    pharmacyProducts.find(product => product.id === nextProductId) ?? null
                  );
                  setLotSelection({
                    id: '',
                    productId: nextProductId,
                    siteId: currentSite?.id ?? '',
                  });
                  setReason('');
                }}
              >
                <option value="">{t('pharmacy:recalls.productPlaceholder')}</option>
                {pharmacyProducts.map(product => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {product.sku}
                    {product.isActive === false ? ` · ${t('pharmacy:common.inactive')}` : ''}
                  </option>
                ))}
              </select>
              {productsQuery.error && (
                <div
                  className="mt-1 flex items-center justify-between gap-2 text-xs text-danger-700"
                  role="alert"
                >
                  <span>
                    {translateServerError(
                      productsQuery.error,
                      t,
                      t('pharmacy:recalls.medicineLoadError')
                    )}
                  </span>
                  <button
                    className="link"
                    type="button"
                    onClick={() => void productsQuery.refetch()}
                  >
                    {t('pharmacy:common.retry')}
                  </button>
                </div>
              )}
              {!productsQuery.isLoading &&
                !productsQuery.error &&
                pharmacyProducts.length === 0 && (
                  <p className="mt-1 text-xs text-secondary-500">
                    {t('pharmacy:recalls.noMedicines')}
                  </p>
                )}
            </div>
          )}

          {scopeType === 'lot' && (
            <div className="pv-field">
              <label className="label" htmlFor="pharmacy-recall-lot">
                {t('pharmacy:recalls.lot')}
              </label>
              <select
                id="pharmacy-recall-lot"
                className="pv-input"
                value={lotId}
                disabled={!currentSite || !productId || lotsQuery.isLoading}
                onChange={event => {
                  setLotSelection({
                    id: event.target.value,
                    productId,
                    siteId: currentSite?.id ?? '',
                  });
                  setReason('');
                }}
              >
                <option value="">
                  {currentSite
                    ? t('pharmacy:recalls.lotPlaceholder', { site: currentSite.name })
                    : t('pharmacy:lots.siteRequiredTitle')}
                </option>
                {(lotsQuery.data?.items ?? []).map(lot => (
                  <option key={lot.id} value={lot.id}>
                    {lot.lotNumber} · {t(`pharmacy:common.lotStatus.${lot.status}`)} · {lot.onHand}
                  </option>
                ))}
              </select>
              {lotsQuery.error && (
                <div
                  className="mt-1 flex items-center justify-between gap-2 text-xs text-danger-700"
                  role="alert"
                >
                  <span>
                    {translateServerError(lotsQuery.error, t, t('pharmacy:recalls.lotLoadError'))}
                  </span>
                  <button className="link" type="button" onClick={() => void lotsQuery.refetch()}>
                    {t('pharmacy:common.retry')}
                  </button>
                </div>
              )}
              {!lotsQuery.isLoading &&
                productId &&
                !lotsQuery.error &&
                (lotsQuery.data?.items ?? []).length === 0 && (
                  <p className="mt-1 text-xs text-secondary-500">{t('pharmacy:recalls.noLots')}</p>
                )}
            </div>
          )}

          {scopeType === 'provider' && (
            <div className="pv-field">
              <label className="label" htmlFor="pharmacy-recall-provider-search">
                {t('pharmacy:common.searchProvider')}
              </label>
              <input
                id="pharmacy-recall-provider-search"
                className="pv-input"
                type="search"
                value={providerSearch}
                placeholder={t('pharmacy:common.searchProviderPlaceholder')}
                onChange={event => setProviderSearch(event.target.value)}
              />
            </div>
          )}

          {scopeType === 'provider' && (
            <div className="pv-field">
              <label className="label" htmlFor="pharmacy-recall-provider">
                {t('pharmacy:recalls.provider')}
              </label>
              <select
                id="pharmacy-recall-provider"
                className="pv-input"
                value={providerId}
                disabled={providersQuery.isLoading}
                onChange={event => {
                  const nextProviderId = event.target.value;
                  setProviderId(nextProviderId);
                  setSelectedProviderOption(
                    providers.find(provider => provider.id === nextProviderId) ?? null
                  );
                  setReason('');
                }}
              >
                <option value="">{t('pharmacy:recalls.providerPlaceholder')}</option>
                {providers.map(provider => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                    {provider.isActive === false ? ` · ${t('pharmacy:common.inactive')}` : ''}
                  </option>
                ))}
              </select>
              {providersQuery.error && (
                <div
                  className="mt-1 flex items-center justify-between gap-2 text-xs text-danger-700"
                  role="alert"
                >
                  <span>
                    {translateServerError(
                      providersQuery.error,
                      t,
                      t('pharmacy:recalls.providerLoadError')
                    )}
                  </span>
                  <button
                    className="link"
                    type="button"
                    onClick={() => void providersQuery.refetch()}
                  >
                    {t('pharmacy:common.retry')}
                  </button>
                </div>
              )}
              {!providersQuery.isLoading && !providersQuery.error && providers.length === 0 && (
                <p className="mt-1 text-xs text-secondary-500">
                  {t('pharmacy:recalls.noProviders')}
                </p>
              )}
            </div>
          )}

          {scopeType === 'sanitary_registration' && (
            <div className="pv-field">
              <label className="label" htmlFor="pharmacy-recall-registration">
                {t('pharmacy:recalls.sanitaryRegistration')}
              </label>
              <input
                id="pharmacy-recall-registration"
                className="pv-input"
                value={sanitaryRegistration}
                maxLength={160}
                autoComplete="off"
                onChange={event => {
                  setSanitaryRegistration(event.target.value);
                  setReason('');
                }}
              />
            </div>
          )}

          <div className="pv-field lg:col-span-2">
            <label className="label" htmlFor="pharmacy-recall-reason">
              {t('pharmacy:common.reason')}
            </label>
            <textarea
              id="pharmacy-recall-reason"
              className="pv-input min-h-24"
              value={reason}
              maxLength={500}
              placeholder={t('pharmacy:recalls.reasonPlaceholder')}
              onChange={event => setReason(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            variant="danger"
            disabled={!targetSelected || trimmedReason.length < 3 || createRecall.isPending}
            onClick={submitRecall}
          >
            <CircleOff className="h-4 w-4" aria-hidden="true" />
            {t('pharmacy:recalls.createAction')}
          </Button>
        </div>
      </section>

      <section className="card p-5" aria-labelledby="pharmacy-recall-list-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="pharmacy-recall-list-heading" className="font-semibold text-secondary-950">
              {t('pharmacy:recalls.listTitle')}
            </h3>
            <p className="mt-1 text-sm text-secondary-600">
              {t('pharmacy:recalls.listDescription')}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="pv-field min-w-40">
              <label className="label" htmlFor="pharmacy-recall-status-filter">
                {t('pharmacy:recalls.statusFilter')}
              </label>
              <select
                id="pharmacy-recall-status-filter"
                className="pv-input"
                value={statusFilter}
                onChange={event => {
                  setStatusFilter(event.target.value as RecallStatusFilter);
                  setRecallPage(1);
                  closeRecallDetail();
                }}
              >
                <option value="active">{t('pharmacy:common.recallStatus.active')}</option>
                <option value="closed">{t('pharmacy:common.recallStatus.closed')}</option>
                <option value="all">{t('pharmacy:common.allStatuses')}</option>
              </select>
            </div>
            <Button variant="outline" size="compact" onClick={() => void recallsQuery.refetch()}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('pharmacy:common.refresh')}
            </Button>
          </div>
        </div>

        {recallsQuery.isLoading && (
          <p className="mt-5 text-sm text-secondary-600" role="status">
            {t('pharmacy:common.loading')}
          </p>
        )}
        {!recallsQuery.isLoading && recalls.length === 0 && (
          <EmptyState
            className="mt-5"
            icon={AlertOctagon}
            title={t('pharmacy:recalls.emptyTitle')}
            description={t('pharmacy:recalls.emptyDescription')}
          />
        )}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {recalls.map(recall => (
            <button
              key={recall.id}
              type="button"
              className="rounded-2xl border border-secondary-200 p-4 text-left transition hover:border-primary-300 hover:bg-primary-50/30"
              onClick={() => openRecallDetail(recall.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-secondary-950">
                    {t(
                      `pharmacy:recalls.scopeOptions.${recall.scopeType === 'sanitary_registration' ? 'sanitaryRegistration' : recall.scopeType}`
                    )}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-secondary-600">{recall.reason}</p>
                  <p className="mt-1 text-xs font-medium text-secondary-700">
                    {recallTargetLabel(recall)}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-secondary-400" aria-hidden="true" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-secondary-500">
                <Badge variant={recall.status === 'active' ? 'danger' : 'neutral'}>
                  {t(`pharmacy:common.recallStatus.${recall.status}`)}
                </Badge>
                <span>{t('pharmacy:recalls.lotCount', { count: recall.lotCount })}</span>
                <span>{formatDateTime(recall.initiatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="mt-3">
          <TablePagination
            page={displayRecallPage - 1}
            pageCount={recallPageCount}
            total={recallTotal}
            rangeStart={(displayRecallPage - 1) * RECALLS_PER_PAGE + 1}
            rangeEnd={Math.min(displayRecallPage * RECALLS_PER_PAGE, recallTotal)}
            onPageChange={nextPage => {
              setRecallPage(nextPage + 1);
              closeRecallDetail();
            }}
          />
        </div>
      </section>

      {detailId && (
        <section className="card p-5" aria-labelledby="pharmacy-recall-detail-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="pharmacy-recall-detail-heading" className="font-semibold text-secondary-950">
                {t('pharmacy:recalls.detailTitle')}
              </h3>
              <p className="mt-1 font-mono text-xs text-secondary-500">{detailId}</p>
              {detail ? (
                <p className="mt-1 text-sm font-medium text-secondary-700">
                  {recallTargetLabel(detail)}
                </p>
              ) : null}
            </div>
            <Button variant="ghost" size="compact" onClick={closeRecallDetail}>
              {t('pharmacy:common.close')}
            </Button>
          </div>

          {(detailQuery.isLoading || affectedSalesQuery.isLoading) && (
            <p className="mt-4 text-sm text-secondary-600" role="status">
              {t('pharmacy:common.loading')}
            </p>
          )}
          {(detailQuery.error || affectedSalesQuery.error) && (
            <div className="mt-4 rounded-xl bg-danger-50 p-3 text-sm text-danger-800" role="alert">
              {translateServerError(
                detailQuery.error ?? affectedSalesQuery.error,
                t,
                t('pharmacy:recalls.loadError')
              )}
            </div>
          )}
          {detail && (
            <div className="mt-5 space-y-5">
              <div className="rounded-2xl bg-secondary-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={detail.status === 'active' ? 'danger' : 'neutral'}>
                    {t(`pharmacy:common.recallStatus.${detail.status}`)}
                  </Badge>
                  <span className="text-sm text-secondary-600">
                    {t('pharmacy:recalls.startedAt', { date: formatDateTime(detail.initiatedAt) })}
                  </span>
                </div>
                <p className="mt-3 text-sm text-secondary-900">{detail.reason}</p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-secondary-900">
                  {t('pharmacy:recalls.blockedLots')}
                </h4>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase text-secondary-500">
                      <tr>
                        <th className="px-3 py-2">{t('pharmacy:recalls.columns.product')}</th>
                        <th className="px-3 py-2">{t('pharmacy:recalls.columns.lot')}</th>
                        <th className="px-3 py-2">{t('pharmacy:recalls.columns.expiry')}</th>
                        <th className="px-3 py-2">{t('pharmacy:recalls.columns.quantity')}</th>
                        <th className="px-3 py-2">{t('pharmacy:recalls.columns.status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-secondary-100">
                      {detail.lots.map(lot => (
                        <tr key={lot.lotId}>
                          <td className="px-3 py-2 font-medium text-secondary-900">
                            {lot.productName}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{lot.lotNumber}</td>
                          <td className="px-3 py-2">
                            {lot.expiresAt
                              ? formatCalendarDay(lot.expiresAt)
                              : t('pharmacy:common.notApplicable')}
                          </td>
                          <td className="px-3 py-2">{lot.onHand}</td>
                          <td className="px-3 py-2">
                            {t(`pharmacy:common.lotStatus.${lot.status}`)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3">
                  <TablePagination
                    page={displayLotPage - 1}
                    pageCount={lotPageCount}
                    total={lotTotal}
                    rangeStart={(displayLotPage - 1) * RECALL_DETAIL_PER_PAGE + 1}
                    rangeEnd={Math.min(displayLotPage * RECALL_DETAIL_PER_PAGE, lotTotal)}
                    onPageChange={nextPage => setLotPage(nextPage + 1)}
                  />
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-secondary-900">
                  {t('pharmacy:recalls.affectedSalesTitle')}
                </h4>
                <p className="mt-1 text-xs text-secondary-500">
                  {t(
                    user?.role === 'admin'
                      ? 'pharmacy:recalls.affectedSalesPrivacy'
                      : 'pharmacy:recalls.affectedSalesPrivacyRestricted'
                  )}
                </p>
                {affectedSales.length === 0 ? (
                  <p className="mt-3 text-sm text-secondary-600">
                    {t('pharmacy:recalls.noAffectedSales')}
                  </p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-xs uppercase text-secondary-500">
                        <tr>
                          <th className="px-3 py-2">{t('pharmacy:recalls.columns.sale')}</th>
                          <th className="px-3 py-2">{t('pharmacy:recalls.columns.date')}</th>
                          <th className="px-3 py-2">{t('pharmacy:recalls.columns.customer')}</th>
                          <th className="px-3 py-2">{t('pharmacy:recalls.columns.lot')}</th>
                          <th className="px-3 py-2">{t('pharmacy:recalls.columns.quantity')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-secondary-100">
                        {affectedSales.map(sale => (
                          <tr key={`${sale.saleItemId}:${sale.lotId}`}>
                            <td className="px-3 py-2 font-mono text-xs">{sale.saleNumber}</td>
                            <td className="px-3 py-2">{formatDateTime(sale.soldAt)}</td>
                            <td className="px-3 py-2">
                              <p>
                                {sale.customerIdentityRestricted
                                  ? t('pharmacy:recalls.restrictedCustomer')
                                  : (sale.customerName ?? t('pharmacy:recalls.walkInCustomer'))}
                              </p>
                              {!sale.customerIdentityRestricted &&
                              (sale.customerEmail || sale.customerPhone) ? (
                                <div className="mt-1 space-y-0.5 text-xs text-secondary-500">
                                  {sale.customerEmail ? <p>{sale.customerEmail}</p> : null}
                                  {sale.customerPhone ? <p>{sale.customerPhone}</p> : null}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{sale.lotNumber}</td>
                            <td className="px-3 py-2">{sale.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-3">
                  <TablePagination
                    page={displaySalesPage - 1}
                    pageCount={salesPageCount}
                    total={affectedSalesTotal}
                    rangeStart={(displaySalesPage - 1) * RECALL_DETAIL_PER_PAGE + 1}
                    rangeEnd={Math.min(
                      displaySalesPage * RECALL_DETAIL_PER_PAGE,
                      affectedSalesTotal
                    )}
                    onPageChange={nextPage => setSalesPage(nextPage + 1)}
                  />
                </div>
              </div>

              {detail.status === 'active' && (
                <div className="rounded-2xl border border-warning-200 bg-warning-50 p-4">
                  <label className="label" htmlFor="pharmacy-recall-close-reason">
                    {t('pharmacy:recalls.closeReason')}
                  </label>
                  <textarea
                    id="pharmacy-recall-close-reason"
                    className="pv-input mt-1 min-h-20"
                    value={closeReason}
                    maxLength={500}
                    onChange={event => setCloseReason(event.target.value)}
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-warning-900">{t('pharmacy:recalls.closeWarning')}</p>
                    <Button
                      variant="outline"
                      disabled={closeReason.trim().length < 3 || closeRecall.isPending}
                      onClick={() =>
                        closeRecall.mutate({ id: detail.id, reason: closeReason.trim() })
                      }
                    >
                      {t('pharmacy:recalls.closeAction')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
