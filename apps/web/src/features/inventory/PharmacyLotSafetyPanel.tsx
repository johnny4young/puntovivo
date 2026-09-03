import { useMemo, useState } from 'react';
import { AlertTriangle, PackageCheck, ShieldAlert, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { Badge, Button } from '@/components/ui';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatCalendarDay } from '@/lib/utils';
import type { Product } from '@/types';

type LotAction = 'quarantine' | 'release' | 'expiration' | 'cold_chain_incident';

const lotStatusTones = {
  active: 'success',
  depleted: 'neutral',
  quarantined: 'warning',
  expired: 'danger',
  recalled: 'danger',
} as const;

export function PharmacyLotSafetyPanel() {
  const { t } = useTranslation(['pharmacy', 'pharmacyErrors', 'errors']);
  const { currentSite } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [productId, setProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductOption, setSelectedProductOption] = useState<Product | null>(null);
  const [lotSelection, setLotSelection] = useState({ id: '', productId: '', siteId: '' });
  const [reason, setReason] = useState('');
  const [destroyQuantity, setDestroyQuantity] = useState('');

  const lotId =
    lotSelection.productId === productId && lotSelection.siteId === (currentSite?.id ?? '')
      ? lotSelection.id
      : '';

  const debouncedProductSearch = useDebouncedValue(productSearch.trim(), 200);
  const productsListQuery = trpc.products.list.useQuery(
    {
      page: 1,
      perPage: 50,
      pharmacyOnly: true,
    },
    { enabled: !!currentSite?.id && !debouncedProductSearch }
  );
  const productsSearchQuery = trpc.products.search.useQuery(
    {
      q: debouncedProductSearch || '__disabled__',
      limit: 50,
      tracksStock: true,
      pharmacyOnly: true,
    },
    { enabled: !!currentSite?.id && !!debouncedProductSearch }
  );
  const productsQuery = debouncedProductSearch ? productsSearchQuery : productsListQuery;
  const pharmacyProducts = useMemo(() => {
    const matches = ((productsQuery.data?.items ?? []) as Product[]).filter(
      product => product.pharmacy !== null && product.tracksLots && product.tracksStock
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
  const lotsQuery = trpc.inventoryLots.list.useQuery(
    {
      siteId: currentSite?.id ?? '',
      productId,
      activeOnly: false,
    },
    { enabled: !!currentSite?.id && !!productId }
  );
  const lots = lotsQuery.data?.items ?? [];
  const selectedLot = lots.find(lot => lot.id === lotId) ?? null;
  const selectedLotHasActiveRecall = (selectedLot?.activeRecallCount ?? 0) > 0;

  async function invalidateCustody() {
    await Promise.all([
      utils.inventoryLots.list.invalidate(),
      utils.inventoryLots.expiring.invalidate(),
      utils.inventory.listMovements.invalidate(),
      utils.inventory.listStock.invalidate(),
      utils.inventory.listBalancesBySite.invalidate(),
      utils.products.list.invalidate(),
      utils.products.search.invalidate(),
      utils.pharmacy.listRecalls.invalidate(),
      utils.pharmacy.getRecall.invalidate(),
    ]);
  }

  const transition = useCriticalMutation('pharmacy.transitionLot', {
    onSuccess: async data => {
      await invalidateCustody();
      setReason('');
      toast.success({
        title: t('pharmacy:lots.toast.transitioned'),
        description: t('pharmacy:lots.toast.status', {
          status: t(`pharmacy:common.lotStatus.${data.status}`),
        }),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:lots.toast.error' }),
  });
  const destroy = useCriticalMutation('pharmacy.destroyLot', {
    onSuccess: async data => {
      await invalidateCustody();
      setReason('');
      setDestroyQuantity('');
      toast.success({
        title: t('pharmacy:lots.toast.destroyed'),
        description: t('pharmacy:lots.toast.remaining', { quantity: data.onHand }),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:lots.toast.error' }),
  });

  const trimmedReason = reason.trim();
  const parsedDestroyQuantity = Number(destroyQuantity);
  const mutationPending = transition.isPending || destroy.isPending;
  const baseDisabled = !selectedLot || trimmedReason.length < 3 || mutationPending;

  function runTransition(action: LotAction) {
    if (baseDisabled || !selectedLot) return;
    transition.mutate({ lotId: selectedLot.id, action, reason: trimmedReason });
  }

  function runDestruction() {
    if (
      baseDisabled ||
      !selectedLot ||
      !Number.isFinite(parsedDestroyQuantity) ||
      parsedDestroyQuantity <= 0 ||
      parsedDestroyQuantity > selectedLot.onHand
    ) {
      return;
    }
    destroy.mutate({
      lotId: selectedLot.id,
      quantity: parsedDestroyQuantity,
      reason: trimmedReason,
    });
  }

  if (!currentSite) {
    return (
      <div className="pv-empty">
        <span className="ic">
          <PackageCheck aria-hidden="true" />
        </span>
        <h4>{t('pharmacy:lots.siteRequiredTitle')}</h4>
        <p>{t('pharmacy:lots.siteRequiredDescription')}</p>
      </div>
    );
  }

  if (productsQuery.error) {
    return (
      <QueryErrorState
        title={t('pharmacy:lots.loadError')}
        message={translateServerError(productsQuery.error, t, t('errors:server.unknown'))}
        onRetry={() => void productsQuery.refetch()}
      />
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="card space-y-4 p-5" aria-labelledby="pharmacy-lot-selection-heading">
        <div>
          <h3 id="pharmacy-lot-selection-heading" className="font-semibold text-secondary-950">
            {t('pharmacy:lots.selectionTitle')}
          </h3>
          <p className="mt-1 text-sm text-secondary-600">
            {t('pharmacy:lots.selectionDescription', { site: currentSite.name })}
          </p>
        </div>

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-lot-product-search">
            {t('pharmacy:common.searchMedicine')}
          </label>
          <input
            id="pharmacy-lot-product-search"
            className="pv-input"
            type="search"
            value={productSearch}
            placeholder={t('pharmacy:common.searchMedicinePlaceholder')}
            onChange={event => setProductSearch(event.target.value)}
          />
        </div>

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-lot-product">
            {t('pharmacy:lots.product')}
          </label>
          <select
            id="pharmacy-lot-product"
            className="pv-input"
            value={productId}
            disabled={productsQuery.isLoading}
            onChange={event => {
              const nextProductId = event.target.value;
              setProductId(nextProductId);
              setSelectedProductOption(
                pharmacyProducts.find(product => product.id === nextProductId) ?? null
              );
              setLotSelection({ id: '', productId: nextProductId, siteId: currentSite.id });
              setReason('');
              setDestroyQuantity('');
            }}
          >
            <option value="">{t('pharmacy:lots.productPlaceholder')}</option>
            {pharmacyProducts.map(product => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.sku}
                {product.isActive === false ? ` · ${t('pharmacy:common.inactive')}` : ''}
              </option>
            ))}
          </select>
          {!productsQuery.isLoading && pharmacyProducts.length === 0 && (
            <p className="mt-1 text-xs text-secondary-500">{t('pharmacy:lots.noProducts')}</p>
          )}
        </div>

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-lot-id">
            {t('pharmacy:lots.lot')}
          </label>
          <select
            id="pharmacy-lot-id"
            className="pv-input"
            value={lotId}
            disabled={!productId || lotsQuery.isLoading}
            onChange={event => {
              setLotSelection({
                id: event.target.value,
                productId,
                siteId: currentSite.id,
              });
              setReason('');
              setDestroyQuantity('');
            }}
          >
            <option value="">{t('pharmacy:lots.lotPlaceholder')}</option>
            {lots.map(lot => (
              <option key={lot.id} value={lot.id}>
                {lot.lotNumber} · {t(`pharmacy:common.lotStatus.${lot.status}`)} · {lot.onHand}
              </option>
            ))}
          </select>
          {lotsQuery.error && (
            <div
              className="mt-2 flex items-center justify-between gap-3 text-sm text-danger-700"
              role="alert"
            >
              <span>{translateServerError(lotsQuery.error, t, t('pharmacy:lots.loadError'))}</span>
              <button className="link" type="button" onClick={() => void lotsQuery.refetch()}>
                {t('pharmacy:common.retry')}
              </button>
            </div>
          )}
          {!lotsQuery.isLoading && productId && !lotsQuery.error && lots.length === 0 && (
            <p className="mt-1 text-xs text-secondary-500">{t('pharmacy:lots.noLots')}</p>
          )}
        </div>

        {selectedLot && (
          <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-secondary-50 p-4 text-sm">
            <div>
              <dt className="text-secondary-500">{t('pharmacy:lots.status')}</dt>
              <dd className="mt-1">
                <Badge variant={lotStatusTones[selectedLot.status]}>
                  {t(`pharmacy:common.lotStatus.${selectedLot.status}`)}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-secondary-500">{t('pharmacy:lots.onHand')}</dt>
              <dd className="mt-1 font-semibold text-secondary-950">{selectedLot.onHand}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-secondary-500">{t('pharmacy:lots.expiry')}</dt>
              <dd className="mt-1 text-secondary-900">
                {selectedLot.expiresAt
                  ? formatCalendarDay(selectedLot.expiresAt)
                  : t('pharmacy:common.notApplicable')}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="card space-y-4 p-5" aria-labelledby="pharmacy-lot-actions-heading">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning-50 text-warning-700">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 id="pharmacy-lot-actions-heading" className="font-semibold text-secondary-950">
              {t('pharmacy:lots.actionsTitle')}
            </h3>
            <p className="mt-1 text-sm text-secondary-600">
              {t('pharmacy:lots.actionsDescription')}
            </p>
          </div>
        </div>

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-lot-reason">
            {t('pharmacy:common.reason')}
          </label>
          <textarea
            id="pharmacy-lot-reason"
            className="pv-input min-h-24"
            value={reason}
            maxLength={500}
            placeholder={t('pharmacy:lots.reasonPlaceholder')}
            onChange={event => setReason(event.target.value)}
          />
          <p className="mt-1 text-xs text-secondary-500">{t('pharmacy:lots.reasonHelp')}</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            disabled={
              baseDisabled ||
              selectedLot?.status === 'quarantined' ||
              selectedLot?.status === 'recalled' ||
              selectedLot?.status === 'expired'
            }
            onClick={() => runTransition('quarantine')}
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {t('pharmacy:lots.actions.quarantine')}
          </Button>
          <Button
            variant="outline"
            disabled={
              baseDisabled ||
              selectedLot?.status === 'quarantined' ||
              selectedLot?.status === 'recalled' ||
              selectedLot?.status === 'expired'
            }
            onClick={() => runTransition('cold_chain_incident')}
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {t('pharmacy:lots.actions.coldChain')}
          </Button>
          <Button
            variant="outline"
            disabled={
              baseDisabled ||
              selectedLotHasActiveRecall ||
              (selectedLot?.status !== 'quarantined' && selectedLot?.status !== 'recalled')
            }
            onClick={() => runTransition('release')}
          >
            <PackageCheck className="h-4 w-4" aria-hidden="true" />
            {t('pharmacy:lots.actions.release')}
          </Button>
          <Button
            variant="outline"
            disabled={
              baseDisabled ||
              selectedLot?.status === 'expired' ||
              selectedLot?.status === 'recalled'
            }
            onClick={() => runTransition('expiration')}
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {t('pharmacy:lots.actions.expire')}
          </Button>
        </div>

        {selectedLotHasActiveRecall ? (
          <p className="text-sm font-medium text-danger-800" role="status">
            {t('pharmacy:lots.releaseBlockedByRecall')}
          </p>
        ) : null}

        <div className="rounded-2xl border border-danger-200 bg-danger-50/70 p-4">
          <label className="label text-danger-900" htmlFor="pharmacy-lot-destroy-quantity">
            {t('pharmacy:lots.destroyQuantity')}
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="pharmacy-lot-destroy-quantity"
              className="pv-input"
              type="number"
              min="0.001"
              step="0.001"
              max={selectedLot?.onHand}
              value={destroyQuantity}
              onChange={event => setDestroyQuantity(event.target.value)}
            />
            <Button
              variant="danger"
              disabled={
                baseDisabled ||
                !Number.isFinite(parsedDestroyQuantity) ||
                parsedDestroyQuantity <= 0 ||
                parsedDestroyQuantity > (selectedLot?.onHand ?? 0)
              }
              onClick={runDestruction}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t('pharmacy:lots.actions.destroy')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-danger-800">{t('pharmacy:lots.destroyHelp')}</p>
        </div>
      </section>
    </div>
  );
}
