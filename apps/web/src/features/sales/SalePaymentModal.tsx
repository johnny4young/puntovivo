/**
 * Sale payment drawer shell.
 *
 * decomposed from the former 1048-LOC single file during the
 * megafile wave. This shell keeps the Drawer wrapper, the grand-total header,
 * the service-charge line, the customer picker, the notes field, the footer,
 * and composes the tip / single-tender / split-tender / credit sub-components.
 * All state + behavior live in `useSalePaymentModal`; the public surface
 * (`SalePaymentModal` + the re-exported value types) is unchanged so the
 * sibling importers (SalesModals, SalesPage, checkoutPayment) resolve the same
 * names at the same path.
 *
 * @module features/sales/SalePaymentModal
 */
import { lazy, Suspense } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Drawer } from '@/components/feedback/Drawer';
import { Button } from '@/components/ui';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { getCartArticleCount } from '@/features/sales/saleCartTotals';
import { ariaKeyshortcutsFor, shortcutDisplayFor } from '@/lib/shortcuts';
import { formatCurrency } from '@/lib/utils';
import { CashChangeHero } from './CashChangeHero';
import { TENDER_SUM_EPSILON } from './salePaymentModal.constants';
import { SaleElectronicInvoiceSection } from './LazySaleElectronicInvoiceSection';
import { asElectronicInvoiceForm } from './electronicInvoiceRequest';
import { useSalePaymentModal } from './useSalePaymentModal';
import { CheckoutApprovalPanel } from './CheckoutApprovalPanel';
import type { SalePaymentModalProps } from './salePaymentModal.types';

const SalePaymentSplitTenderSection = lazy(async () => {
  const module = await import('./SalePaymentSplitTenderSection');
  return { default: module.SalePaymentSplitTenderSection };
});

const SalePaymentSingleTenderSection = lazy(async () => {
  const module = await import('./SalePaymentSingleTenderSection');
  return { default: module.SalePaymentSingleTenderSection };
});

