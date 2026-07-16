/**
 * State + behavior hook for the sale payment modal.
 *
 * ENG-178 — extracted verbatim from the former single-file
 * `SalePaymentModal.tsx` during the megafile decomposition. Owns the
 * react-hook-form instance, the tender field array, all derived flags
 * (grand total, change, credit projection, split validity) and every
 * handler (fast-cash, tip sync, split enable/disable, submit sanitization).
 * The shell calls this and threads the returned bundle into the
 * presentational sections (RHF passed by `form`, not FormProvider). React
 * Compiler is OFF, so every memo/effect dependency array here is
 * behavior-load-bearing and moved exactly as it was.
 *
 * @module features/sales/useSalePaymentModal
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { roundMoney } from '@/lib/money';
import { sumBy } from '@/lib/numbers';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import { useQuickCreateStore } from './useQuickCreateStore';
import type { Customer } from '@/types';
import type { SalePaymentValues } from './salePaymentModal.types';
import { TENDER_SUM_EPSILON, getDefaultValues } from './salePaymentModal.constants';
import { buildCheckoutApprovalContext, requiredCheckoutApprovalActions } from './checkoutApprovals';
import { useCheckoutApprovals } from './useCheckoutApprovals';
import type { CheckoutApprovalItem } from '@puntovivo/shared/checkout-approval';

/**
 * Inputs the modal shell forwards into the hook. Mirrors the subset of
 * `SalePaymentModalProps` the behavior layer needs (`error` / `onClose` stay
 * shell-only); `serviceChargeRate` / `fastCashTrigger` keep their prop
 * defaults (0) so non-restaurant / non-fast-cash flows behave unchanged.
 */
export interface UseSalePaymentModalParams {
  isOpen: boolean;
  total: number;
  customers: Customer[];
  isSaving: boolean;
  serviceChargeRate?: number | undefined;
  userRole?: 'admin' | 'manager' | 'cashier' | 'viewer' | undefined;
  approvalSaleId?: string | null | undefined;
  approvalCustomerId?: string | null | undefined;
  approvalItems?: CheckoutApprovalItem[] | undefined;
  approvalDiscountAmount?: number | undefined;
  currencyCode?: string | undefined;
  fastCashTrigger?: number | undefined;
  onSubmit: (values: SalePaymentValues) => Promise<void>;
}

