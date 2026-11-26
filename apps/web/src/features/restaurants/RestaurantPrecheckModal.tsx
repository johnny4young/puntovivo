/**
 * Non-fiscal restaurant precheck modal with editable suggested voluntary tip
 * (Colombian Law 1935 of 2018 disclosure) and thermal/browser print trigger.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Receipt } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { invalidateCommittedGroups, RESTAURANT_TABLE_INVALIDATIONS } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';

const TIP_PRESETS = [0, 10, 15] as const;

interface RestaurantPrecheckModalProps {
  tableId: string | null;
  tableName: string;
  checkId?: string | undefined;
  onClose: () => void;
}

export function RestaurantPrecheckModal({
  tableId,
  tableName,
  checkId,
  onClose,
}: RestaurantPrecheckModalProps) {
  const { t, i18n } = useTranslation(['restaurants', 'common', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [tipPercent, setTipPercent] = useState<number>(10);

  const precheckQuery = trpc.restaurantServices.getPrecheck.useQuery(
    tableId ? { tableId, ...(checkId ? { checkId } : {}), tipPercent } : (undefined as never),
    { enabled: tableId !== null }
  );

  const printMutation = trpc.restaurantServices.printPrecheck.useMutation({
    onSuccess: async result => {
      await invalidateCommittedGroups(utils, [...RESTAURANT_TABLE_INVALIDATIONS]);
      if (result.printedVia === 'hardware_outbox') {
        toast.success({ title: t('restaurants:precheck.printedOutbox') });
      } else {
        toast.success({ title: t('restaurants:precheck.printedBrowser') });
        if (typeof window !== 'undefined' && typeof window.print === 'function') {
          window.print();
        }
      }
    },
    onError: onErrorToast(toast, t, { titleKey: 'restaurants:precheck.errorTitle' }),
  });

  const data = precheckQuery.data;
  const isEnglish = i18n.language.startsWith('en');

  return (
    <Modal
      isOpen={tableId !== null}
      onClose={onClose}
      title={t('restaurants:precheck.title', { table: tableName })}
      size="md"
    >
      <div className="space-y-4" data-testid="precheck-modal">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg2">
            <Receipt className="h-4 w-4" aria-hidden="true" />
            {t('restaurants:precheck.nonFiscalBadge')}
          </span>
          {data && (
            <span className="text-xs font-medium text-fg3 tabular-nums">
              {data.saleNumbers.join(' · ')}
            </span>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="precheck-tip-percent" className="text-sm font-medium text-fg1">
              {t('restaurants:precheck.tipPercentLabel')}
            </label>
            <div className="flex items-center gap-1.5">
              {TIP_PRESETS.map(preset => (
                <button
                  key={preset}
                  type="button"
                  className={
                    tipPercent === preset
                      ? 'btn-primary min-h-9 px-3 text-xs'
                      : 'btn-outline min-h-9 px-3 text-xs'
                  }
                  onClick={() => setTipPercent(preset)}
                  data-testid={`precheck-tip-preset-${preset}`}
                >
                  {preset}%
                </button>
              ))}
              <input
                id="precheck-tip-percent"
                type="number"
                min={0}
                max={100}
                step={1}
                className="input h-9 w-20 text-right text-sm tabular-nums"
                value={Number.isFinite(tipPercent) ? tipPercent : 0}
                onChange={event => {
                  const next = Number(event.target.value);
                  setTipPercent(Number.isFinite(next) ? Math.max(0, Math.min(100, next)) : 0);
                }}
                data-testid="precheck-tip-input"
              />
            </div>
          </div>
        </div>

        {precheckQuery.isLoading && (
          <p className="py-6 text-center text-sm text-fg3" role="status">
            {t('restaurants:precheck.loading')}
          </p>
        )}

        {precheckQuery.isError && (
          <p className="text-sm text-danger-700" role="alert">
            {t('restaurants:precheck.errorTitle')}
          </p>
        )}

        {data && (
          <>
            <ul
              className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line px-3"
              data-testid="precheck-items"
            >
              {data.items.map(item => (
                <li
                  key={item.saleItemId}
                  className="flex items-start justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg1">
                      {item.quantity} × {item.productName}
                    </p>
                    {item.modifiers.length > 0 && (
                      <p className="text-xs text-fg3">
                        {item.modifiers
                          .map(m => `${m.groupKind === 'without' ? 'sin ' : '+ '}${m.name}`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums text-fg1">
                    {formatCurrency(item.total)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="space-y-1.5 rounded-lg border border-line bg-surface-2 p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-fg2">{t('restaurants:precheck.subtotal')}</dt>
                <dd className="tabular-nums text-fg1">{formatCurrency(data.subtotal)}</dd>
              </div>
              {data.taxAmount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-fg2">{t('restaurants:precheck.taxes')}</dt>
                  <dd className="tabular-nums text-fg1">{formatCurrency(data.taxAmount)}</dd>
                </div>
              )}
              {data.discountAmount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-fg2">{t('restaurants:precheck.discount')}</dt>
                  <dd className="tabular-nums text-fg1">-{formatCurrency(data.discountAmount)}</dd>
                </div>
              )}
              {data.serviceChargeAmount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-fg2">{t('restaurants:precheck.serviceCharge')}</dt>
                  <dd className="tabular-nums text-fg1">
                    {formatCurrency(data.serviceChargeAmount)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
                <dt className="text-fg1">{t('restaurants:precheck.baseTotal')}</dt>
                <dd className="tabular-nums text-fg1" data-testid="precheck-base-total">
                  {formatCurrency(data.baseTotal)}
                </dd>
              </div>
              <div className="flex justify-between text-fg2">
                <dt>{t('restaurants:precheck.suggestedTip', { percent: data.tipPercent })}</dt>
                <dd className="tabular-nums" data-testid="precheck-tip-amount">
                  {formatCurrency(data.suggestedTipAmount)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1.5 text-base font-bold text-fg1">
                <dt>{t('restaurants:precheck.totalWithTip')}</dt>
                <dd className="tabular-nums" data-testid="precheck-total-with-tip">
                  {formatCurrency(data.totalWithTip)}
                </dd>
              </div>
            </dl>

            <p
              className="rounded-lg border border-line bg-surface p-3 text-xs text-fg2"
              data-testid="precheck-legal-notice"
            >
              {isEnglish ? data.voluntaryTipNoticeEn : data.voluntaryTipNoticeEs}
            </p>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-outline min-h-11" onClick={onClose}>
            {t('common:actions.close')}
          </button>
          <button
            type="button"
            className="btn-primary min-h-11"
            disabled={!data || printMutation.isPending}
            onClick={() => {
              if (!tableId) return;
              printMutation.mutate({
                tableId,
                ...(checkId ? { checkId } : {}),
                tipPercent,
                markBillRequested: true,
              });
            }}
            data-testid="precheck-print-cta"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            {printMutation.isPending
              ? t('restaurants:precheck.printing')
              : t('restaurants:precheck.print')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
