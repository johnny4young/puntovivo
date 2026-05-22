import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { sumBy } from '@/lib/numbers';
import { formatCurrency } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useQuickCreateStore } from './useQuickCreateStore';
import { QuickDenominationSelector } from './QuickDenominationSelector';
import type { Customer, PaymentMethod } from '@/types';

// ENG-014 — split-tender method now mirrors PaymentMethod so a sale
// can mix instant tenders with a credit portion ("apartado"). The
// modal still gates the credit option behind canLendCredit + an
// attached customer; the server enforces the same gate at the router
// and rejects credit tenders without a customerId via Zod refine.
type SplitTenderMethod = PaymentMethod;

// ENG-039d — propina tip method. `null` (the default) means the
// operator did not capture a tip; the server interprets that the same
// as `tipAmount: 0`.
export type SaleTipMethod = 'percentage' | 'fixed';

export interface SalePaymentTenderValue {
  method: SplitTenderMethod;
  amount: number;
  reference: string;
}

export interface SalePaymentValues {
  customerId: string;
  paymentMethod: PaymentMethod;
  amountReceived: number;
  notes: string;
  /**
   * Optional multi-tender breakdown. When non-empty, the server ignores
   * `paymentMethod` + `amountReceived` for persistence and uses this list.
   */
  tenders: SalePaymentTenderValue[];
  /**
   * ENG-039d — tip / propina captured at checkout. `tipAmount` rolls
   * into the persisted total server-side, so split-tender Σ and
   * single-tender `amountReceived` are compared against `total + tip`.
   * `tipMethod` is informational (`percentage` if the operator clicked
   * a preset, `fixed` if they typed a custom amount, `null` when the
   * tip is zero).
   */
  tipAmount: number;
  tipMethod: SaleTipMethod | null;
  /**
   * ENG-090 — admin override for the credit-limit invariant. Only
   * surfaces in the UI when an admin opens the modal and the
   * projected balance exceeds the customer's `creditLimit`. The
   * server still enforces the admin role on the `creditOverride`
   * flag at the router gate.
   */
  creditOverride: boolean;
  /**
   * ENG-039d3 — restaurant service charge / propina sugerida. Auto
   * applied from the tenant's `serviceChargeRate` (a per-tenant
   * percentage). `serviceChargeAmount` rolls into the persisted total
   * after tip so split-tender Σ + single-tender `amountReceived`
   * compare against `total + tip + service`. `serviceChargeRate` is
   * the percentage active at submit time (null when disabled).
   */
  serviceChargeAmount: number;
  serviceChargeRate: number | null;
}

interface SalePaymentModalProps {
  isOpen: boolean;
  total: number;
  customers: Customer[];
  isSaving: boolean;
  error: string | null;
  /**
   * ENG-039d3 — tenant-configured service charge percentage (0–30). The
   * modal hides the entire service section when this is 0; when > 0 it
   * auto-applies `total × rate / 100` as a read-only line and folds it
   * into the grand total. Defaults to 0 so non-restaurant tenants pay
   * zero contract cost.
   */
  serviceChargeRate?: number;
  /**
   * ENG-090 — caller's role drives credit-method gating. Cashier never
   * sees the credit tile; manager + admin do. Admin additionally sees
   * the override checkbox when the projected balance exceeds the
   * customer's cupo. Undefined or any other role hides credit
   * entirely. The server still enforces the gate on
   * `creditOverride: true`.
   */
  userRole?: 'admin' | 'manager' | 'cashier' | 'viewer';
  onClose: () => void;
  onSubmit: (values: SalePaymentValues) => Promise<void>;
}

const TENDER_SUM_EPSILON = 0.005;
// ENG-039d — preset tip percentages. 0% is rendered as "Sin propina"
// so the cashier can explicitly clear after picking 10/15.
const TIP_PRESETS = [0, 10, 15] as const;

