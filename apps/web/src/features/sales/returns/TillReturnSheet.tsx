import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, CornerDownLeft, Lock, ScanBarcode, TriangleAlert } from 'lucide-react';
import { Drawer } from '@/components/feedback/Drawer';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui/Button';
import { useManagerApproval } from '@/features/approvals/useManagerApproval';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  ReturnExternalReferences,
  ReturnLineAllocations,
} from '@/features/sales/returns/ReturnFields';
import { invalidateAfterReturn } from '@/features/sales/returns/returnInvalidations';
import { startExchange } from '@/features/sales/returns/startExchange';
import {
  lineName,
  lineRemaining,
  useReturnPreview,
  useReturnSelection,
  type LineSelection,
  type ReturnDestination,
  type ReturnPreviewState,
  type ReturnSelection,
} from '@/features/sales/returns/useReturnDraft';
import { ChipRadioGroup } from '@/features/sales/ChipRadioGroup';
import { LazyInlineApprovalDecision } from '@/features/sales/CheckoutApprovalPanel';
import {
  RETRYABLE_APPROVAL_STATUSES,
  type ApprovalRequestView,
} from '@/features/sales/useCheckoutApprovals';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import {
  calendarDayAt,
  cn,
  formatCurrency,
  formatDate,
  formatNumber,
  getActiveTenantLocale,
} from '@/lib/utils';
import type { Sale, SaleItem } from '@/types';

/** Stored reason keys the return history translates; the history composer offers its own set. */
const TILL_RETURN_REASONS = ['expired', 'wrong_item', 'charge_error', 'other'] as const;
type TillReturnReason = (typeof TILL_RETURN_REASONS)[number];
const RETURN_DESTINATIONS = [
  'original',
  'store_credit',
] as const satisfies readonly ReturnDestination[];
/** The customer takes something else instead, so a replacement sale follows. */
const EXCHANGE_REASON: TillReturnReason = 'wrong_item';

interface PickedReceipt {
  id: string;
  saleNumber: string;
  completedAt: string | null;
  registerName: string | null;
  scanned: boolean;
}

interface ReturnDraft {
  /** Tenant, cashier and site: a draft never follows the cashier to another site. */
  key: string;
  receipt: PickedReceipt;
  lines: Record<string, LineSelection>;
  reason: TillReturnReason | null;
  destination: ReturnDestination;
}

// The cashier may close the sheet while a manager decides; reopening resumes that return.
let rememberedDraft: ReturnDraft | null = null;

interface TillReturnSheetProps {
  onClose: () => void;
  restoreFocusTo?: (() => HTMLElement | null) | undefined;
}

