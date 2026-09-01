import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { ModalButton } from '@/components/form-controls/Modal';
import { Overlay } from '@/components/overlay/Overlay';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { cn, formatCurrency } from '@/lib/utils';
import type { Sale, SaleItem } from '@/types';

const RETURN_REASONS = ['expired', 'duplicate', 'wrong_item', 'other'] as const;
export type RefundReason = (typeof RETURN_REASONS)[number];

type ReturnDestination = 'original' | 'store_credit';

export interface RefundSubmission {
  reason?: string | undefined;
  items: Array<{
    saleItemId: string;
    quantity: number;
    lotAllocations?: Array<{ saleItemLotId: string; quantity: number }> | undefined;
    serialIds?: string[] | undefined;
  }>;
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

const EPSILON = 1e-8;

function lineRemaining(line: SaleItem): number {
  return Math.max(0, Number(line.remainingQuantity ?? line.quantity));
}

function lineBaseQuantity(line: SaleItem, quantity: number): number {
  return quantity * Number(line.unitEquivalence ?? 1);
}

function defaultLotSelection(line: SaleItem, quantity: number): Record<string, number> {
  let remaining = lineBaseQuantity(line, quantity);
  const selection: Record<string, number> = {};
  for (const lot of line.lots ?? []) {
    if (remaining <= EPSILON) break;
    const allocated = Math.min(Number(lot.remainingQuantity), remaining);
    if (allocated > EPSILON) selection[lot.id] = allocated;
    remaining -= allocated;
  }
  return selection;
}

function defaultSerialSelection(line: SaleItem, quantity: number): string[] {
  const required = lineBaseQuantity(line, quantity);
  if (!Number.isInteger(required)) return [];
  return (line.serials ?? [])
    .filter(serial => !serial.returned)
    .slice(0, required)
    .map(serial => serial.productSerialId);
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
  const { t } = useTranslation(['sales', 'returnErrors', 'errors']);
  const returnableLines = useMemo(
    () => (sale.items ?? []).filter(line => lineRemaining(line) > EPSILON),
    [sale.items]
  );
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
  const [lotSelections, setLotSelections] = useState<Record<string, Record<string, number>>>({});
  const [serialSelections, setSerialSelections] = useState<Record<string, string[]>>({});
  const [destination, setDestination] = useState<ReturnDestination>('original');
  const [externalReferences, setExternalReferences] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<RefundReason | ''>('');

  const selectLine = (line: SaleItem, selected: boolean) => {
    if (!selected) {
      setSelectedQuantities(current => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
      setLotSelections(current => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
      setSerialSelections(current => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
      return;
    }
    const quantity = lineRemaining(line);
    setSelectedQuantities(current => ({ ...current, [line.id]: quantity }));
    setLotSelections(current => ({ ...current, [line.id]: defaultLotSelection(line, quantity) }));
    setSerialSelections(current => ({
      ...current,
      [line.id]: defaultSerialSelection(line, quantity),
    }));
  };

  const updateLineQuantity = (line: SaleItem, value: number) => {
    const quantity = Number.isFinite(value) ? Math.min(lineRemaining(line), Math.max(0, value)) : 0;
    setSelectedQuantities(current => ({ ...current, [line.id]: quantity }));
    setLotSelections(current => ({ ...current, [line.id]: defaultLotSelection(line, quantity) }));
    setSerialSelections(current => ({
      ...current,
      [line.id]: defaultSerialSelection(line, quantity),
    }));
  };

  const selectAll = () => {
    const quantities: Record<string, number> = {};
    const lots: Record<string, Record<string, number>> = {};
    const serials: Record<string, string[]> = {};
    for (const line of returnableLines) {
      const quantity = lineRemaining(line);
      quantities[line.id] = quantity;
      lots[line.id] = defaultLotSelection(line, quantity);
      serials[line.id] = defaultSerialSelection(line, quantity);
    }
    setSelectedQuantities(quantities);
    setLotSelections(lots);
    setSerialSelections(serials);
  };

  const selectedItems = useMemo(
    () =>
      returnableLines.flatMap(line => {
        const quantity = selectedQuantities[line.id];
        if (quantity === undefined || !Number.isFinite(quantity) || quantity <= EPSILON) return [];
        const lots = line.lots ?? [];
        const serials = line.serials ?? [];
        const selectedLots = Object.entries(lotSelections[line.id] ?? {})
          .filter(([, amount]) => amount > EPSILON)
          .map(([saleItemLotId, amount]) => ({ saleItemLotId, quantity: amount }));
        const selectedSerialIds = serialSelections[line.id] ?? [];
        return [
          {
            saleItemId: line.id,
            quantity,
            ...(lots.length > 0 ? { lotAllocations: selectedLots } : {}),
            ...(serials.length > 0 ? { serialIds: selectedSerialIds } : {}),
          },
        ];
      }),
    [lotSelections, returnableLines, selectedQuantities, serialSelections]
  );

  const selectionIsValid = returnableLines.every(line => {
    const quantity = selectedQuantities[line.id];
    if (quantity === undefined) return true;
    if (
      !Number.isFinite(quantity) ||
      quantity <= EPSILON ||
      quantity - lineRemaining(line) > EPSILON
    ) {
      return false;
    }
    const requiredBase = lineBaseQuantity(line, quantity);
    if ((line.lots?.length ?? 0) > 0) {
      const allocated = Object.values(lotSelections[line.id] ?? {}).reduce(
        (sum, amount) => sum + amount,
        0
      );
      if (Math.abs(allocated - requiredBase) > EPSILON) return false;
    }
    if ((line.serials?.length ?? 0) > 0) {
      if (!Number.isInteger(requiredBase)) return false;
      if ((serialSelections[line.id]?.length ?? 0) !== requiredBase) return false;
    }
    return true;
  });

  const canPreview = selectedItems.length > 0 && selectionIsValid;
  const previewQuery = trpc.sales.previewReturn.useQuery(
    {
      id: sale.id,
      items: selectedItems,
      destination,
    },
    {
      enabled: canPreview,
      retry: false,
      staleTime: 0,
    }
  );
  const preview = canPreview ? previewQuery.data : undefined;
  const externalAllocationsRequiringEvidence = (preview?.allocations ?? []).filter(
    allocation => allocation.destination === 'external' && allocation.amount > EPSILON
  );
  const externalReferenceKey = (salePaymentId: string | null, method: string) =>
    salePaymentId ?? `legacy:${method}`;
  const referencesAreValid = externalAllocationsRequiringEvidence.every(allocation => {
    const key = externalReferenceKey(allocation.salePaymentId, allocation.originalMethod);
    return (externalReferences[key] ?? '').trim().length > 0;
  });
  const referenceRows = externalAllocationsRequiringEvidence.map(allocation => {
    const key = externalReferenceKey(allocation.salePaymentId, allocation.originalMethod);
    return {
      salePaymentId: allocation.salePaymentId,
      reference: (externalReferences[key] ?? '').trim(),
    };
  });
  const previewError = previewQuery.error
    ? translateServerError(previewQuery.error, t, t('errors:server.unknown'))
    : null;
  const submission: RefundSubmission = {
    items: selectedItems,
    destination,
    ...(reason ? { reason } : {}),
    ...(referenceRows.length > 0 ? { externalReferences: referenceRows } : {}),
  };
  const cannotConfirm =
    isPending ||
    confirmDisabled ||
    !canPreview ||
    previewQuery.isFetching ||
    preview === undefined ||
    !referencesAreValid ||
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
              <button type="button" className="btn-outline text-xs" onClick={selectAll}>
                {t('sales:refund.selectAll')}
              </button>
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={() => {
                  setSelectedQuantities({});
                  setLotSelections({});
                  setSerialSelections({});
                }}
              >
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
                const requiredBase = selected
                  ? lineBaseQuantity(line, selectedQuantities[line.id] ?? 0)
                  : 0;
                return (
                  <li
                    key={line.id}
                    className="rounded-xl border border-line/70 bg-surface px-3 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={event => selectLine(line, event.target.checked)}
                        aria-label={t('sales:refund.selectLine', {
                          product: line.productNameSnapshot ?? line.productName ?? line.productId,
                        })}
                        className="mt-1 h-4 w-4 rounded border-line-strong text-primary-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-secondary-950">
                              {line.productNameSnapshot ?? line.productName ?? line.productId}
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
                                  updateLineQuantity(line, Number(event.target.value))
                                }
                                className="w-24 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-right text-sm text-secondary-950"
                              />
                            </label>
                          )}
                        </div>

                        {selected && (line.lots?.length ?? 0) > 0 && (
                          <fieldset className="mt-3 rounded-lg border border-line/60 bg-surface-2/65 p-3">
                            <legend className="px-1 text-xs font-semibold text-secondary-600">
                              {t('sales:refund.lotsLegend', { quantity: requiredBase })}
                            </legend>
                            <div className="mt-1 grid gap-2 sm:grid-cols-2">
                              {line.lots
                                ?.filter(lot => lot.remainingQuantity > EPSILON)
                                .map(lot => (
                                  <label key={lot.id} className="text-xs text-secondary-600">
                                    <span className="block truncate">
                                      {t('sales:refund.lotLabel', {
                                        lot: lot.lotNumber,
                                        quantity: lot.remainingQuantity,
                                      })}
                                    </span>
                                    <input
                                      type="number"
                                      min="0"
                                      max={lot.remainingQuantity}
                                      step="any"
                                      value={lotSelections[line.id]?.[lot.id] ?? 0}
                                      onChange={event =>
                                        setLotSelections(current => ({
                                          ...current,
                                          [line.id]: {
                                            ...(current[line.id] ?? {}),
                                            [lot.id]: Number.isFinite(Number(event.target.value))
                                              ? Math.min(
                                                  lot.remainingQuantity,
                                                  Math.max(0, Number(event.target.value))
                                                )
                                              : 0,
                                          },
                                        }))
                                      }
                                      className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-right text-sm text-secondary-950"
                                    />
                                  </label>
                                ))}
                            </div>
                          </fieldset>
                        )}

                        {selected && (line.serials?.length ?? 0) > 0 && (
                          <fieldset className="mt-3 rounded-lg border border-line/60 bg-surface-2/65 p-3">
                            <legend className="px-1 text-xs font-semibold text-secondary-600">
                              {t('sales:refund.serialsLegend', { quantity: requiredBase })}
                            </legend>
                            <div className="mt-1 grid gap-2 sm:grid-cols-2">
                              {line.serials
                                ?.filter(serial => !serial.returned)
                                .map(serial => {
                                  const checked = (serialSelections[line.id] ?? []).includes(
                                    serial.productSerialId
                                  );
                                  return (
                                    <label
                                      key={serial.id}
                                      className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface px-2 py-2 text-xs text-secondary-700"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={event =>
                                          setSerialSelections(current => {
                                            const currentIds = current[line.id] ?? [];
                                            return {
                                              ...current,
                                              [line.id]: event.target.checked
                                                ? [...currentIds, serial.productSerialId]
                                                : currentIds.filter(
                                                    id => id !== serial.productSerialId
                                                  ),
                                            };
                                          })
                                        }
                                      />
                                      <span className="font-mono">{serial.serialNumber}</span>
                                    </label>
                                  );
                                })}
                            </div>
                          </fieldset>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {!selectionIsValid && (
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

        {externalAllocationsRequiringEvidence.length > 0 && (
          <section className="rounded-2xl border border-line/70 bg-surface-2/55 px-4 py-4">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-secondary-500">
              {t('sales:refund.externalReferencesLabel')}
            </p>
            <p className="mt-1 text-sm text-secondary-600">
              {t('sales:refund.externalReferencesHint')}
            </p>
            <div className="mt-3 space-y-3">
              {externalAllocationsRequiringEvidence.map(allocation => {
                const referenceKey = externalReferenceKey(
                  allocation.salePaymentId,
                  allocation.originalMethod
                );
                return (
                  <label
                    key={referenceKey}
                    className="block text-sm font-medium text-secondary-700"
                  >
                    {t('sales:refund.externalReferenceFor', {
                      method: t(`sales:payment.${allocation.originalMethod}`),
                      amount: formatCurrency(allocation.amount, sale.currencyCode),
                    })}
                    <input
                      type="text"
                      maxLength={120}
                      value={externalReferences[referenceKey] ?? ''}
                      onChange={event =>
                        setExternalReferences(current => ({
                          ...current,
                          [referenceKey]: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-secondary-950"
                    />
                  </label>
                );
              })}
            </div>
          </section>
        )}

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

        {previewQuery.isFetching && (
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