function getDefaultValues(
  total: number,
  serviceChargeAmount: number,
  serviceChargeRate: number
): SalePaymentValues {
  return {
    customerId: '',
    paymentMethod: 'cash',
    // ENG-039d3 — seed amountReceived at total+service so the cashier
    // sees the auto-applied service line reflected upfront. Tip layers
    // on later via `syncPaymentInputsForTip`.
    amountReceived: total + serviceChargeAmount,
    notes: '',
    tenders: [],
    tipAmount: 0,
    tipMethod: null,
    serviceChargeAmount,
    serviceChargeRate: serviceChargeRate > 0 ? serviceChargeRate : null,
    creditOverride: false,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function coerceTipAmount(value: unknown): number {
  if (value === '' || value === null || value === undefined) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function SalePaymentModal({
  isOpen,
  total,
  customers,
  isSaving,
  error,
  serviceChargeRate = 0,
  userRole,
  onClose,
  onSubmit,
}: SalePaymentModalProps) {
  const { t } = useTranslation('sales');
  const toast = useToast();
  const [splitMode, setSplitMode] = useState(false);
  // ENG-090 — credit method gating + projection.
  const canLendCredit = userRole === 'admin' || userRole === 'manager';
  const isAdmin = userRole === 'admin';
  // ENG-039d3 — service charge is derived from `total × rate / 100`,
  // not a form field. The operator cannot edit it; the server
  // re-validates against the tenant rate at submit time.
  const serviceChargeAmount = useMemo(
    () => (serviceChargeRate > 0 ? roundCurrency((total * serviceChargeRate) / 100) : 0),
    [total, serviceChargeRate]
  );
  const form = useForm<SalePaymentValues>({
    defaultValues: getDefaultValues(total, serviceChargeAmount, serviceChargeRate),
  });
  const tenderFields = useFieldArray({
    control: form.control,
    name: 'tenders',
  });

  // ENG-105c2 — auto-attach the customer that was just created via the
  // quick-create flow (customer picker or palette dispatch route).
  // The store holds a one-shot `pendingCustomerAttachId`; the gate
  // sets it after a successful `customers.create`, and this effect
  // consumes it on the open transition of the payment modal so the
  // cashier does not have to re-pick from the dropdown.
  //
  // Why the dependency includes `pendingCustomerAttachId`: if the
  // cashier opens the palette WHILE the payment modal is already open
  // (creates the customer mid-flow), the `isOpen` boolean does not
  // re-transition. Tracking the slot id directly catches that path
  // too. The store guarantees consume returns `null` after the first
  // call, so the effect is idempotent on subsequent re-renders.
  //
  // Keep the slot pending until the customer list contains the id. The
  // create mutation invalidates `customers.list`, but the modal can
  // render before the refetch lands; selecting a value with no matching
  // `<option>` makes the native select display Walk-in while form state
  // carries the new id.
  const pendingCustomerAttachId = useQuickCreateStore(
    state => state.pendingCustomerAttachId
  );
  const pendingCustomerReadyToAttach =
    pendingCustomerAttachId !== null &&
    customers.some(customer => customer.id === pendingCustomerAttachId);
  useEffect(() => {
    if (!isOpen || !pendingCustomerAttachId || !pendingCustomerReadyToAttach) {
      return;
    }
    const store = useQuickCreateStore.getState();
    if (store.pendingCustomerAttachId !== pendingCustomerAttachId) {
      return;
    }
    const id = store.consumePendingCustomerAttach();
    if (!id) {
      return;
    }
    form.setValue('customerId', id, { shouldDirty: false, shouldValidate: false });
    toast.success({ title: t('quickCreate.customer.autoAttachToast') });
  }, [isOpen, pendingCustomerAttachId, pendingCustomerReadyToAttach, form, t, toast]);

  const paymentMethod = useWatch({ control: form.control, name: 'paymentMethod' }) ?? 'cash';
  const amountReceived = useWatch({ control: form.control, name: 'amountReceived' });
  const watchedTenders = useWatch({ control: form.control, name: 'tenders' });
  const tipAmountWatch = useWatch({ control: form.control, name: 'tipAmount' });
  const tipMethodWatch = useWatch({ control: form.control, name: 'tipMethod' });
  const watchedCustomerId = useWatch({ control: form.control, name: 'customerId' }) ?? '';
  const tenders = useMemo(() => watchedTenders ?? [], [watchedTenders]);
  const amountReceivedValue = Number(amountReceived) || 0;
  const tipAmount = Math.max(0, Number(tipAmountWatch) || 0);
  const grandTotal = roundCurrency(total + serviceChargeAmount + tipAmount);
  const isCash = paymentMethod === 'cash';
  const isCredit = paymentMethod === 'credit';
  const change = isCash ? Math.max(0, amountReceivedValue - grandTotal) : 0;
  const outstanding = Math.max(0, grandTotal - amountReceivedValue);
  const creditMethodAvailable = canLendCredit && watchedCustomerId.length > 0;

  // ENG-090 — read the active customer's current balance + creditLimit
  // when credit is the active method. The query short-circuits via
  // `enabled` so non-credit flows pay zero contract cost. balance is
  // the running SUM(amount) across the ledger (positive = customer
  // owes); creditLimit comes from the customers row (0 = sin cupo).
  const selectedCustomer = customers.find(c => c.id === watchedCustomerId) ?? null;
  const tenderSum = useMemo(
    () => sumBy(tenders, tender => Number(tender.amount) || 0),
    [tenders]
  );
  // ENG-014 — sum credit tenders in split mode. The V10 customer card
  // surfaces the projected balance based on this portion only (not
  // grandTotal). Outside split mode the value is 0 and the legacy
  // single-tender credit branch still drives the projection.
  const creditAmountInSplit = useMemo(
    () =>
      splitMode
        ? sumBy(
            tenders.filter(tender => tender.method === 'credit'),
            tender => Number(tender.amount) || 0
          )
        : 0,
    [splitMode, tenders]
  );
  const tenderDelta = tenderSum - grandTotal;
  const tendersAreAllPositive = tenders.every(
    tender => (Number(tender.amount) || 0) > 0
  );

  // ENG-014 — the balance query also fires when a split tender row is
  // credit so the V10 card has live data to project against.
  const creditQueryEnabled =
    creditMethodAvailable && (isCredit || creditAmountInSplit > 0);
  const creditBalanceQuery = trpc.customerLedger.getBalance.useQuery(
    { customerId: watchedCustomerId },
    { enabled: creditQueryEnabled, staleTime: 30_000 }
  );
  const currentBalance = creditBalanceQuery.data?.balance ?? 0;
  const creditLimit = selectedCustomer?.creditLimit ?? 0;
  // ENG-014 — the projection sizes to the credit portion only. Pure
  // legacy credit (single-tender) projects against grandTotal as
  // before; split-credit projects against the credit tender sum so
  // the cashier sees "$150 a crédito" rather than the full "$200".
  const creditProjectionAmount = isCredit ? grandTotal : creditAmountInSplit;
  const projectedBalance = currentBalance + creditProjectionAmount;
  const cupoExceeded =
    creditLimit > 0 &&
    creditProjectionAmount > 0 &&
    projectedBalance > creditLimit;
  // ENG-014 — V10 card surfaces whenever the sale carries a credit
  // portion (legacy single-tender OR split with a credit row).
  const showCreditCard = isCredit || creditAmountInSplit > 0;

  useEffect(() => {
    if (paymentMethod !== 'credit' || creditMethodAvailable) {
      return;
    }

    form.setValue('paymentMethod', 'cash', {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue('creditOverride', false, {
      shouldDirty: true,
      shouldValidate: false,
    });
  }, [creditMethodAvailable, form, paymentMethod]);

  function handleTipPreset(percentage: number): void {
    // ENG-039d — percentage base is `total` (subtotal + tax - discount)
    // before tip is layered on. This is the customer-facing "what I
    // owe" amount and matches the LATAM hospitality convention.
    const nextAmount = roundCurrency((total * percentage) / 100);
    syncPaymentInputsForTip(nextAmount);
    form.setValue('tipAmount', nextAmount, { shouldDirty: true, shouldValidate: false });
    form.setValue('tipMethod', percentage === 0 ? null : 'percentage', { shouldDirty: true });
  }

  function syncPaymentInputsForTip(nextTipAmount: number): void {
    const previousGrandTotal = grandTotal;
    // ENG-039d3 — service charge is fixed for the cart; only the tip
    // delta moves grandTotal across calls. Including it keeps the
    // auto-sync of amountReceived / first tender consistent.
    const nextGrandTotal = roundCurrency(total + serviceChargeAmount + nextTipAmount);

    if (splitMode) {
      const currentTenders = form.getValues('tenders');
      const firstTenderAmount = Number(currentTenders[0]?.amount) || 0;
      if (
        currentTenders.length === 1 &&
        Math.abs(firstTenderAmount - previousGrandTotal) < TENDER_SUM_EPSILON
      ) {
        form.setValue('tenders.0.amount', nextGrandTotal, {
          shouldDirty: true,
          shouldValidate: false,
        });
      }
      return;
    }

    if (paymentMethod === 'credit') {
      return;
    }

    const currentAmountReceived = Number(form.getValues('amountReceived')) || 0;
    if (Math.abs(currentAmountReceived - previousGrandTotal) < TENDER_SUM_EPSILON) {
      form.setValue('amountReceived', nextGrandTotal, {
        shouldDirty: true,
        shouldValidate: false,
      });
    }
  }

  function handleEnableSplit(): void {
    if (splitMode) {
      return;
    }
    setSplitMode(true);
    // Seed a first tender row so the cashier only needs to add the remainder.
    tenderFields.append({ method: 'cash', amount: grandTotal, reference: '' });
  }

  function handleDisableSplit(): void {
    if (!splitMode) {
      return;
    }
    setSplitMode(false);
    tenderFields.replace([]);
  }

  const handleSubmit = form.handleSubmit(values => {
    const sanitizedTip = Math.max(0, Number(values.tipAmount) || 0);
    // ENG-090 — credit override is admin-only at the form layer too.
    // The server still gates `true` from non-admin callers at the
    // router; this prevents stale form state (admin opens modal,
    // toggles override on, role swaps mid-flow) from leaking the
    // flag onto the payload.
    // ENG-014 — also accept override when split mode carries a
    // credit tender ("apartado"). Non-credit sales (split or single)
    // never pass override through.
    const hasSplitCredit =
      splitMode && values.tenders.some(tender => tender.method === 'credit');
    const sanitizedOverride =
      isAdmin && (values.paymentMethod === 'credit' || hasSplitCredit)
        ? values.creditOverride
        : false;
    return onSubmit({
      ...values,
      tenders: splitMode ? values.tenders : [],
      tipAmount: sanitizedTip,
      tipMethod: sanitizedTip > 0 ? values.tipMethod ?? 'fixed' : null,
      // ENG-039d3 — service charge is derived from the prop rate, not
      // operator-editable, so submit always carries the freshly
      // computed pair. `serviceChargeRate: null` signals "no charge
      // configured" to the server.
      serviceChargeAmount,
      serviceChargeRate: serviceChargeRate > 0 ? serviceChargeRate : null,
      creditOverride: sanitizedOverride,
    });
  });

  const splitIsValid =
    splitMode &&
    tenders.length >= 2 &&
    Math.abs(tenderDelta) < TENDER_SUM_EPSILON &&
    tendersAreAllPositive;

  const canSubmit = !isSaving && (!splitMode || splitIsValid);

  const presetActive = (percentage: number): boolean => {
    // Zero-tip state — regardless of which method last touched the
    // form, the "No tip" preset reads as active so the cashier sees
    // an unambiguous baseline.
    if (tipAmount === 0) {
      return percentage === 0;
    }
    if (tipMethodWatch !== 'percentage') {
      return false;
    }
    return Math.abs(tipAmount - (total * percentage) / 100) < TENDER_SUM_EPSILON;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('payment.title')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('payment.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isSaving ? t('payment.processing') : t('payment.confirm')}
          </ModalButton>
        </>
      }
    >
      <form id="sale-payment-form" className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
          <p className="text-sm text-primary-700">{t('payment.saleTotal')}</p>
          <p className="mt-1 text-3xl font-semibold text-primary-900">{formatCurrency(grandTotal)}</p>
          {/*
            ENG-039d3 — breakdown line picks one of three i18n keys so
            the renderer never interpolates "+ servicio $0.00" when the
            tenant has no rate configured. Tip-only matches the original
            ENG-039d copy; service-only and service-with-tip add the
            extra segment in neutral LATAM tú.
          */}
          {serviceChargeAmount > 0 && tipAmount > 0 && (
            <p className="mt-1 text-xs text-primary-700">
              {t('payment.serviceCharge.grandTotalBreakdownWithTip', {
                base: formatCurrency(total),
                service: formatCurrency(serviceChargeAmount),
                tip: formatCurrency(tipAmount),
              })}
            </p>
          )}
          {serviceChargeAmount > 0 && tipAmount === 0 && (
            <p className="mt-1 text-xs text-primary-700">
              {t('payment.serviceCharge.grandTotalBreakdownOnly', {
                base: formatCurrency(total),
                service: formatCurrency(serviceChargeAmount),
              })}
            </p>
          )}
          {serviceChargeAmount === 0 && tipAmount > 0 && (
            <p className="mt-1 text-xs text-primary-700">
              {t('payment.tip.grandTotalBreakdown', {
                base: formatCurrency(total),
                tip: formatCurrency(tipAmount),
              })}
            </p>
          )}
        </div>

        {/*
          ENG-039d3 — read-only service charge line. Hidden when the
          tenant has no rate configured so non-restaurant operators see
          no extra surface. The amount is derived from the prop rate;
          the server re-validates at submit time.
        */}
        {serviceChargeRate > 0 && (
          <div
            className="rounded-xl border border-secondary-200 p-4"
            aria-label={t('payment.serviceCharge.heading')}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-secondary-900">
                {t('payment.serviceCharge.heading')}
              </p>
              <p className="text-xs text-secondary-500">
                {t('payment.serviceCharge.helper')}
              </p>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm text-secondary-500">
                {t('payment.serviceCharge.rateLabel', { rate: serviceChargeRate })}
              </span>
              <span className="text-sm font-medium text-secondary-900">
                {formatCurrency(serviceChargeAmount)}
              </span>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="sale-payment-customer" className="label">
            {t('payment.customer')}
          </label>
          <select id="sale-payment-customer" className="input mt-1" {...form.register('customerId')}>
            <option value="">{t('payment.walkIn')}</option>
            {customers.map(customer => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-secondary-200 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-secondary-900">{t('payment.tip.heading')}</p>
            <p className="text-xs text-secondary-500">{t('payment.tip.helper')}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {TIP_PRESETS.map(preset => (
              <button
                key={preset}
                type="button"
                aria-pressed={presetActive(preset)}
                className={
                  presetActive(preset)
                    ? 'btn-primary px-3 py-1.5 text-sm'
                    : 'btn-secondary px-3 py-1.5 text-sm'
                }
                onClick={() => handleTipPreset(preset)}
              >
                {preset === 0
                  ? t('payment.tip.presetZero')
                  : t('payment.tip.presetPercentage', { percentage: preset })}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <label htmlFor="sale-payment-tip-custom" className="label">
              {t('payment.tip.customLabel')}
            </label>
            <input
              id="sale-payment-tip-custom"
              type="number"
              min={0}
              step="0.01"
              className="input mt-1"
              placeholder={t('payment.tip.customPlaceholder')}
              {...form.register('tipAmount', {
                // Mirror the split-tender setValueAs — RHF + valueAsNumber
                // turns cleared inputs into NaN, which would propagate
                // into `grandTotal = total + NaN` and the split-tender
                // Σ comparison. Normalize empty / NaN to 0 at register
                // time so the rest of the form stays numeric.
                setValueAs: coerceTipAmount,
                min: { value: 0, message: t('payment.amountNegative') },
                onChange: event => {
                  // Switching to a custom amount detaches from the
                  // preset state; we mark `tipMethod='fixed'` so the
                  // server can distinguish percentage vs fixed for
                  // reporting. Zero amount falls back to `null` at
                  // submit time.
                  syncPaymentInputsForTip(coerceTipAmount(event.target.value));
                  form.setValue('tipMethod', 'fixed', { shouldDirty: true });
                },
              })}
            />
            {form.formState.errors.tipAmount && (
              <p className="mt-1 text-sm text-danger-500">
                {form.formState.errors.tipAmount.message}
              </p>
            )}
          </div>
        </div>

        {!splitMode && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="sale-payment-method" className="label">
                  {t('payment.paymentMethod')}
                </label>
                <select
                  id="sale-payment-method"
                  className="input mt-1"
                  data-testid="sale-payment-method-select"
                  {...form.register('paymentMethod')}
                >
                  <option value="cash">{t('payment.cash')}</option>
                  <option value="card">{t('payment.card')}</option>
                  <option value="transfer">{t('payment.transfer')}</option>
                  {/* ENG-090 — credit option gated to manager + admin AND
                      requires a customer attached. Cashier never sees it
                      (server router also enforces the role gate on the
                      credit payment method). Walk-in (no customer) hides the
                      option because credit is per-customer by definition. */}
                  {creditMethodAvailable && (
                    <option value="credit" data-testid="sale-payment-method-credit-option">
                      {t('payment.credit')}
                    </option>
                  )}
                  <option value="other">{t('payment.other')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="sale-payment-amount" className="label">
                  {t('payment.amountReceived')}
                </label>
                <input
                  id="sale-payment-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  className="input mt-1"
                  disabled={isCredit}
                  {...form.register('amountReceived', {
                    valueAsNumber: true,
                    min: { value: 0, message: t('payment.amountNegative') },
                  })}
                />
                {form.formState.errors.amountReceived && (
                  <p className="mt-1 text-sm text-danger-500">
                    {form.formState.errors.amountReceived.message}
                  </p>
                )}
              </div>
            </div>

            {isCash && grandTotal > 0 && (
              <QuickDenominationSelector
                total={grandTotal}
                currentValue={amountReceivedValue}
                onSelect={amount =>
                  form.setValue('amountReceived', amount, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
            )}

            {/* ENG-090 — the change/outstanding overlay does not
                apply to credit sales (the entire total is deferred
                onto the ledger). The credit customer card above
                already carries the relevant amounts. */}
            {!isCredit && (
              <div className="surface-panel-muted text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-secondary-500">{t('payment.amountReceived')}</span>
                  <span className="font-medium text-secondary-900">{formatCurrency(amountReceivedValue)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-secondary-500">{isCash ? t('payment.change') : t('payment.balance')}</span>
                  <span className="font-medium text-secondary-900">
                    {formatCurrency(isCash ? change : outstanding)}
                  </span>
                </div>
              </div>
            )}

            {/* ENG-014 — when the single-tender method is already
                credit, splitting is redundant: the operator has
                signaled the entire sale is on account. To split a
                credit portion, the operator starts from a non-credit
                method (cash / card / transfer) and adds a credit row
                inside split mode via the tender selector. */}
            {!isCredit && (
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-2 text-sm"
                onClick={handleEnableSplit}
              >
                <Plus className="h-4 w-4" />
                {t('payment.splitEnable')}
              </button>
            )}
          </>
        )}

        {splitMode && (
          <div className="space-y-3 rounded-xl border border-secondary-200 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-secondary-900">
                {t('payment.splitHeading')}
              </p>
              <button
                type="button"
                className="btn-ghost text-xs text-secondary-600"
                onClick={handleDisableSplit}
              >
                {t('payment.splitDisable')}
              </button>
            </div>
            <p className="text-xs text-secondary-500">{t('payment.splitHelp')}</p>

            <div className="space-y-2">
              {tenderFields.fields.map((field, index) => (
                // `field.id` is react-hook-form's stable UUID for this row.
                // Using it alone (not composed with `index`) keeps DOM nodes
                // stable across removes/reorders so focus and transient input
                // state survive array mutations.
                <div key={field.id} className="grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <select
                    className="input"
                    aria-label={t('payment.splitMethodLabel', { index: index + 1 })}
                    {...form.register(`tenders.${index}.method` as const)}
                  >
                    <option value="cash">{t('payment.cash')}</option>
                    <option value="card">{t('payment.card')}</option>
                    <option value="transfer">{t('payment.transfer')}</option>
                    {/* ENG-014 — credit option in split tender mirrors
                        the single-tender gate: only managers + admins
                        with an attached customer can pick it. The
                        server enforces the same gate via Zod refine
                        + the credit-limit invariant. */}
                    {creditMethodAvailable && (
                      <option
                        value="credit"
                        data-testid={`split-tender-credit-option-${index}`}
                      >
                        {t('payment.credit')}
                      </option>
                    )}
                    <option value="other">{t('payment.other')}</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={t('payment.splitAmountPlaceholder')}
                    aria-label={t('payment.splitAmountLabel', { index: index + 1 })}
                    className="input"
                    {...form.register(`tenders.${index}.amount` as const, {
                      // NOTE: single-tender `amountReceived` above uses
                      // `valueAsNumber: true` because it is a plain field.
                      // Field arrays + `valueAsNumber` have known edge cases
                      // around cleared inputs turning into NaN, which then
                      // poisons `Number(NaN) || 0` comparisons downstream and
                      // blocks Confirm. `setValueAs` normalizes empty to 0 at
                      // registration time.
                      setValueAs: value => {
                        if (value === '' || value === null || value === undefined) {
                          return 0;
                        }
                        const parsed = Number(value);
                        return Number.isFinite(parsed) ? parsed : 0;
                      },
                      min: { value: 0, message: t('payment.amountNegative') },
                    })}
                  />
                  <input
                    type="text"
                    placeholder={t('payment.splitReferencePlaceholder')}
                    aria-label={t('payment.splitReferenceLabel', { index: index + 1 })}
                    className="input"
                    {...form.register(`tenders.${index}.reference` as const)}
                  />
                  <button
                    type="button"
                    className="btn-ghost justify-self-start p-2"
                    onClick={() => tenderFields.remove(index)}
                    aria-label={t('payment.splitRemove', { index: index + 1 })}
                    disabled={tenderFields.fields.length <= 1}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2 text-sm"
              onClick={() => {
                const currentTenderSum = sumBy(
                  form.getValues('tenders'),
                  tender => Number(tender.amount) || 0
                );
                tenderFields.append({
                  method: 'card',
                  amount: Math.max(0, grandTotal - currentTenderSum),
                  reference: '',
                });
              }}
            >
              <Plus className="h-4 w-4" />
              {t('payment.splitAddTender')}
            </button>

            <div className="surface-panel-muted text-sm">
              <div className="flex items-center justify-between">
                <span className="text-secondary-500">{t('payment.splitSum')}</span>
                <span className="font-medium text-secondary-900">{formatCurrency(tenderSum)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-secondary-500">{t('payment.splitDelta')}</span>
                <span
                  className={
                    Math.abs(tenderDelta) < TENDER_SUM_EPSILON
                      ? 'font-medium text-success-600'
                      : 'font-medium text-danger-600'
                  }
                >
                  {tenderDelta >= 0 ? '+' : ''}
                  {formatCurrency(tenderDelta)}
                </span>
              </div>
            </div>

            {!splitIsValid && (
              <p className="text-xs text-secondary-500">
                {t('payment.splitMustMatch')}
              </p>
            )}
          </div>
        )}

        {/* ENG-090 — V10 credit-sale customer card. Shows the
            customer's current balance, cupo, projected balance
            after this sale, and (admin only) an override checkbox
            when the projection exceeds the cupo. ENG-014 lifted
            this out of the !splitMode branch so it surfaces in
            both modes: legacy single-tender credit projects against
            grandTotal; split-credit ("apartado") projects against
            the credit-tender sum only. */}
        {showCreditCard && (
          <div
            className="rounded-xl border border-secondary-200 p-4"
            data-testid="credit-sale-customer-card"
          >
            <p className="text-sm font-medium text-secondary-900">
              {selectedCustomer?.name ?? t('credit.card.unknownCustomer')}
            </p>
            {selectedCustomer?.taxId && (
              <p className="text-xs text-secondary-500">
                {selectedCustomer.taxId}
              </p>
            )}
            {/* ENG-014 — when split mode pushes a partial credit
                amount, surface a one-line summary so the cashier
                sees the breakdown ("$50 efectivo + $150 a crédito"). */}
            {splitMode && creditAmountInSplit > 0 && (
              <p
                className="mt-2 text-xs text-secondary-600"
                data-testid="credit-sale-partial-summary"
              >
                {t('payment.partialCredit.summary', {
                  cashAmount: formatCurrency(grandTotal - creditAmountInSplit),
                  creditAmount: formatCurrency(creditAmountInSplit),
                })}
              </p>
            )}
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div
                className={`rounded border p-2 ${currentBalance > 0 ? 'border-danger-300 bg-danger-50 text-danger-700' : 'border-line bg-white text-secondary-900'}`}
                data-testid="credit-sale-current-balance"
              >
                <p className="text-xs uppercase tracking-wide text-secondary-500">
                  {t('credit.card.balance')}
                </p>
                <p className="mt-1 text-base font-medium tabular-nums">
                  {creditBalanceQuery.isLoading
                    ? '…'
                    : formatCurrency(currentBalance)}
                </p>
              </div>
              <div
                className="rounded border border-line bg-white p-2 text-secondary-900"
                data-testid="credit-sale-cupo"
              >
                <p className="text-xs uppercase tracking-wide text-secondary-500">
                  {t('credit.card.cupo')}
                </p>
                <p className="mt-1 text-base font-medium tabular-nums">
                  {creditLimit > 0
                    ? formatCurrency(creditLimit)
                    : t('credit.card.unlimited')}
                </p>
              </div>
              <div
                className={`rounded border p-2 ${cupoExceeded ? 'border-warning-300 bg-warning-50 text-warning-700' : 'border-line bg-white text-secondary-900'}`}
                data-testid="credit-sale-projected"
              >
                <p className="text-xs uppercase tracking-wide text-secondary-500">
                  {t('credit.card.projected')}
                </p>
                <p className="mt-1 text-base font-medium tabular-nums">
                  {formatCurrency(projectedBalance)}
                </p>
              </div>
            </div>
            {cupoExceeded && (
              <p
                className="mt-3 text-sm text-warning-700"
                data-testid="credit-sale-warning"
              >
                {t('credit.warning.exceedsLimit')}
              </p>
            )}
            {/* Override checkbox: admin only, only when the
                projection actually exceeds the cupo. Submitting
                without it raises the server-side
                CREDIT_LIMIT_EXCEEDED toast. */}
            {cupoExceeded && (
              <label
                className={`mt-3 flex items-start gap-2 text-sm ${isAdmin ? '' : 'opacity-60'}`}
                data-testid="credit-sale-override-label"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  data-testid="credit-sale-override-toggle"
                  disabled={!isAdmin}
                  {...form.register('creditOverride')}
                />
                <span className="flex flex-col">
                  <span className="font-medium">
                    {t('credit.override.label')}
                  </span>
                  <span className="text-xs text-secondary-500">
                    {isAdmin
                      ? t('credit.override.adminHelp')
                      : t('credit.override.adminOnly')}
                  </span>
                </span>
              </label>
            )}
          </div>
        )}

        <div>
          <label htmlFor="sale-payment-notes" className="label">
            {t('payment.notes')}
          </label>
          <textarea
            id="sale-payment-notes"
            className="input mt-1 min-h-[96px]"
            placeholder={t('payment.notesHint')}
            {...form.register('notes')}
          />
        </div>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
