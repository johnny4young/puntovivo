/** Sale payment sheet: the total, one focused state per tender, and Confirm. */
import { lazy, Suspense, type ReactNode } from 'react';
import { CornerDownLeft, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Drawer } from '@/components/feedback/Drawer';
import { Button } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { TENDER_SUM_EPSILON } from './salePaymentModal.constants';
import { SaleElectronicInvoiceSection } from './LazySaleElectronicInvoiceSection';
import { asElectronicInvoiceForm } from './electronicInvoiceRequest';
import { useSalePaymentModal } from './useSalePaymentModal';
import { CheckoutApprovalPanel } from './CheckoutApprovalPanel';
import { SalePaymentMethodTabs } from './SalePaymentMethodTabs';
import type { SalePaymentModalProps } from './salePaymentModal.types';

const SalePaymentSplitTenderSection = lazy(async () => {
  const module = await import('./SalePaymentSplitTenderSection');
  return { default: module.SalePaymentSplitTenderSection };
});

const SalePaymentSingleTenderSection = lazy(async () => {
  const module = await import('./SalePaymentSingleTenderSection');
  return { default: module.SalePaymentSingleTenderSection };
});

const SalePharmacyEvidenceSection = lazy(async () => {
  const module = await import('./SalePharmacyEvidenceSection');
  return { default: module.SalePharmacyEvidenceSection };
});

const SaleCreditCustomerCard = lazy(async () => {
  const module = await import('./SaleCreditCustomerCard');
  return { default: module.SaleCreditCustomerCard };
});

const SalePaymentTipSection = lazy(async () => {
  const module = await import('./SalePaymentTipSection');
  return { default: module.SalePaymentTipSection };
});

const CustomerLoyaltyChip = lazy(async () => {
  const module = await import('./CustomerLoyaltyChip');
  return { default: module.CustomerLoyaltyChip };
});

export type {
  SaleTipMethod,
  SalePaymentTenderValue,
  SalePaymentValues,
} from './salePaymentModal.types';

// The dialog title becomes the board's small kicker above the total.
const TITLE_DETAIL_CLASS = 'font-sans text-xs font-semibold uppercase tracking-[0.14em] text-fg3';
const SHEET_CLASS =
  '[&_.modal-header]:border-b-0 [&_.modal-header]:pb-0 [&_.modal-header_h2]:font-sans [&_.modal-header_h2]:text-xs [&_.modal-header_h2]:font-semibold [&_.modal-header_h2]:uppercase [&_.modal-header_h2]:tracking-[0.14em] [&_.modal-header_h2]:text-fg3 [&_.drawer-pinned-content]:pt-1';

