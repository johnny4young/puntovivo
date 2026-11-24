import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { ModalButton } from '@/components/form-controls/Modal';
import { Overlay } from '@/components/overlay/Overlay';
import { cn, formatCurrency } from '@/lib/utils';
import type { Sale } from '@/types';
import {
  ReturnExternalReferences,
  ReturnLineAllocations,
} from '@/features/sales/returns/ReturnFields';
import {
  lineName,
  lineRemaining,
  useReturnPreview,
  useReturnSelection,
  type ReturnDestination,
  type ReturnItemSubmission,
} from '@/features/sales/returns/useReturnDraft';

const RETURN_REASONS = ['expired', 'duplicate', 'wrong_item', 'other'] as const;
export type RefundReason = (typeof RETURN_REASONS)[number];

export interface RefundSubmission {
  reason?: string | undefined;
  items: ReturnItemSubmission[];
  destination: ReturnDestination;
  externalReferences?: Array<{ salePaymentId: string | null; reference: string }> | undefined;
}

interface RefundConfirmOverlayProps {
  isOpen: boolean;
  isPending: boolean;
  sale: Sale;
  approvalPanel?: ReactNode | undefined;
  confirmDisabled?: boolean | undefined;
  onClose: () => void;
  onConfirm: (submission: RefundSubmission) => void;
}

export function RefundConfirmOverlay(props: RefundConfirmOverlayProps) {
  if (!props.isOpen) return null;
  return <RefundConfirmOverlayContent key={props.sale.id} {...props} />;
}