export function useSalePaymentModal({
  isOpen,
  total,
  customers,
  isSaving,
  serviceChargeRate = 0,
  userRole,
  approvalSaleId = null,
  approvalCustomerId = null,
  approvalItems = [],
  approvalDiscountAmount = 0,
  currencyCode = 'COP',
  fastCashTrigger = 0,
  onSubmit,
}: UseSalePaymentModalParams) {
  const { t } = useTranslation('sales');
  const toast = useToast();
  const [splitMode, setSplitMode] = useState(false);
  // ENG-090 — credit method gating + projection.
  const canLendCredit = userRole === 'admin' || userRole === 'manager' || userRole === 'cashier';
  const isAdmin = userRole === 'admin';
  // ENG-039d3 — service charge is derived from `total × rate / 100`,
  // not a form field. The operator cannot edit it; the server
  // re-validates against the tenant rate at submit time.
  const serviceChargeAmount = useMemo(
    () => (serviceChargeRate > 0 ? roundMoney((total * serviceChargeRate) / 100) : 0),
    [total, serviceChargeRate]
  );
  const form = useForm<SalePaymentValues>({
    defaultValues: {
      ...getDefaultValues(total, serviceChargeAmount, serviceChargeRate),
      customerId: approvalCustomerId ?? '',
    },
  });
  const tenderFields = useFieldArray({
    control: form.control,
    name: 'tenders',
  });
  // ENG-142a — F2 may arrive while the server-owned checkout policy is
  // still loading. A disabled button cannot receive focus, so remember the
  // cashier's intent and restore the fast-cash focus contract as soon as the
  // fail-closed gate becomes submit-ready.
  const pendingFastCashFocusRef = useRef(false);

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
  const pendingCustomerAttachId = useQuickCreateStore(state => state.pendingCustomerAttachId);
  const pendingCustomerReadyToAttach =
    pendingCustomerAttachId !== null &&
    customers.some(customer => customer.id === pendingCustomerAttachId);
  useEffect(() => {
    if (
      !isOpen ||
      approvalSaleId !== null ||
      !pendingCustomerAttachId ||
      !pendingCustomerReadyToAttach
    ) {
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
  }, [
    approvalSaleId,
    isOpen,
    pendingCustomerAttachId,
    pendingCustomerReadyToAttach,
    form,
    t,
    toast,
  ]);

  const paymentMethod = useWatch({ control: form.control, name: 'paymentMethod' }) ?? 'cash';
  const amountReceived = useWatch({ control: form.control, name: 'amountReceived' });
  const watchedTenders = useWatch({ control: form.control, name: 'tenders' });
  const tipAmountWatch = useWatch({ control: form.control, name: 'tipAmount' });
  const tipMethodWatch = useWatch({ control: form.control, name: 'tipMethod' });
  const watchedCustomerId = useWatch({ control: form.control, name: 'customerId' }) ?? '';
  const tenders = useMemo(() => watchedTenders ?? [], [watchedTenders]);
  const amountReceivedValue = Number(amountReceived) || 0;
  const tipAmount = Math.max(0, Number(tipAmountWatch) || 0);
  const grandTotal = roundMoney(total + serviceChargeAmount + tipAmount);
  const isCash = paymentMethod === 'cash';
  const isCredit = paymentMethod === 'credit';

  // ENG-105e — F2 fast-cash apply. Shared by mount-time F2 open
  // and later in-modal F2 presses; always captures the freshest
  // grand total for tip/service-charge edits.
  const applyFastCash = () => {
    if (grandTotal <= 0) return;
    pendingFastCashFocusRef.current = true;
    setSplitMode(false);
    form.setValue('paymentMethod', 'cash', {
      shouldDirty: true,
    });
    form.setValue('amountReceived', grandTotal, {
      shouldDirty: true,
    });
    form.setValue('tenders', []);
    toast.success({ title: t('fastCash.toast.applied') });
    queueMicrotask(() => {
      const confirmButton = document.getElementById(
        'sale-payment-confirm'
      ) as HTMLButtonElement | null;
      if (confirmButton && !confirmButton.disabled) {
        confirmButton.focus();
        pendingFastCashFocusRef.current = false;
      }
    });
  };

  // ENG-105e — apply on F2-open and re-apply when the parent
  // increments the trigger while the modal is already open. The ref
  // indirection (same pattern as useRealtimeChannel) guarantees the
  // deferred call always reads the latest grandTotal — a direct
  // closure would freeze the render-time amount if the microtask were
  // ever deferred further (e.g. a future setTimeout refactor).
  const applyFastCashRef = useRef(applyFastCash);
  applyFastCashRef.current = applyFastCash;
  useEffect(() => {
    if (fastCashTrigger > 0) queueMicrotask(() => applyFastCashRef.current());
  }, [fastCashTrigger]);

  const change = isCash ? Math.max(0, amountReceivedValue - grandTotal) : 0;
  const outstanding = Math.max(0, grandTotal - amountReceivedValue);
  const creditMethodAvailable = canLendCredit && watchedCustomerId.length > 0;

  // ENG-090 — read the active customer's current balance + creditLimit
  // when credit is the active method. The query short-circuits via
  // `enabled` so non-credit flows pay zero contract cost. balance is
  // the running SUM(amount) across the ledger (positive = customer
  // owes); creditLimit comes from the customers row (0 = sin cupo).
  const selectedCustomer = customers.find(c => c.id === watchedCustomerId) ?? null;
  const tenderSum = useMemo(() => sumBy(tenders, tender => Number(tender.amount) || 0), [tenders]);
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
  const tendersAreAllPositive = tenders.every(tender => (Number(tender.amount) || 0) > 0);

  // ENG-014 — the balance query also fires when a split tender row is
  // credit so the V10 card has live data to project against.
  const creditQueryEnabled = creditMethodAvailable && (isCredit || creditAmountInSplit > 0);
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
    creditLimit > 0 && creditProjectionAmount > 0 && projectedBalance > creditLimit;
  // ENG-014 — V10 card surfaces whenever the sale carries a credit
  // portion (legacy single-tender OR split with a credit row).
  const showCreditCard = isCredit || creditAmountInSplit > 0;
  const hasCreditTender = showCreditCard;
  const lossPreventionQueryEnabled =
    isOpen &&
    approvalItems.length > 0 &&
    (userRole === 'cashier' || userRole === 'manager' || userRole === 'admin');
  const lossPreventionQuery = trpc.lossPrevention.evaluateCheckout.useQuery(
    {
      items: approvalItems.map(({ productId, unitId, quantity, unitPrice, discount }) => ({
        productId,
        unitId,
        quantity,
        unitPrice,
        discount,
      })),
      discountAmount: approvalDiscountAmount,
    },
    {
      enabled: lossPreventionQueryEnabled,
      // The blocked-hours decision follows tenant wall-clock time. Keep a
      // long-open checkout fresh across a window boundary without trusting
      // the renderer's clock as policy input.
      refetchInterval: lossPreventionQueryEnabled ? 30_000 : false,
      refetchOnWindowFocus: true,
      staleTime: 0,
    }
  );
  const baselineApprovalActions = requiredCheckoutApprovalActions({
    role: userRole,
    // ENG-142a — the server-owned policy query decides discount authority.
    hasDiscount: false,
    hasCreditTender,
    creditOverrideRequired: hasCreditTender && cupoExceeded,
  });
  const approvalActions = [
    ...new Set([...baselineApprovalActions, ...(lossPreventionQuery.data?.requiredActions ?? [])]),
  ];
  const approvalContext = useMemo(
    () =>
      buildCheckoutApprovalContext({
        saleId: approvalSaleId,
        items: approvalItems,
        values: {
          customerId: approvalSaleId !== null ? (approvalCustomerId ?? '') : watchedCustomerId,
          paymentMethod,
          amountReceived: amountReceivedValue,
          notes: '',
          tenders: splitMode ? tenders : [],
          tipAmount,
          tipMethod: tipAmount > 0 ? (tipMethodWatch ?? 'fixed') : null,
          creditOverride: false,
          serviceChargeAmount,
          serviceChargeRate: serviceChargeRate > 0 ? serviceChargeRate : null,
          approvalRequests: [],
        },
        grandTotal,
        discountAmount: approvalDiscountAmount,
        currencyCode,
      }),
    [
      approvalItems,
      approvalDiscountAmount,
      approvalCustomerId,
      approvalSaleId,
      amountReceivedValue,
      currencyCode,
      grandTotal,
      paymentMethod,
      serviceChargeAmount,
      serviceChargeRate,
      splitMode,
      tenders,
      tipAmount,
      tipMethodWatch,
      watchedCustomerId,
    ]
  );
  const checkoutApprovals = useCheckoutApprovals({
    actions: approvalActions,
    context: approvalContext,
    summaryLabel: t('approval.checkoutSummary', {
      total: formatCurrency(grandTotal, currencyCode),
    }),
    amountByAction: {
      sale_discount: approvalDiscountAmount,
      sale_after_hours: grandTotal,
      credit_sale: approvalContext.creditAmount,
      credit_override: approvalContext.creditAmount,
    },
    currencyCode,
  });

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
    const nextAmount = roundMoney((total * percentage) / 100);
    syncPaymentInputsForTip(nextAmount);
    form.setValue('tipAmount', nextAmount, { shouldDirty: true, shouldValidate: false });
    form.setValue('tipMethod', percentage === 0 ? null : 'percentage', { shouldDirty: true });
  }

  function syncPaymentInputsForTip(nextTipAmount: number): void {
    const previousGrandTotal = grandTotal;
    // ENG-039d3 — service charge is fixed for the cart; only the tip
    // delta moves grandTotal across calls. Including it keeps the
    // auto-sync of amountReceived / first tender consistent.
    const nextGrandTotal = roundMoney(total + serviceChargeAmount + nextTipAmount);

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

  const splitIsValid =
    splitMode &&
    tenders.length >= 2 &&
    Math.abs(tenderDelta) < TENDER_SUM_EPSILON &&
    tendersAreAllPositive;

  const canSubmit =
    !isSaving &&
    (!splitMode || splitIsValid) &&
    checkoutApprovals.allApproved &&
    (!lossPreventionQueryEnabled ||
      (!lossPreventionQuery.isFetching && lossPreventionQuery.error === null)) &&
    !(hasCreditTender && creditBalanceQuery.isLoading);

  const handleSubmit = form.handleSubmit(values => {
    // A held/repeated F1 (or Enter) fires requestSubmit() straight at the
    // form, bypassing the disabled footer button — without this guard a
    // single checkout can submit twice with two distinct idempotency
    // envelopes and double-charge the sale.
    // ENG-142a — requestSubmit also bypasses the footer's disabled state
    // while policy evaluation or an exact approval is still outstanding.
    if (!canSubmit) {
      return;
    }
    const sanitizedTip = Math.max(0, Number(values.tipAmount) || 0);
    // ENG-090 / ENG-106c2 — admins opt into an override directly;
    // non-admins may carry it only when this exact checkout has an approved
    // credit_override request. Stale form state cannot elevate a later cart.
    // ENG-014 — also accept override when split mode carries a
    // credit tender ("apartado"). Non-credit sales (split or single)
    // never pass override through.
    const hasSplitCredit = splitMode && values.tenders.some(tender => tender.method === 'credit');
    const hasApprovedCreditOverride = checkoutApprovals.approvalRequests.some(
      approval => approval.action === 'credit_override'
    );
    const sanitizedOverride =
      (isAdmin || hasApprovedCreditOverride) &&
      (values.paymentMethod === 'credit' || hasSplitCredit)
        ? values.creditOverride || hasApprovedCreditOverride
        : false;
    return onSubmit({
      ...values,
      tenders: splitMode ? values.tenders : [],
      tipAmount: sanitizedTip,
      tipMethod: sanitizedTip > 0 ? (values.tipMethod ?? 'fixed') : null,
      // ENG-039d3 — service charge is derived from the prop rate, not
      // operator-editable, so submit always carries the freshly
      // computed pair. `serviceChargeRate: null` signals "no charge
      // configured" to the server.
      serviceChargeAmount,
      serviceChargeRate: serviceChargeRate > 0 ? serviceChargeRate : null,
      creditOverride: sanitizedOverride,
      approvalRequests: checkoutApprovals.approvalRequests,
    });
  });

  useEffect(() => {
    if (!isOpen) {
      pendingFastCashFocusRef.current = false;
      return;
    }
    if (!canSubmit || !pendingFastCashFocusRef.current) {
      return;
    }

    const confirmButton = document.getElementById(
      'sale-payment-confirm'
    ) as HTMLButtonElement | null;
    if (confirmButton && !confirmButton.disabled) {
      confirmButton.focus();
      pendingFastCashFocusRef.current = false;
    }
  }, [canSubmit, isOpen]);

  const checkoutApprovalState = {
    ...checkoutApprovals,
    isLoading: checkoutApprovals.isLoading || lossPreventionQuery.isFetching,
    error: checkoutApprovals.error ?? lossPreventionQuery.error,
    refetch: async () => {
      await Promise.all([
        checkoutApprovals.refetch(),
        ...(lossPreventionQueryEnabled ? [lossPreventionQuery.refetch()] : []),
      ]);
    },
  };

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

  return {
    form,
    tenderFields,
    splitMode,
    serviceChargeAmount,
    tipAmount,
    grandTotal,
    amountReceivedValue,
    change,
    outstanding,
    paymentMethod,
    isCash,
    isCredit,
    isAdmin,
    creditMethodAvailable,
    selectedCustomer,
    creditAmountInSplit,
    currentBalance,
    creditLimit,
    projectedBalance,
    cupoExceeded,
    showCreditCard,
    balanceLoading: creditBalanceQuery.isLoading,
    checkoutApprovals: checkoutApprovalState,
    tenderSum,
    tenderDelta,
    splitIsValid,
    canSubmit,
    handleSubmit,
    handleTipPreset,
    syncPaymentInputsForTip,
    handleEnableSplit,
    handleDisableSplit,
    presetActive,
  };
}
