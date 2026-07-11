/**
 * Sale payment drawer shell.
 *
 * ENG-178 — decomposed from the former 1048-LOC single file during the
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
import { useTranslation } from 'react-i18next';

import { Drawer } from '@/components/feedback/Drawer';
import { ModalButton } from '@/components/form-controls/Modal';
import { formatCurrency } from '@/lib/utils';
import { useSalePaymentModal } from './useSalePaymentModal';
import { SalePaymentTipSection } from './SalePaymentTipSection';
import { SalePaymentSingleTenderSection } from './SalePaymentSingleTenderSection';
import { SalePaymentSplitTenderSection } from './SalePaymentSplitTenderSection';
import { SaleCreditCustomerCard } from './SaleCreditCustomerCard';
import type { SalePaymentModalProps } from './salePaymentModal.types';

export type {
  SaleTipMethod,
  SalePaymentTenderValue,
  SalePaymentValues,
} from './salePaymentModal.types';

export function SalePaymentModal({
  isOpen,
  total,
  customers,
  isSaving,
  error,
  serviceChargeRate = 0,
  userRole,
  fastCashTrigger = 0,
  restoreFocusTo,
  onClose,
  onSubmit,
}: SalePaymentModalProps) {
  const { t } = useTranslation('sales');
  const {
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
    balanceLoading,
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
  } = useSalePaymentModal({
    isOpen,
    total,
    customers,
    isSaving,
    serviceChargeRate,
    userRole,
    fastCashTrigger,
    onSubmit,
  });

  const paymentSummary = (
    <div
      className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4 shadow-sm"
      data-testid="sale-payment-summary"
    >
      <p id="sale-payment-total-label" className="text-sm text-primary-800">
        {t('payment.saleTotal')}
      </p>
      <p
        className="mt-1 text-3xl font-semibold text-primary-900"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-labelledby="sale-payment-total-label"
      >
        {formatCurrency(grandTotal)}
      </p>
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
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('payment.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            id="sale-payment-confirm"
          >
            {isSaving ? t('payment.processing') : t('payment.confirm')}
          </ModalButton>
        </>
      }
    >
      <form id="sale-payment-form" className="space-y-4" onSubmit={handleSubmit}>
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
          <label htmlFor="sale-payment-customer" className="label">
            {t('payment.customer')}
          </label>
          <select
            id="sale-payment-customer"
            className="input mt-1"
            {...form.register('customerId')}
          >
            <option value="">{t('payment.walkIn')}</option>
            {customers.map(customer => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <SalePaymentTipSection
          form={form}
          presetActive={presetActive}
          handleTipPreset={handleTipPreset}
          syncPaymentInputsForTip={syncPaymentInputsForTip}
        />

        {!splitMode && (
          <SalePaymentSingleTenderSection
            form={form}
            paymentMethod={paymentMethod}
            creditMethodAvailable={creditMethodAvailable}
            isCash={isCash}
            isCredit={isCredit}
            grandTotal={grandTotal}
            amountReceivedValue={amountReceivedValue}
            change={change}
            outstanding={outstanding}
            handleEnableSplit={handleEnableSplit}
          />
        )}

        {splitMode && (
          <SalePaymentSplitTenderSection
            form={form}
            tenderFields={tenderFields}
            creditMethodAvailable={creditMethodAvailable}
            tenderSum={tenderSum}
            tenderDelta={tenderDelta}
            splitIsValid={splitIsValid}
            grandTotal={grandTotal}
            handleDisableSplit={handleDisableSplit}
          />
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
          />
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
