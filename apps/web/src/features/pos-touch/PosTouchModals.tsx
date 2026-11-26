import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/features/auth/AuthContext';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { useRegisterZone } from '@/features/modules/useRegisterZone';
import { CASH_SESSION_OPEN_INVALIDATIONS, invalidateGroups } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { isCashOnlyTender, resolvePayableTotal } from '@/lib/money';
import { percentOf } from '@/features/sales/cashTender';
import { getCheckoutPaymentState } from '@/features/sales/checkoutPayment';
import { SalePaymentModal } from '@/features/sales/SalePaymentModal';
import {
  CashSessionOpenModal,
  type CashSessionOpenValues,
} from '@/features/sales/CashSessionOpenModal';
import type { SalePaymentValues } from '@/features/sales/salePaymentModal.types';
import type { SaleCartItem, SaleCartSummary } from '@/features/sales/saleCart';
import type { Customer, PaymentMethod } from '@/types';

export interface TouchSaleCreateInput {
  customerId?: string | undefined;
  priceTier: 1 | 2 | 3;
  items: Array<{
    productId: string;
    unitId: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxRate: number;
  }>;
  paymentMethod: PaymentMethod;
  paymentStatus: 'paid' | 'partial' | 'pending';
  status: 'completed';
  amountReceived: number;
  discountAmount: number;
  notes?: string | undefined;
  payments?: ReturnType<typeof getCheckoutPaymentState>['payments'];
  tipAmount?: number | undefined;
  tipMethod?: 'fixed' | 'percentage' | undefined;
  serviceChargeAmount?: number | undefined;
  serviceChargeRate?: number | undefined;
  creditOverride?: SalePaymentValues['creditOverride'];
  approvalRequests?: SalePaymentValues['approvalRequests'];
  pharmacyEvidenceIds: string[];
  electronicInvoice?: SalePaymentValues['electronicInvoice'];
  promotionFingerprint?: string | undefined;
}

interface PosTouchModalsProps {
  isPaymentModalOpen: boolean;
  paymentModalKey: number;
  isCashSessionModalOpen: boolean;
  cartItems: SaleCartItem[];
  summary: SaleCartSummary;
  customers: Customer[];
  selectedCustomerId: string | null;
  currency: string;
  activePriceTier: 1 | 2 | 3;
  isCheckoutLocked: boolean;
  paymentError: string | null;
  onCustomerPriceTierChange: (tier: 1 | 2 | 3) => void;
  onClosePayment: () => void;
  onCloseCashSession: () => void;
  onSubmitSale: (payload: TouchSaleCreateInput) => Promise<void>;
}

export function PosTouchModals({
  isPaymentModalOpen,
  paymentModalKey,
  isCashSessionModalOpen,
  cartItems,
  summary,
  customers,
  selectedCustomerId,
  currency,
  activePriceTier,
  isCheckoutLocked,
  paymentError,
  onCustomerPriceTierChange,
  onClosePayment,
  onCloseCashSession,
  onSubmitSale,
}: PosTouchModalsProps) {
  const { t } = useTranslation(['posTouch', 'sales']);
  const user = useContext(AuthContext)?.user ?? null;
  const { tenantSettings } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();
  const takesTips = useRegisterZone('tip-split');
  const serviceChargeRate = tenantSettings?.restaurant?.serviceChargeRate ?? 0;
  const cashRoundingStep = tenantSettings?.cashClose?.cashRoundingStep ?? null;
  const [cashSessionError, setCashSessionError] = useState<string | null>(null);

  const openCashSessionMutation = useCriticalMutation('cashSessions.open', {
    onSuccess: async cashSession => {
      await invalidateGroups(utils, CASH_SESSION_OPEN_INVALIDATIONS);
      setCashSessionError(null);
      onCloseCashSession();
      toast.success({
        title: t('sales:cashSession.toast.openSuccessTitle'),
        description: t('sales:cashSession.toast.openSuccessDescription', {
          registerName: cashSession.registerName,
          amount: cashSession.openingFloat,
        }),
      });
    },
    onError: onErrorToast(toast, t, {
      extra: description => setCashSessionError(description),
    }),
  });

  async function handlePaymentSubmit(values: SalePaymentValues) {
    const checkoutBaseTotal = values.promotionTotal ?? summary.total;
    const serviceChargeAmount = percentOf(checkoutBaseTotal, serviceChargeRate);
    const tipAmount = values.tipAmount ?? 0;
    const effectiveStep =
      cashRoundingStep &&
      isCashOnlyTender({
        paymentMethod: values.paymentMethod,
        payments: values.tenders.length > 0 ? values.tenders : undefined,
      })
        ? cashRoundingStep
        : null;
    const { total: payableTotal } = resolvePayableTotal(
      checkoutBaseTotal + serviceChargeAmount + tipAmount,
      currency,
      effectiveStep
    );
    const payment = getCheckoutPaymentState(values, payableTotal);
    await onSubmitSale({
      customerId: values.customerId || undefined,
      priceTier: activePriceTier,
      items: cartItems.map(item => ({
        productId: item.productId,
        unitId: item.unitId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        taxRate: item.taxRate,
      })),
      paymentMethod: payment.paymentMethod,
      paymentStatus: payment.paymentStatus,
      status: 'completed',
      amountReceived: payment.amountReceived,
      discountAmount: 0,
      notes: values.notes || undefined,
      payments: payment.payments,
      tipAmount: tipAmount > 0 ? tipAmount : undefined,
      tipMethod: tipAmount > 0 ? (values.tipMethod ?? undefined) : undefined,
      serviceChargeAmount: serviceChargeAmount > 0 ? serviceChargeAmount : undefined,
      serviceChargeRate: serviceChargeRate > 0 ? serviceChargeRate : undefined,
      creditOverride: values.creditOverride,
      approvalRequests: values.approvalRequests,
      pharmacyEvidenceIds: values.pharmacyEvidenceIds ?? [],
      ...(values.electronicInvoice ? { electronicInvoice: values.electronicInvoice } : {}),
      ...(values.promotionFingerprint ? { promotionFingerprint: values.promotionFingerprint } : {}),
    });
  }

  async function handleOpenCashSessionSubmit(values: CashSessionOpenValues) {
    if (openCashSessionMutation.isPending) return;
    setCashSessionError(null);
    await openCashSessionMutation.mutateAsync(values);
  }

  return (
    <>
      {isPaymentModalOpen && (
        <SalePaymentModal
          key={paymentModalKey}
          isOpen={isPaymentModalOpen}
          total={summary.total}
          consumptionTaxAmount={summary.consumptionTaxAmount}
          customers={customers}
          isSaving={isCheckoutLocked}
          error={paymentError}
          serviceChargeRate={serviceChargeRate}
          cashRoundingStep={cashRoundingStep}
          userRole={user?.role}
          approvalCustomerId={selectedCustomerId}
          approvalItems={cartItems}
          currencyCode={currency}
          activePriceTier={activePriceTier}
          allowTip={takesTips}
          onCustomerPriceTierChange={onCustomerPriceTierChange}
          onClose={onClosePayment}
          onSubmit={handlePaymentSubmit}
        />
      )}
      {isCashSessionModalOpen && (
        <CashSessionOpenModal
          isOpen={isCashSessionModalOpen}
          isSaving={openCashSessionMutation.isPending}
          error={cashSessionError}
          onClose={onCloseCashSession}
          onSubmit={handleOpenCashSessionSubmit}
        />
      )}
    </>
  );
}