function RefundConfirmOverlayContent({
  isOpen,
  isPending,
  sale,
  approvalPanel,
  confirmDisabled = false,
  onClose,
  onConfirm,
}: RefundConfirmOverlayProps) {
  const { t } = useTranslation('sales');
  const selection = useReturnSelection(sale);
  const { returnableLines, selectedQuantities } = selection;
  const [destination, setDestination] = useState<ReturnDestination>('original');
  const [reason, setReason] = useState<RefundReason | ''>('');
  const previewState = useReturnPreview({ saleId: sale.id, selection, destination });
  const { preview, error: previewError } = previewState;
  const submission: RefundSubmission = {
    items: selection.selectedItems,
    destination,
    ...(reason ? { reason } : {}),
    ...(previewState.referenceRows.length > 0
      ? { externalReferences: previewState.referenceRows }
      : {}),
  };
  const cannotConfirm =
    isPending ||
    confirmDisabled ||
    !selection.canPreview ||
    previewState.isFetching ||
    preview === undefined ||
    !previewState.referencesAreValid ||
    previewError !== null;

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      kicker={t('sales:refund.kicker')}
      title={t('sales:refund.title')}
      description={t('sales:refund.descriptionWithNumber', { number: sale.saleNumber })}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isPending} className="sm:min-w-[8.5rem]">
            {t('sales:refund.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={() => onConfirm(submission)}
            disabled={cannotConfirm}
            className="disabled:bg-secondary-200 disabled:text-secondary-500 sm:min-w-[10rem]"
          >
            {isPending ? t('sales:refund.processing') : t('sales:refund.confirm')}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-5">
        {approvalPanel}

        <section className="rounded-2xl border border-line/70 bg-surface/95 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-secondary-500">
                {t('sales:refund.linesLabel')}
              </p>
              <p className="mt-1 text-sm text-secondary-600">{t('sales:refund.linesHint')}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-outline text-xs" onClick={selection.selectAll}>
                {t('sales:refund.selectAll')}
              </button>
              <button type="button" className="btn-outline text-xs" onClick={selection.clear}>
                {t('sales:refund.clearSelection')}
              </button>
            </div>
          </div>

          {returnableLines.length === 0 ? (
            <p className="mt-4 rounded-xl bg-surface-2 px-3 py-3 text-sm text-secondary-600">
              {t('sales:refund.nothingAvailable')}
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {returnableLines.map(line => {
                const selected = selectedQuantities[line.id] !== undefined;
                const remaining = lineRemaining(line);
                return (
                  <li
                    key={line.id}
                    className="rounded-xl border border-line/70 bg-surface px-3 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={event => selection.selectLine(line, event.target.checked)}
                        aria-label={t('sales:refund.selectLine', {
                          product: lineName(line, returnableLines),
                        })}
                        className="mt-1 h-4 w-4 rounded border-line-strong text-primary-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-secondary-950">
                              {lineName(line, returnableLines)}
                            </p>
                            <p className="text-xs text-secondary-500">
                              {t('sales:refund.remainingLine', {
                                quantity: remaining,
                                amount: formatCurrency(
                                  Number(line.returnableAmount ?? line.total),
                                  sale.currencyCode
                                ),
                              })}
                            </p>
                          </div>
                          {selected && (
                            <label className="text-xs font-medium text-secondary-600">
                              <span className="mr-2">{t('sales:refund.quantity')}</span>
                              <input
                                type="number"
                                min="0.001"
                                max={remaining}
                                step="any"
                                value={selectedQuantities[line.id]}
                                onChange={event =>
                                  selection.updateLineQuantity(line, Number(event.target.value))
                                }
                                className="w-24 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-right text-sm text-secondary-950"
                              />
                            </label>
                          )}
                        </div>

                        <ReturnLineAllocations line={line} selection={selection} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {!selection.selectionIsValid && (
            <p className="mt-3 text-sm text-danger-600" role="alert">
              {t('sales:refund.selectionInvalid')}
            </p>
          )}
        </section>

        <section>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-secondary-500">
            {t('sales:refund.destinationLabel')}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(['original', 'store_credit'] as const).map(option => {
              const disabled = option === 'store_credit' && !sale.customerId;
              return (
                <button
                  key={option}
                  type="button"
                  disabled={disabled}
                  onClick={() => setDestination(option)}
                  aria-pressed={destination === option}
                  className={cn(
                    'rounded-2xl border px-4 py-3 text-left transition-all',
                    destination === option
                      ? 'border-primary-400 bg-primary-50 text-primary-800'
                      : 'border-line-strong/60 bg-surface text-secondary-700',
                    disabled && 'cursor-not-allowed opacity-45'
                  )}
                >
                  <span className="block text-sm font-semibold">
                    {t(`sales:refund.destination.${option}.title`)}
                  </span>
                  <span className="mt-1 block text-xs leading-5">
                    {t(`sales:refund.destination.${option}.description`)}
                  </span>
                </button>
              );
            })}
          </div>
          {!sale.customerId && (
            <p className="mt-2 text-xs text-secondary-500">
              {t('sales:refund.storeCreditCustomerRequired')}
            </p>
          )}
        </section>

        <ReturnExternalReferences preview={previewState} currencyCode={sale.currencyCode} />

        <section>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-secondary-500">
            {t('sales:refund.reasonLabel')}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {RETURN_REASONS.map(option => {
              const active = reason === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setReason(option)}
                  className={cn(
                    'flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm font-medium transition-all',
                    active
                      ? 'border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-line-strong/60 bg-surface text-secondary-700 hover:border-primary-300 hover:bg-primary-50/60'
                  )}
                  aria-pressed={active}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                      active ? 'border-primary-500 bg-primary-500' : 'border-line-strong/60'
                    )}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  {t(`sales:refund.reasons.${option}`)}
                </button>
              );
            })}
          </div>
        </section>

        <div
          className="relative overflow-hidden rounded-2xl border border-warning-500/30 bg-warning-50/70 px-5 py-4"
          aria-label={t('sales:refund.totalLabel')}
        >
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-warning-700">
                {t('sales:refund.totalLabel')}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums tracking-[-0.02em] text-warning-700">
                {preview
                  ? formatCurrency(preview.refundAmount, sale.currencyCode)
                  : formatCurrency(0, sale.currencyCode)}
              </p>
              {preview && (
                <p className="mt-2 text-xs text-warning-800">
                  {t('sales:refund.previewBreakdown', {
                    tax: formatCurrency(preview.taxAmount, sale.currencyCode),
                    cash: formatCurrency(preview.cashAmount, sale.currencyCode),
                    external: formatCurrency(preview.externalAmount, sale.currencyCode),
                    credit: formatCurrency(preview.storeCreditAmount, sale.currencyCode),
                    receivable: formatCurrency(preview.receivableAmount, sale.currencyCode),
                  })}
                </p>
              )}
            </div>
            <AlertTriangle className="h-6 w-6 shrink-0 text-warning-700" />
          </div>
        </div>

        {previewState.isFetching && (
          <p className="text-sm text-secondary-500" role="status">
            {t('sales:refund.calculating')}
          </p>
        )}
        {previewError && (
          <p className="text-sm text-danger-600" role="alert">
            {previewError}
          </p>
        )}
      </div>
    </Overlay>
  );
}