/** Devolución: scan or pick a receipt, tick what comes back and refund it without leaving the sale. */
export default function TillReturnSheet({ onClose, restoreFocusTo }: TillReturnSheetProps) {
  const { t } = useTranslation('tillReturns');
  const { user } = useAuth();
  const { currentTenant, currentSite } = useTenant();
  const owner = `${currentTenant?.id ?? ''}:${user?.id ?? ''}`;
  const draftKey = `${owner}:${currentSite?.id ?? ''}`;
  const draft = rememberedDraft?.key === draftKey ? rememberedDraft : null;
  const [receipt, setReceipt] = useState<PickedReceipt | null>(() => draft?.receipt ?? null);
  const lookupRef = useRef<HTMLInputElement>(null);

  const changeReceipt = (next: PickedReceipt | null) => {
    rememberedDraft = null;
    setReceipt(next);
  };

  return (
    <Drawer
      isOpen
      onClose={onClose}
      ariaLabel={t('title')}
      showCloseButton={false}
      backdrop="clear"
      size="xl"
      restoreFocusTo={restoreFocusTo}
      initialFocusRef={receipt ? undefined : lookupRef}
      testId="till-return-sheet"
      pinnedContent={
        <div className="till-incident-header">
          <div className="flex min-w-0 items-center gap-3">
            {receipt ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => changeReceipt(null)}
                aria-label={t('otherReceipt')}
                data-testid="till-return-back"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </Button>
            ) : (
              <kbd className="pv-kbd till-incident-letter" aria-hidden="true">
                D
              </kbd>
            )}
            <div className="min-w-0">
              <h2 className="till-incident-title truncate">{t('title')}</h2>
              {receipt && (
                <p
                  className="break-words font-mono text-sm text-fg2"
                  data-testid="till-return-receipt"
                >
                  {[
                    receipt.saleNumber,
                    receipt.completedAt &&
                      receiptTime(receipt.completedAt, time => t('today', { time })),
                    receipt.registerName,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
            {receipt?.scanned && (
              <span className="till-return-read" data-testid="till-return-read">
                <ScanBarcode className="h-4 w-4" aria-hidden="true" />
                {t('read')}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            className="shrink-0"
            onClick={onClose}
            data-testid="till-return-close"
          >
            {t('close')}
            <kbd className="pv-kbd hidden sm:inline-flex" aria-hidden="true">
              Esc
            </kbd>
          </Button>
        </div>
      }
    >
      {receipt ? (
        <ReturnForm
          key={receipt.id}
          receipt={receipt}
          owner={owner}
          draftKey={draftKey}
          draft={draft}
          onDone={() => {
            rememberedDraft = null;
            onClose();
          }}
        />
      ) : (
        <ReceiptLookup inputRef={lookupRef} onPick={changeReceipt} />
      )}
    </Drawer>
  );
}

function receiptTime(iso: string, todayAt: (time: string) => string) {
  const timeZone = getActiveTenantLocale()?.timezone;
  const sameDay = timeZone
    ? calendarDayAt(new Date(iso), timeZone) === calendarDayAt(new Date(), timeZone)
    : new Date(iso).toDateString() === new Date().toDateString();
  if (!sameDay) {
    return formatDate(iso, { dateStyle: 'short', timeStyle: 'short' });
  }
  return todayAt(formatDate(iso, { dateStyle: undefined, timeStyle: 'short' }));
}

function ReceiptLookup({
  inputRef,
  onPick,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (receipt: PickedReceipt) => void;
}) {
  const { t } = useTranslation('tillReturns');
  const utils = trpc.useUtils();
  const today = trpc.sales.returnableToday.useQuery(undefined, { staleTime: 15_000 });
  const [code, setCode] = useState('');
  const [lookupError, setLookupError] = useState<'missing' | 'failed' | null>(null);
  const [isLooking, setIsLooking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || isLooking) return;
    setIsLooking(true);
    try {
      const found = await utils.sales.findByReceipt.fetch({ code: trimmed });
      if (found) {
        onPick({ ...found, scanned: true });
      } else {
        setLookupError('missing');
        setCode('');
      }
    } catch {
      setLookupError('failed');
    } finally {
      setIsLooking(false);
    }
  };

  return (
    <div className="till-incident-form">
      <form onSubmit={event => void submit(event)} data-testid="till-return-lookup">
        <label className="till-incident-field">
          <span>{t('lookup.label')}</span>
          <input
            ref={inputRef}
            className="input min-h-12 font-mono text-lg"
            value={code}
            maxLength={512}
            autoComplete="off"
            onChange={event => {
              setCode(event.target.value);
              setLookupError(null);
            }}
            data-testid="till-return-code"
          />
        </label>
        {lookupError && (
          <p className="mt-2 text-sm font-medium text-danger-700" role="alert">
            {t(lookupError === 'missing' ? 'lookup.missing' : 'lookup.failed')}
          </p>
        )}
      </form>

      <section aria-labelledby="till-return-today">
        <h3 id="till-return-today" className="sales-cap mb-2">
          {t('lookup.today')}
        </h3>
        {today.error && (
          <p className="text-sm text-danger-700" role="alert">
            {t('lookup.todayError')}
          </p>
        )}
        {today.data && today.data.length === 0 && (
          <p className="text-sm text-fg2" data-testid="till-return-today-empty">
            {t('lookup.todayEmpty')}
          </p>
        )}
        {today.data && today.data.length > 0 && (
          <ul className="till-incident-results" data-testid="till-return-today-list">
            {today.data.map(row => (
              <li key={row.id}>
                <button
                  type="button"
                  className="till-incident-result till-incident-result-pick"
                  onClick={() => onPick({ ...row, scanned: false })}
                  data-testid={`till-return-sale-${row.saleNumber}`}
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-sm font-semibold text-fg1">
                      {row.saleNumber}
                    </span>
                    <span className="block truncate text-xs text-fg2">
                      {[
                        formatDate(row.completedAt, { dateStyle: undefined, timeStyle: 'short' }),
                        row.registerName,
                        row.customerName,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 font-numeric font-semibold text-fg1">
                    {formatCurrency(row.total, row.currencyCode)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface ReturnFormProps {
  receipt: PickedReceipt;
  owner: string;
  draftKey: string;
  draft: ReturnDraft | null;
  onDone: () => void;
}

function ReturnForm(props: ReturnFormProps) {
  const { receipt } = props;
  const { t } = useTranslation('tillReturns');
  const saleQuery = trpc.sales.getById.useQuery({ id: receipt.id });
  const sale = saleQuery.data as Sale | undefined;

  if (saleQuery.error) {
    return (
      <p className="text-sm text-danger-700" role="alert">
        {t('loadError')}
      </p>
    );
  }
  if (!sale) {
    return (
      <p className="text-sm text-fg2" role="status">
        {t('loading')}
      </p>
    );
  }
  return <LoadedReturnForm sale={sale} {...props} />;
}

function LoadedReturnForm({
  sale,
  receipt,
  owner,
  draftKey,
  draft,
  onDone,
}: ReturnFormProps & { sale: Sale }) {
  const { t } = useTranslation(['tillReturns', 'sales', 'returnErrors', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const selection = useReturnSelection(sale, {
    initialLines: draft?.lines,
    preselectSingleLine: true,
  });
  const [reason, setReason] = useState<TillReturnReason | null>(draft?.reason ?? null);
  const [destination, setDestination] = useState<ReturnDestination>(
    draft?.destination ?? 'original'
  );
  const [showPin, setShowPin] = useState(false);
  const previewState = useReturnPreview({ saleId: sale.id, selection, destination });
  const { preview } = previewState;
  const refundAmount = preview?.refundAmount ?? 0;
  const approvalRule = preview?.approval;
  const approvalRequired = approvalRule?.required === true;
  const approval = useManagerApproval({
    action: 'sale_refund',
    resourceType: 'sale',
    resourceId: sale.id,
    summary: {
      label: sale.saleNumber,
      // The grant covers the sale, so it is asked for everything still returnable.
      amount: Number(sale.returnableAmount ?? sale.total),
      currencyCode: sale.currencyCode ?? 'COP',
    },
    enabled: approvalRequired,
  });
  const view = approval.views[0]!;
  const isPending = view.status === 'pending';
  const needsApproval = approvalRequired && !approval.allApproved;

  // Only a return waiting on a manager survives closing the sheet.
  const awaitingManager = isPending || view.status === 'approved';
  useEffect(() => {
    rememberedDraft = awaitingManager
      ? { key: draftKey, receipt, lines: selection.lines, reason, destination }
      : null;
  }, [awaitingManager, draftKey, receipt, selection.lines, reason, destination]);

  const returnMutation = useCriticalMutation('sales.returnSale', {
    onSuccess: async result => {
      await invalidateAfterReturn(utils);
      toast.success({
        title: t('done', { amount: formatCurrency(refundAmount, sale.currencyCode) }),
      });
      const saleReturn = (result as Sale).returns?.at(-1);
      if (reason === EXCHANGE_REASON && saleReturn) {
        startExchange(sale, saleReturn.id, owner);
        toast.success({ title: t('sales:details.toast.exchangeStartedTitle') });
      }
      onDone();
    },
    onError: error => {
      // An expired grant or a changed rule shows up only after a fresh read.
      void approval.refetch();
      void previewState.refetch();
      onErrorToast(toast, t, {
        titleKey: 'sales:details.toast.refundErrorTitle',
        fallbackKey: 'sales:details.toast.refundErrorFallback',
      })(error);
    },
  });

  const ready =
    selection.canPreview &&
    reason !== null &&
    preview !== undefined &&
    !previewState.isFetching &&
    previewState.error === null &&
    previewState.referencesAreValid;
  const reasonLabel = reason ? t(`reasons.${reason}`) : '';
  const canRequest =
    RETRYABLE_APPROVAL_STATUSES.has(view.status) && !approval.isRequesting && !approval.isLoading;

  const requestApproval = () => {
    if (!ready || !canRequest) return;
    approval.requestApproval('sale_refund', reasonLabel);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || returnMutation.isPending) return;
    if (needsApproval) {
      requestApproval();
      return;
    }
    returnMutation.mutate({
      id: sale.id,
      items: selection.selectedItems,
      destination,
      reason: reason!,
      ...(previewState.referenceRows.length > 0
        ? { externalReferences: previewState.referenceRows }
        : {}),
      ...(approval.approvalRequestId ? { approvalRequestId: approval.approvalRequestId } : {}),
    });
  };

  const pinHere = () => {
    setShowPin(true);
    if (!isPending) requestApproval();
  };

  const primaryLabel = needsApproval
    ? isPending
      ? t('approval.waiting')
      : t('approval.request')
    : returnMutation.isPending
      ? t('processing')
      : t('confirm', { amount: formatCurrency(refundAmount, sale.currencyCode) });
  const primaryDisabled =
    !ready || returnMutation.isPending || (needsApproval && (isPending || !canRequest));

  if (selection.returnableLines.length === 0) {
    return (
      <p className="text-sm text-fg2" data-testid="till-return-nothing">
        {t('nothingLeft')}
      </p>
    );
  }

  return (
    <form
      className="till-incident-form min-h-full"
      onSubmit={submit}
      data-testid="till-return-form"
    >
      <ul className="till-return-lines" aria-label={t('lines')}>
        {selection.returnableLines.map(line => (
          <ReturnLineRow
            key={line.id}
            line={line}
            selection={selection}
            currencyCode={sale.currencyCode}
          />
        ))}
      </ul>
      {!selection.selectionIsValid && (
        <p className="text-sm text-danger-700" role="alert">
          {t('sales:refund.selectionInvalid')}
        </p>
      )}

      <ChipRadioGroup
        name="till-return-reason"
        legend={t('reason')}
        options={TILL_RETURN_REASONS}
        value={reason}
        onChange={setReason}
        labelFor={option => t(`reasons.${option}`)}
        testIdPrefix="till-return-reason"
      />

      {sale.customerId && (
        <ChipRadioGroup
          name="till-return-destination"
          legend={t('destination.label')}
          options={RETURN_DESTINATIONS}
          value={destination}
          onChange={setDestination}
          labelFor={option => t(`destination.${option}`)}
          testIdPrefix="till-return-destination"
        />
      )}

      <ReturnExternalReferences preview={previewState} currencyCode={sale.currencyCode} />

      <div className="till-return-footer">
        <RefundAmount
          preview={previewState}
          destination={destination}
          currencyCode={sale.currencyCode}
        />

        {approvalRule?.required && (
          <ReturnApprovalNote
            rule={approvalRule}
            view={view}
            approved={approval.allApproved}
            failed={approval.error !== null}
            currencyCode={sale.currencyCode}
          />
        )}

        {showPin && needsApproval && isPending && view.requestId && (
          <Suspense fallback={null}>
            <LazyInlineApprovalDecision
              action="sale_refund"
              requestId={view.requestId}
              onDecided={async () => {
                await approval.refetch();
              }}
            />
          </Suspense>
        )}

        {previewState.error && (
          <p className="text-sm text-danger-700" role="alert">
            {previewState.error}
          </p>
        )}

        <div className="till-return-actions">
          <button
            type="submit"
            className="btn-primary till-incident-submit flex-1 justify-center"
            disabled={primaryDisabled}
            data-testid="till-return-submit"
          >
            {primaryLabel}
            {!primaryDisabled && (
              <kbd className="pv-kbd" aria-hidden="true">
                <CornerDownLeft className="h-3.5 w-3.5" />
              </kbd>
            )}
          </button>
          {needsApproval && !showPin && (
            <button
              type="button"
              className="btn-outline till-incident-submit shrink-0 justify-center px-5 sm:w-auto"
              onClick={pinHere}
              disabled={!ready || (!isPending && !canRequest)}
              data-testid="till-return-pin"
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
              {t('approval.pin')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function ReturnLineRow({
  line,
  selection,
  currencyCode,
}: {
  line: SaleItem;
  selection: ReturnSelection;
  currencyCode: string | undefined;
}) {
  const { t } = useTranslation('tillReturns');
  const name = lineName(line);
  const remaining = lineRemaining(line);
  const quantity = selection.selectedQuantities[line.id];
  const selected = quantity !== undefined;
  return (
    <li data-testid={`till-return-line-${line.id}`}>
      <div className="till-return-line">
        <label className="flex min-w-0 basis-full cursor-pointer items-center gap-3 sm:basis-0 sm:flex-1">
          <input
            type="checkbox"
            className="till-return-check"
            checked={selected}
            onChange={event => selection.selectLine(line, event.target.checked)}
            data-testid={`till-return-check-${line.id}`}
          />
          <span className="text-base font-semibold text-fg1 sm:truncate">{name}</span>
        </label>
        <span className="ml-12 mr-auto flex shrink-0 items-center gap-1 text-sm text-fg2 sm:mx-0">
          {selected && remaining > 1 ? (
            <input
              type="number"
              inputMode="decimal"
              min="0.001"
              max={remaining}
              step="any"
              className="input h-9 w-16 px-2 text-right"
              value={quantity}
              onChange={event => selection.updateLineQuantity(line, Number(event.target.value))}
              aria-label={t('quantityFor', { product: name })}
              data-testid={`till-return-quantity-${line.id}`}
            />
          ) : (
            formatNumber(quantity ?? 0)
          )}
          <span>{t('of', { total: formatNumber(remaining) })}</span>
        </span>
        <span className="w-24 shrink-0 text-right font-numeric text-lg font-bold text-fg1">
          {formatCurrency(Number(line.returnableAmount ?? line.total), currencyCode)}
        </span>
      </div>
      <ReturnLineAllocations line={line} selection={selection} />
    </li>
  );
}

function ReturnApprovalNote({
  rule,
  view,
  approved,
  failed,
  currencyCode,
}: {
  rule: { reason: string | null; limitAmount: number | null };
  view: ApprovalRequestView;
  approved: boolean;
  failed: boolean;
  currencyCode: string | undefined;
}) {
  const { t } = useTranslation(['tillReturns', 'sales']);
  let detail = t('approval.keepSelling');
  if (view.status === 'rejected' && view.decisionReason) {
    detail = t('approval.rejected', { reason: view.decisionReason });
  } else if (view.status === 'pending' && view.requiredApprovals > 1) {
    detail = t('approval.progress', {
      collected: view.approvalsCollected,
      required: view.requiredApprovals,
    });
  }
  return (
    <section
      className={cn('till-return-approval', approved && 'is-approved')}
      aria-live="polite"
      data-testid="till-return-approval"
    >
      {approved ? (
        <p className="flex items-center gap-2 font-semibold">
          <Check className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t('approval.approved')}
        </p>
      ) : (
        <>
          <p className="flex items-start gap-2 font-semibold">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            {t(`approval.rule.${rule.reason ?? 'role'}`, {
              amount: formatCurrency(rule.limitAmount ?? 0, currencyCode),
            })}
          </p>
          <p className="mt-1 pl-7 text-sm">{detail}</p>
        </>
      )}
      {failed && (
        <p className="mt-1 pl-7 text-sm" role="alert">
          {t('sales:approval.statusError')}
        </p>
      )}
    </section>
  );
}

function RefundAmount({
  preview,
  destination,
  currencyCode,
}: {
  preview: ReturnPreviewState;
  destination: ReturnDestination;
  currencyCode: string | undefined;
}) {
  const { t } = useTranslation(['tillReturns', 'sales']);
  const plan = preview.preview;
  const amount = plan?.refundAmount ?? 0;
  const parts = (plan?.allocations ?? []).filter(row => row.amount > 0);
  const destinations = new Set(parts.map(row => row.destination));
  const only = destinations.size === 1 ? parts[0] : undefined;
  let label = t('amount.generic');
  if (only?.destination === 'cash') label = t('amount.cash');
  else if (only?.destination === 'store_credit') label = t('amount.storeCredit');
  else if (only?.destination === 'receivable') label = t('amount.receivable');
  else if (only?.destination === 'external') {
    label = t('amount.external', { method: t(`sales:payment.${only.originalMethod}`) });
  }
  const breakdown =
    destinations.size > 1
      ? parts
          .map(row =>
            t(`amount.part.${row.destination}`, {
              method: t(`sales:payment.${row.originalMethod}`),
              amount: formatCurrency(row.amount, currencyCode),
            })
          )
          .join(' · ')
      : null;
  return (
    <div className="till-return-amount" data-testid="till-return-amount">
      <div className="min-w-0">
        <p className="sales-cap">{label}</p>
        <p className="text-sm text-fg2">
          {breakdown ?? (destination === 'original' ? t('amount.asPaid') : null)}
        </p>
      </div>
      <p
        className="till-return-total"
        aria-live="polite"
        aria-busy={preview.isFetching}
        data-testid="till-return-total"
      >
        {formatCurrency(amount, currencyCode)}
      </p>
    </div>
  );
}