export function SalePaymentModal({
  isOpen,
  total,
  customers,
  isSaving,
  error,
  serviceChargeRate = 0,
  userRole,
  approvalSaleId = null,
  approvalCustomerId = null,
  customerLocked = false,
  lockedCustomerName = null,
  approvalItems = [],
  approvalDiscountAmount = 0,
  promotionPricingEnabled = true,
  currencyCode = 'COP',
  fastCashTrigger = 0,
  restoreFocusTo,
  activePriceTier = 1,
  allowTip = true,
  initialMethod = 'cash',
  onCustomerPriceTierChange,
  onClose,
  onSubmit,
}: SalePaymentModalProps) {
  const { t } = useTranslation(['sales', 'promotions', 'common']);
  const {
    form,
    tenderFields,
    splitMode,
    checkoutBaseTotal,
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
    customerAttached,
    electronicInvoice,
    invoiceRequested,
    promotionQuoteLoading,
    promotionQuoteUnavailable,
    promotionQuoteStockError,
    promotionDiscountAmount,
    appliedPromotions,
    retryPromotionQuote,
    customerValueLoading,
    customerValueUnavailable,
    customerValueTenderError,
    loyaltyPointsBalance,
    loyaltyRedemptionEnabled,
    loyaltyValuePerPoint,
    storeCreditBalance,
    retryCustomerValue,
    creditAmountInSplit,
    creditDownPayment,
    creditFinancedAmount,
    currentBalance,
    creditLimit,
    projectedBalance,
    cupoExceeded,
    showCreditCard,
    balanceLoading,
    checkoutApprovals,
    balanceUnavailable,
    retryBalance,
    pharmacyCheckout,
    tenderSum,
    tenderDelta,
    splitIsValid,
    transferReferenceMissing,
    canSubmit,
    handleSubmit,
    handleTipPreset,
    syncPaymentInputsForTip,
    handleEnableSplit,
    selectMethod,
    presetActive,
  } = useSalePaymentModal({
    isOpen,
    total,
    customers,
    isSaving,
    serviceChargeRate,
    userRole,
    approvalSaleId,
    approvalCustomerId,
    customerLocked,
    approvalItems,
    approvalDiscountAmount,
    promotionPricingEnabled,
    currencyCode,
    activePriceTier,
    fastCashTrigger,
    initialMethod,
    onSubmit,
  });

  const isPartialPayment = !splitMode && !isCredit && outstanding > 0;
  // A weighed line is one article however many kilos it carries.
  const itemCount = approvalItems.reduce(
    (count, item) => count + (Number.isInteger(item.quantity) ? item.quantity : 1),
    0
  );
  const customerEditable = !customerLocked && approvalSaleId === null;
  const loadingStatus = (
    <p className="text-sm text-fg3" role="status">
      {t('common:status.loading')}
    </p>
  );

  const confirmLabel = (() => {
    if (isSaving) return t('payment.processing');
    if (isPartialPayment) {
      return t('payment.confirmPartialAmount', { amount: formatCurrency(outstanding) });
    }
    if (splitMode && Math.abs(tenderDelta) >= TENDER_SUM_EPSILON) {
      return t(tenderDelta < 0 ? 'payment.confirmSplitMissing' : 'payment.confirmSplitOver', {
        amount: formatCurrency(Math.abs(tenderDelta)),
      });
    }
    if (isCredit && !splitMode) {
      return creditDownPayment > 0
        ? t('payment.confirmCreditWithCash', {
            credit: formatCurrency(creditFinancedAmount),
            cash: formatCurrency(creditDownPayment),
          })
        : t('payment.confirmCredit', { credit: formatCurrency(creditFinancedAmount) });
    }
    if (invoiceRequested) return t('payment.confirmInvoice');
    if (paymentMethod === 'transfer' && !splitMode) return t('payment.confirmTransfer');
    return t('payment.confirm');
  })();

  const breakdownLine = (() => {
    const base = formatCurrency(checkoutBaseTotal);
    const service = formatCurrency(serviceChargeAmount);
    const tip = formatCurrency(tipAmount);
    // One key per combination, so a zero charge is never spelled out.
    if (serviceChargeAmount > 0 && tipAmount > 0) {
      return t('payment.serviceCharge.grandTotalBreakdownWithTip', { base, service, tip });
    }
    if (serviceChargeAmount > 0) {
      return t('payment.serviceCharge.grandTotalBreakdownOnly', { base, service });
    }
    return tipAmount > 0 ? t('payment.tip.grandTotalBreakdown', { base, tip }) : null;
  })();

  const paymentSummary = (
    <div data-testid="sale-payment-summary">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 max-w-full">
          <span id="sale-payment-total-label" className="sr-only">
            {t('payment.saleTotal')}
          </span>
          <p
            className="font-numeric text-5xl leading-none text-foreground wrap-anywhere sm:text-7xl"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-labelledby="sale-payment-total-label"
          >
            {formatCurrency(grandTotal)}
          </p>
        </div>
        <div className="ml-auto min-w-0 max-w-full text-right sm:max-w-[46%]">
          <label htmlFor="sale-payment-customer" className="sr-only">
            {t('payment.customer')}
          </label>
          <select
            id="sale-payment-customer"
            className="min-h-11 w-full min-w-0 cursor-pointer truncate rounded-lg bg-transparent text-right text-sm font-semibold text-fg2 outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-default"
            disabled={!customerEditable}
            {...form.register('customerId')}
          >
            <option value="">{t('payment.walkIn')}</option>
            {approvalCustomerId &&
              !customers.some(customer => customer.id === approvalCustomerId) && (
                <option value={approvalCustomerId}>
                  {lockedCustomerName ?? t('payment.lockedCustomer')}
                </option>
              )}
            {customers.map(customer => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
          <p className="text-sm text-fg3" data-testid="sale-payment-document">
            {t(invoiceRequested ? 'payment.documentInvoice' : 'payment.documentTicket')}
          </p>
        </div>
      </div>
      {breakdownLine && <p className="mt-1.5 text-sm text-fg2">{breakdownLine}</p>}
      {promotionQuoteLoading && (
        <p className="mt-1.5 text-sm text-fg2" role="status">
          {t('promotions:checkout.calculating')}
        </p>
      )}
      {!promotionQuoteLoading && promotionDiscountAmount > 0 && (
        <div className="mt-1.5" data-testid="promotion-summary">
          <p className="text-sm font-semibold text-success-700">
            {t('promotions:checkout.saved', {
              amount: formatCurrency(promotionDiscountAmount, currencyCode),
            })}
          </p>
          <p className="text-sm text-fg2">
            {appliedPromotions.map(promotion => promotion.name).join(' · ')}
          </p>
        </div>
      )}
    </div>
  );

  const customerChips: ReactNode = (
    <>
      {customerEditable && !selectedCustomer && (
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2.5 rounded-[14px] border-[1.5px] border-line-strong bg-surface px-3.5 text-sm font-semibold text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          onClick={() => {
            const picker = document.getElementById('sale-payment-customer');
            if (!(picker instanceof HTMLSelectElement)) return;
            picker.focus();
            // Opens the native list where the browser allows it; focus is the fallback.
            try {
              picker.showPicker?.();
            } catch {
              /* Not user-activated or unsupported: the focused select is enough. */
            }
          }}
          data-testid="sale-payment-add-customer"
        >
          <UserRound className="h-4 w-4" aria-hidden="true" />
          {t('payment.addCustomer')}
        </button>
      )}
      {selectedCustomer && (
        <Suspense fallback={null}>
          <CustomerLoyaltyChip customerId={selectedCustomer.id} />
        </Suspense>
      )}
      {customerEditable &&
        onCustomerPriceTierChange &&
        (selectedCustomer?.priceTier ?? 1) !== activePriceTier && (
          <button
            type="button"
            className="btn-outline min-h-11 px-3.5 text-sm"
            onClick={() => onCustomerPriceTierChange(selectedCustomer?.priceTier ?? 1)}
          >
            {selectedCustomer
              ? t('payment.priceTier.applyCustomer', { tier: selectedCustomer.priceTier ?? 1 })
              : t('payment.priceTier.applyWalkIn')}
          </button>
        )}
    </>
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={t('payment.title')}
      titleDetail={
        itemCount > 0 ? (
          <span className={TITLE_DETAIL_CLASS} data-testid="sale-payment-item-count">
            {t('payment.itemCount', { count: itemCount })}
          </span>
        ) : undefined
      }
      size="xl"
      className={SHEET_CLASS}
      restoreFocusTo={restoreFocusTo}
      testId="sale-payment-drawer"
      pinnedContent={paymentSummary}
      footer={
        <div className="flex w-full gap-2.5">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSaving}
            className="h-16 shrink-0 gap-2.5 rounded-2xl px-5 text-base"
          >
            {t('payment.cancel')}
            <kbd className="pv-kbd" aria-hidden="true">
              Esc
            </kbd>
          </Button>
          <Button
            variant="charge"
            onClick={handleSubmit}
            disabled={!canSubmit}
            id="sale-payment-confirm"
            data-testid="sale-payment-confirm"
            className="h-16 min-w-0 flex-1 gap-3 rounded-2xl px-4 text-xl sm:text-2xl"
          >
            <span className="min-w-0 truncate">{confirmLabel}</span>
            <CornerDownLeft className="hidden h-5 w-5 shrink-0 sm:block" aria-hidden="true" />
          </Button>
        </div>
      }
    >
      <form id="sale-payment-form" className="space-y-4" onSubmit={handleSubmit}>
        {isPartialPayment && (
          <div
            className="rounded-[15px] border-[1.5px] border-warning-500 bg-warning-50 p-4 text-warning-700"
            role="alert"
          >
            <p className="font-semibold">{t('payment.partialTitle')}</p>
            <p className="mt-1 text-sm">
              {t('payment.partialWarning', { amount: formatCurrency(outstanding) })}
            </p>
          </div>
        )}
        {promotionQuoteUnavailable && (
          <div
            className="rounded-[15px] border-[1.5px] border-danger-500 bg-danger-50 p-4"
            role="alert"
          >
            <p className="text-sm text-danger-700">
              {promotionQuoteStockError ?? t('promotions:checkout.unavailable')}
            </p>
            {promotionQuoteStockError === null && (
              <button
                type="button"
                className="btn-outline mt-2 min-h-11 px-3 text-sm"
                onClick={retryPromotionQuote}
              >
                {t('promotions:checkout.retry')}
              </button>
            )}
          </div>
        )}

        <SalePaymentMethodTabs
          form={form}
          paymentMethod={paymentMethod}
          splitMode={splitMode}
          creditMethodAvailable={creditMethodAvailable}
          onSelectMethod={selectMethod}
          onEnableSplit={handleEnableSplit}
        />

        {!splitMode && !isCredit && (
          <Suspense fallback={loadingStatus}>
            <SalePaymentSingleTenderSection
              form={form}
              paymentMethod={paymentMethod}
              isCash={isCash}
              isAdmin={isAdmin}
              grandTotal={grandTotal}
              amountReceivedValue={amountReceivedValue}
              change={change}
              outstanding={outstanding}
              currencyCode={currencyCode}
              transferReferenceMissing={transferReferenceMissing}
            />
          </Suspense>
        )}

        {splitMode && (
          <Suspense fallback={loadingStatus}>
            <SalePaymentSplitTenderSection
              form={form}
              tenderFields={tenderFields}
              creditMethodAvailable={creditMethodAvailable}
              tenderSum={tenderSum}
              tenderDelta={tenderDelta}
              splitIsValid={splitIsValid}
              grandTotal={grandTotal}
              hasCustomer={customerAttached}
              customerValueLoading={customerValueLoading}
              customerValueUnavailable={customerValueUnavailable}
              customerValueTenderError={customerValueTenderError}
              loyaltyPointsBalance={loyaltyPointsBalance}
              loyaltyRedemptionEnabled={loyaltyRedemptionEnabled}
              loyaltyValuePerPoint={loyaltyValuePerPoint}
              storeCreditBalance={storeCreditBalance}
              retryCustomerValue={retryCustomerValue}
            />
          </Suspense>
        )}

        {/* Single-tender credit and a credit row inside a split share this card. */}
        {showCreditCard && (
          <Suspense fallback={loadingStatus}>
            <SaleCreditCustomerCard
              form={form}
              selectedCustomer={selectedCustomer}
              splitMode={splitMode}
              creditAmountInSplit={creditAmountInSplit}
              grandTotal={grandTotal}
              currentBalance={currentBalance}
              creditLimit={creditLimit}
              projectedBalance={projectedBalance}
              cupoExceeded={cupoExceeded}
              isAdmin={isAdmin}
              balanceLoading={balanceLoading}
              balanceUnavailable={balanceUnavailable}
              retryBalance={retryBalance}
              creditDownPayment={creditDownPayment}
            />
          </Suspense>
        )}

        {electronicInvoice.available ? (
          <Suspense fallback={null}>
            <SaleElectronicInvoiceSection
              form={asElectronicInvoiceForm(form)}
              identificationTypes={electronicInvoice.identificationTypes}
              selectedCustomer={selectedCustomer}
              aside={customerChips}
            />
          </Suspense>
        ) : (
          <div className="flex flex-wrap items-center gap-2 empty:hidden">{customerChips}</div>
        )}

        <CheckoutApprovalPanel
          views={checkoutApprovals.views}
          isLoading={checkoutApprovals.isLoading}
          isHashing={checkoutApprovals.isHashing}
          isRequesting={checkoutApprovals.isRequesting}
          hasError={checkoutApprovals.error !== null}
          onRequest={checkoutApprovals.requestApproval}
          onRefresh={() => {
            void checkoutApprovals.refetch();
          }}
        />

        {pharmacyCheckout.enabled && (
          <Suspense fallback={loadingStatus}>
            <SalePharmacyEvidenceSection
              enabled
              isLoading={pharmacyCheckout.isLoading}
              isUnavailable={pharmacyCheckout.isUnavailable}
              countryCode={pharmacyCheckout.countryCode}
              businessDate={pharmacyCheckout.businessDate}
              customerId={form.getValues('customerId') ?? ''}
              customerValid={pharmacyCheckout.customerValid}
              canApproveEvidence={pharmacyCheckout.canApproveEvidence}
              requirements={pharmacyCheckout.requirements}
              selectedEvidenceIds={pharmacyCheckout.selectedEvidenceIds}
              ready={pharmacyCheckout.ready}
              onToggleEvidence={pharmacyCheckout.toggleEvidence}
              onEvidenceApproved={pharmacyCheckout.selectEvidence}
              onRefetch={pharmacyCheckout.refetch}
            />
          </Suspense>
        )}

        {allowTip && (
          <Suspense
            fallback={
              <div
                className="min-h-24 motion-safe:animate-pulse rounded-xl bg-surface-3"
                role="status"
                aria-label={t('common:status.loading')}
              />
            }
          >
            <SalePaymentTipSection
              form={form}
              presetActive={presetActive}
              handleTipPreset={handleTipPreset}
              syncPaymentInputsForTip={syncPaymentInputsForTip}
            />
          </Suspense>
        )}

        {/* Read-only: derived from the tenant rate and re-validated by the server. */}
        {serviceChargeRate > 0 && (
          <div
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[13px] bg-surface-3 px-3.5 py-3 text-sm"
            aria-label={t('payment.serviceCharge.heading')}
          >
            <div>
              <p className="font-semibold text-foreground">{t('payment.serviceCharge.heading')}</p>
              <p className="text-fg2">{t('payment.serviceCharge.helper')}</p>
            </div>
            <p className="text-fg2">
              {t('payment.serviceCharge.rateLabel', { rate: serviceChargeRate })}{' '}
              <span className="font-numeric text-lg text-foreground">
                {formatCurrency(serviceChargeAmount)}
              </span>
            </p>
          </div>
        )}

        <div>
          <label htmlFor="sale-payment-notes" className="label">
            {t('payment.notes')}
          </label>
          <textarea
            id="sale-payment-notes"
            className="input mt-1 min-h-[64px]"
            placeholder={t('payment.notesHint')}
            {...form.register('notes')}
          />
        </div>

        {error && (
          <p className="text-sm text-danger-700" role="alert">
            {error}
          </p>
        )}
      </form>
    </Drawer>
  );
}