const SalePaymentTransferSection = lazy(async () => {
  const module = await import('./SalePaymentTransferSection');
  return { default: module.SalePaymentTransferSection };
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

export function SalePaymentModal({
  isOpen,
  total,
  consumptionTaxAmount = 0,
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
  fastCashAmount = null,
  initialMethod = 'cash',
  restoreFocusTo,
  activePriceTier = 1,
  allowTip = true,
  onCustomerPriceTierChange,
  onClose,
  onSubmit,
}: SalePaymentModalProps) {
  const { t } = useTranslation(['sales', 'promotions', 'common']);
  const { currencySymbol } = useResolvedLocale();
  const itemCount = getCartArticleCount(approvalItems);
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
    isTransfer,
    transferReferenceValid,
    isAdmin,
    creditMethodAvailable,
    selectedCustomer,
    customerAttached,
    electronicInvoice,
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
    creditDownPayment,
    creditDownPaymentInvalid,
    creditProjectionAmount,
    payableExcess,
    payExcess,
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
    canSubmit,
    handleSubmit,
    handleTipPreset,
    syncPaymentInputsForTip,
    handleEnableSplit,
    handleDisableSplit,
    presetActive,
    setTransferPresentation,
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
    fastCashAmount,
    initialMethod,
    onSubmit,
  });

  const isPartialPayment = !splitMode && !isCredit && outstanding > 0;
  const invoiceRequested =
    useWatch({ control: form.control, name: 'invoiceRequested' }) === true &&
    electronicInvoice.available;
  const confirmLabel = (): string => {
    if (isSaving) return t('payment.processing');
    if (isPartialPayment) {
      return t('payment.confirmPartialAmount', { amount: formatCurrency(outstanding) });
    }
    if (splitMode && Math.abs(tenderDelta) >= TENDER_SUM_EPSILON) {
      return t(tenderDelta < 0 ? 'payment.confirmSplitMissing' : 'payment.confirmSplitOver', {
        amount: formatCurrency(Math.abs(tenderDelta)),
      });
    }
    if (isCredit && !splitMode && !creditDownPaymentInvalid) {
      const credit = formatCurrency(creditProjectionAmount);
      return creditDownPayment > 0
        ? t('payment.confirmCreditWithCash', { credit, cash: formatCurrency(creditDownPayment) })
        : t('payment.confirmCredit', { credit });
    }
    if (isTransfer) {
      return t(invoiceRequested ? 'payment.confirmTransferInvoice' : 'payment.confirmTransfer');
    }
    return invoiceRequested ? t('payment.confirmInvoice') : t('payment.confirm');
  };

  const confirmSale = () => {
    void handleSubmit();
  };

  const totalDetail = [
    ...(serviceChargeAmount > 0 || tipAmount > 0
      ? [t('payment.consumption', { amount: formatCurrency(checkoutBaseTotal) })]
      : []),
    // Promotions reprice lines after the cart computed its tax.
    ...(consumptionTaxAmount > 0 && promotionDiscountAmount === 0
      ? [t('payment.consumptionTaxIncluded', { amount: formatCurrency(consumptionTaxAmount) })]
      : []),
  ];

  const paymentSummary = (
    <div className="sale-pay-summary" data-testid="sale-payment-summary">
      {allowTip && (
        <Suspense fallback={<div className="min-h-[4.75rem]" aria-hidden="true" />}>
          <SalePaymentTipSection
            form={form}
            baseTotal={checkoutBaseTotal}
            tipAmount={tipAmount}
            presetActive={presetActive}
            handleTipPreset={handleTipPreset}
            syncPaymentInputsForTip={syncPaymentInputsForTip}
          />
        </Suspense>
      )}
      <p className="sales-cap">
        <span id="sale-payment-total-label">{t('payment.saleTotal')}</span>
        {itemCount > 0 && ` · ${t('sell.total.items', { count: itemCount })}`}
      </p>
      <p
        className="sale-pay-total-figure"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-labelledby="sale-payment-total-label"
      >
        {formatCurrency(grandTotal)}
      </p>
      {totalDetail.length > 0 && (
        <p className="mt-1 text-xs text-secondary-600" data-testid="sale-payment-total-detail">
          {totalDetail.join(' · ')}
        </p>
      )}
      {promotionQuoteLoading && (
        <p className="mt-2 text-xs text-secondary-600" role="status">
          {t('promotions:checkout.calculating')}
        </p>
      )}
      {!promotionQuoteLoading && promotionDiscountAmount > 0 && (
        <div className="mt-2 border-t border-line pt-2" data-testid="promotion-summary">
          <p className="text-sm font-medium text-success-700">
            {t('promotions:checkout.saved', {
              amount: formatCurrency(promotionDiscountAmount, currencyCode),
            })}
          </p>
          <p className="mt-0.5 text-xs text-secondary-600">
            {appliedPromotions.map(promotion => promotion.name).join(' · ')}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={t('payment.title')}
      size="xl"
      restoreFocusTo={restoreFocusTo}
      testId="sale-payment-drawer"
      pinnedContent={paymentSummary}
      footer={
        <div className="w-full space-y-3">
          {!splitMode && !isCredit && (isCash || isPartialPayment) && (
            <CashChangeHero change={change} outstanding={outstanding} currencyCode={currencyCode} />
          )}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="sale-pay-back"
              onClick={onClose}
              disabled={isSaving}
            >
              {t('payment.back')}
              <kbd className="pv-kbd" aria-hidden="true">
                Esc
              </kbd>
            </Button>
            <Button
              type="button"
              variant="charge"
              className="sales-charge-key sale-pay-confirm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              id="sale-payment-confirm"
              aria-keyshortcuts={ariaKeyshortcutsFor('sales.charge')}
            >
              {confirmLabel()}
              {canSubmit && !isSaving && (
                <kbd className="sales-charge-kbd" aria-hidden="true">
                  {shortcutDisplayFor('sales.charge')}
                </kbd>
              )}
            </Button>
          </div>
        </div>
      }
    >
      <form id="sale-payment-form" className="space-y-4" onSubmit={handleSubmit}>
        {isPartialPayment && (
          <div
            className="rounded-xl border border-warning-300 bg-warning-50 p-4 text-warning-900"
            role="alert"
          >
            <p className="font-semibold">{t('payment.partialTitle')}</p>
            <p className="mt-1 text-sm">
              {t('payment.partialWarning', { amount: formatCurrency(outstanding) })}
            </p>
          </div>
        )}
        {promotionQuoteUnavailable && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 p-4" role="alert">
            <p className="text-sm text-danger-700">
              {promotionQuoteStockError ?? t('promotions:checkout.unavailable')}
            </p>
            {promotionQuoteStockError === null && (
              <button
                type="button"
                className="btn-secondary mt-2 text-sm"
                onClick={retryPromotionQuote}
              >
                {t('promotions:checkout.retry')}
              </button>
            )}
          </div>
        )}
        {!splitMode && (
          <Suspense
            fallback={
              <p className="text-sm text-secondary-500" role="status">
                {t('common:status.loading')}
              </p>
            }
          >
            <SalePaymentSingleTenderSection
              form={form}
              paymentMethod={paymentMethod}
              creditMethodAvailable={creditMethodAvailable}
              isCash={isCash}
              isCredit={isCredit}
              isTransfer={isTransfer}
              grandTotal={grandTotal}
              amountReceivedValue={amountReceivedValue}
              currencySymbol={currencySymbol}
              handleEnableSplit={handleEnableSplit}
            />
          </Suspense>
        )}

        {isTransfer && (
          <Suspense
            fallback={
              <p className="text-sm text-secondary-500" role="status">
                {t('common:status.loading')}
              </p>
            }
          >
            <SalePaymentTransferSection
              form={form}
              grandTotal={grandTotal}
              referenceValid={transferReferenceValid}
              canSubmit={canSubmit}
              isSaving={isSaving}
              onConfirm={confirmSale}
              onPresentationChange={setTransferPresentation}
            />
          </Suspense>
        )}

        {splitMode && (
          <Suspense
            fallback={
              <p className="text-sm text-secondary-500" role="status">
                {t('common:status.loading')}
              </p>
            }
          >
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
              handleDisableSplit={handleDisableSplit}
            />
          </Suspense>
        )}

        {showCreditCard && (
          <Suspense
            fallback={
              <p className="text-sm text-secondary-500" role="status">
                {t('common:status.loading')}
              </p>
            }
          >
            <SaleCreditCustomerCard
              form={form}
              selectedCustomer={selectedCustomer}
              splitMode={splitMode}
              creditAmount={creditProjectionAmount}
              creditDownPaymentInvalid={creditDownPaymentInvalid}
              payableExcess={payableExcess}
              onPayExcess={payExcess}
              currencySymbol={currencySymbol}
              currentBalance={currentBalance}
              creditLimit={creditLimit}
              projectedBalance={projectedBalance}
              cupoExceeded={cupoExceeded}
              isAdmin={isAdmin}
              balanceLoading={balanceLoading}
              balanceUnavailable={balanceUnavailable}
              retryBalance={retryBalance}
            />
          </Suspense>
        )}

        <div>
          <div className="sm:grid sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-3">
            <label htmlFor="sale-payment-customer" className="label">
              {t('payment.customer')}
            </label>
            <select
              id="sale-payment-customer"
              className="input mt-1 sm:mt-0"
              disabled={customerLocked || approvalSaleId !== null}
              {...form.register('customerId')}
            >
              <option value="">{t('payment.walkIn')}</option>
              {/* One keyed list, so the chosen option survives the customer list loading. */}
              {(approvalCustomerId &&
              !customers.some(customer => customer.id === approvalCustomerId)
                ? [
                    {
                      id: approvalCustomerId,
                      name: lockedCustomerName ?? t('payment.lockedCustomer'),
                    },
                    ...customers,
                  ]
                : customers
              ).map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>
          {/* the picked customer's point balance; silent for
           * walk-ins and for customers without points. */}
          {selectedCustomer && (
            <Suspense fallback={null}>
              <CustomerLoyaltyChip customerId={selectedCustomer.id} />
            </Suspense>
          )}
          {!customerLocked &&
            approvalSaleId === null &&
            onCustomerPriceTierChange &&
            (selectedCustomer?.priceTier ?? 1) !== activePriceTier && (
              <button
                type="button"
                className="btn-secondary mt-2 w-full"
                onClick={() => onCustomerPriceTierChange(selectedCustomer?.priceTier ?? 1)}
              >
                {selectedCustomer
                  ? t('payment.priceTier.applyCustomer', {
                      tier: selectedCustomer.priceTier ?? 1,
                    })
                  : t('payment.priceTier.applyWalkIn')}
              </button>
            )}
        </div>

        {electronicInvoice.available && (
          <Suspense fallback={null}>
            <SaleElectronicInvoiceSection
              form={asElectronicInvoiceForm(form)}
              identificationTypes={electronicInvoice.identificationTypes}
              selectedCustomer={selectedCustomer}
              savedCustomers={customers}
            />
          </Suspense>
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
          requestBlockedReason={
            isTransfer && !transferReferenceValid
              ? t('payment.transferQr.approvalNeedsReference')
              : undefined
          }
        />

        {pharmacyCheckout.enabled && (
          <Suspense
            fallback={
              <p className="text-sm text-secondary-500" role="status">
                {t('common:status.loading')}
              </p>
            }
          >
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

        {/* read-only service charge line. Hidden when the
          tenant has no rate configured so non-restaurant operators see
          no extra surface. The amount is derived from the prop rate;
          the server re-validates at submit time.
        */}
        {serviceChargeRate > 0 && (
          <div
            className="rounded-xl border border-secondary-200 p-4"
            aria-label={t('payment.serviceCharge.heading')}
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-secondary-900">
                {t('payment.serviceCharge.heading')}
              </p>
              <p className="text-xs text-secondary-500">{t('payment.serviceCharge.helper')}</p>
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

        {error && (
          <p className="text-sm text-danger-500" role="alert">
            {error}
          </p>
        )}
      </form>
    </Drawer>
  );
}
