import { useMemo, useState } from 'react';
import { ArrowRightLeft, PackageCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui';
import { useTenant } from '@/features/tenant/TenantProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatCalendarDay } from '@/lib/utils';
import type { Product } from '@/types';

export function PharmacyFractionationPanel() {
  const { t } = useTranslation(['pharmacy', 'pharmacyErrors', 'errors']);
  const { currentSite } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();

  const [sourceProductId, setSourceProductId] = useState('');
  const [sourceLotId, setSourceLotId] = useState('');
  const [targetProductId, setTargetProductId] = useState('');
  const [sourceQuantity, setSourceQuantity] = useState('1');
  const [targetQuantity, setTargetQuantity] = useState('');
  const [reason, setReason] = useState('');

  const productsQuery = trpc.products.list.useQuery(
    { page: 1, perPage: 100, pharmacyOnly: true },
    { enabled: !!currentSite?.id }
  );
  const medicines = useMemo(
    () =>
      ((productsQuery.data?.items ?? []) as Product[]).filter(
        p => p.pharmacy !== null && p.tracksLots && p.tracksStock && p.isActive
      ),
    [productsQuery.data?.items]
  );

  const sourceLotsQuery = trpc.inventoryLots.list.useQuery(
    { siteId: currentSite?.id ?? '', productId: sourceProductId, activeOnly: true },
    { enabled: !!currentSite?.id && !!sourceProductId }
  );
  const activeLots = (sourceLotsQuery.data?.items ?? []).filter(
    lot => lot.status === 'active' && lot.onHand > 0
  );

  const historyQuery = trpc.pharmacy.listFractionations.useQuery(
    { siteId: currentSite?.id ?? undefined, page: 1, perPage: 20 },
    { enabled: !!currentSite?.id }
  );

  const targetCandidates = useMemo(
    () => medicines.filter(m => m.id !== sourceProductId),
    [medicines, sourceProductId]
  );

  const fractionate = useCriticalMutation('pharmacy.fractionateLot', {
    onSuccess: async data => {
      await Promise.all([
        utils.inventoryLots.list.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.inventory.listBalancesBySite.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.pharmacy.listFractionations.invalidate(),
      ]);
      setSourceQuantity('1');
      setTargetQuantity('');
      setReason('');
      toast.success({
        title: t('pharmacy:fractionation.toast.success'),
        description: t('pharmacy:fractionation.toast.summary', {
          lot: data.lotNumber,
          onHand: data.targetOnHand,
        }),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:fractionation.toast.error' }),
  });

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

  const parsedSource = Number(sourceQuantity);
  const parsedTarget = Number(targetQuantity);
  const canSubmit =
    Boolean(sourceLotId) &&
    Boolean(targetProductId) &&
    Number.isFinite(parsedSource) &&
    parsedSource > 0 &&
    Number.isFinite(parsedTarget) &&
    parsedTarget > 0 &&
    reason.trim().length >= 3 &&
    !fractionate.isPending;

  return (
    <div
      className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
      data-testid="pharmacy-fractionation-panel"
    >
      <section className="card space-y-4 p-5">
        <div className="flex items-center gap-2.5">
          <ArrowRightLeft className="h-5 w-5 text-primary-700" aria-hidden="true" />
          <h3 className="font-semibold text-secondary-950">{t('pharmacy:fractionation.title')}</h3>
        </div>

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-frac-source-product">
            {t('pharmacy:fractionation.sourceProduct')}
          </label>
          <select
            id="pharmacy-frac-source-product"
            data-testid="pharmacy-frac-source-product"
            className="pv-input"
            value={sourceProductId}
            onChange={e => {
              setSourceProductId(e.target.value);
              setSourceLotId('');
              if (e.target.value === targetProductId) setTargetProductId('');
            }}
          >
            <option value="">{t('pharmacy:fractionation.sourceProductPlaceholder')}</option>
            {medicines.map(med => (
              <option key={med.id} value={med.id}>
                {med.name} · {med.sku}
              </option>
            ))}
          </select>
        </div>

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-frac-source-lot">
            {t('pharmacy:fractionation.sourceLot')}
          </label>
          <select
            id="pharmacy-frac-source-lot"
            data-testid="pharmacy-frac-source-lot"
            className="pv-input"
            value={sourceLotId}
            disabled={!sourceProductId || sourceLotsQuery.isLoading}
            onChange={e => setSourceLotId(e.target.value)}
          >
            <option value="">{t('pharmacy:fractionation.sourceLotPlaceholder')}</option>
            {activeLots.map(lot => (
              <option key={lot.id} value={lot.id}>
                {lot.lotNumber} · {lot.onHand}
                {lot.expiresAt ? ` · ${formatCalendarDay(lot.expiresAt)}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-frac-target-product">
            {t('pharmacy:fractionation.targetProduct')}
          </label>
          <select
            id="pharmacy-frac-target-product"
            data-testid="pharmacy-frac-target-product"
            className="pv-input"
            value={targetProductId}
            onChange={e => setTargetProductId(e.target.value)}
          >
            <option value="">{t('pharmacy:fractionation.targetProductPlaceholder')}</option>
            {targetCandidates.map(med => (
              <option key={med.id} value={med.id}>
                {med.name} · {med.sku}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="pv-field">
            <label className="label" htmlFor="pharmacy-frac-source-qty">
              {t('pharmacy:fractionation.sourceQuantity')}
            </label>
            <input
              id="pharmacy-frac-source-qty"
              data-testid="pharmacy-frac-source-qty"
              type="number"
              min="0.001"
              step="any"
              className="pv-input"
              value={sourceQuantity}
              onChange={e => setSourceQuantity(e.target.value)}
            />
          </div>
          <div className="pv-field">
            <label className="label" htmlFor="pharmacy-frac-target-qty">
              {t('pharmacy:fractionation.targetQuantity')}
            </label>
            <input
              id="pharmacy-frac-target-qty"
              data-testid="pharmacy-frac-target-qty"
              type="number"
              min="0.001"
              step="any"
              className="pv-input"
              value={targetQuantity}
              onChange={e => setTargetQuantity(e.target.value)}
            />
          </div>
        </div>

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-frac-reason">
            {t('pharmacy:common.reason')}
          </label>
          <input
            id="pharmacy-frac-reason"
            data-testid="pharmacy-frac-reason"
            className="pv-input"
            value={reason}
            placeholder={t('pharmacy:fractionation.reasonPlaceholder')}
            onChange={e => setReason(e.target.value)}
          />
        </div>

        <Button
          type="button"
          data-testid="pharmacy-frac-submit"
          disabled={!canSubmit}
          onClick={() => {
            if (!canSubmit) return;
            fractionate.mutate({
              sourceLotId,
              targetProductId,
              sourceQuantity: parsedSource,
              targetQuantity: parsedTarget,
              reason: reason.trim(),
            });
          }}
        >
          {t('pharmacy:fractionation.submit')}
        </Button>
      </section>

      <section className="card space-y-4 p-5">
        <h3 className="font-semibold text-secondary-950">
          {t('pharmacy:fractionation.historyTitle')}
        </h3>
        {(historyQuery.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-secondary-500">{t('pharmacy:fractionation.emptyHistory')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-secondary-200 text-xs uppercase text-secondary-500">
                <tr>
                  <th className="py-2 pr-3">{t('pharmacy:fractionation.columns.flow')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:fractionation.columns.lot')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:fractionation.columns.registration')}</th>
                  <th className="py-2">{t('pharmacy:fractionation.columns.actor')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {historyQuery.data?.items.map(row => (
                  <tr key={row.id} data-testid="pharmacy-frac-history-row">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-secondary-900">
                        {row.sourceQuantity}× {row.sourceProductName} → {row.targetQuantity}×{' '}
                        {row.targetProductName}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-secondary-700">
                      {row.lotNumber}
                      {row.expiresAt ? ` · ${formatCalendarDay(row.expiresAt)}` : ''}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-secondary-700">
                      {row.sanitaryRegistration ?? '—'}
                    </td>
                    <td className="py-2.5 text-xs text-secondary-600">{row.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
