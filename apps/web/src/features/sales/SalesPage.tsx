import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  CashSessionOpenModal,
  type CashSessionOpenValues,
} from '@/features/sales/CashSessionOpenModal';
import { SalesCartWorkspace } from '@/features/sales/SalesCartWorkspace';
import { SalesCheckoutPanel } from '@/features/sales/SalesCheckoutPanel';
import { SaleDetailsModal } from '@/features/sales/SaleDetailsModal';
import { SalesHistoryTable } from '@/features/sales/SalesHistoryTable';
import { SalesMobileCheckoutBar } from '@/features/sales/SalesMobileCheckoutBar';
import { SalesOverview } from '@/features/sales/SalesOverview';
import {
  SalePaymentModal,
  type SalePaymentValues,
} from '@/features/sales/SalePaymentModal';
import {
  getCartItemKey,
  getCartSummary,
  mergeCartItem,
  updateCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import { getActiveCartSelectionKey } from '@/features/sales/salesKeyboard';
import { useSalesInputFocus } from '@/features/sales/useSalesInputFocus';
import { useSalesKeyboardShortcuts } from '@/features/sales/useSalesKeyboardShortcuts';
import { useTenant } from '@/features/tenant/TenantProvider';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import type { CashSession, Category, Customer, PaymentStatus, Provider, Sale } from '@/types';
function getRequestedPaymentStatus(values: SalePaymentValues, total: number): PaymentStatus {
  if (values.paymentMethod === 'credit') {
    return 'pending';
  }

  if (values.amountReceived >= total) {
    return 'paid';
  }

  if (values.amountReceived > 0) {
    return 'partial';
  }

  return 'pending';
}

export function SalesPage() {
  const { t } = useTranslation(['sales', 'errors']);
  const utils = trpc.useUtils();
  const toast = useToast();
  const { currentSite } = useTenant();
  const [cartItems, setCartItems] = useState<SaleCartItem[]>([]);
  const [selectedCartItemKey, setSelectedCartItemKey] = useState<string | null>(null);
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchInitialQuery, setProductSearchInitialQuery] = useState('');
  const [productSearchDialogKey, setProductSearchDialogKey] = useState(0);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentModalKey, setPaymentModalKey] = useState(0);
  const [isCashSessionModalOpen, setIsCashSessionModalOpen] = useState(false);
  const [cashSessionModalKey, setCashSessionModalKey] = useState(0);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [cashSessionError, setCashSessionError] = useState<string | null>(null);
  const {
    productInputRef,
    focusProductInput,
    focusQuantityInput,
    focusDiscountInput,
    quantityInputRefFor,
    discountInputRefFor,
  } = useSalesInputFocus();
  const salesQuery = trpc.sales.list.useQuery({ page: 1, perPage: 50 });
  const summaryQuery = trpc.sales.summary.useQuery();
  const customersQuery = trpc.customers.list.useQuery({ page: 1, perPage: 100, isActive: true });
  const categoriesQuery = trpc.categories.tree.useQuery();
  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 100 });
  const activeCashSessionQuery = trpc.cashSessions.getActive.useQuery(
    { siteId: currentSite?.id },
    {
      enabled: !!currentSite,
    }
  );

  const createMutation = trpc.sales.create.useMutation({
    onSuccess: async (_data, variables) => {
      await Promise.all([
        utils.cashSessions.getActive.invalidate(),
        utils.sales.list.invalidate(),
        utils.sales.summary.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      setCartItems([]);
      setSelectedCartItemKey(null);
      setProductSearchQuery('');
      setSaleError(null);
      setIsPaymentModalOpen(false);
      toast.success({
        title: t('toast.success'),
        description: `${variables.items.length} ${t('toast.successDetail')}`,
      });
    },
    onError: error => {
      toast.error({
        title: t('toast.error'),
        description: getServerErrorMessage(error),
      });
    },
  });
  const openCashSessionMutation = trpc.cashSessions.open.useMutation({
    onSuccess: async cashSession => {
      await utils.cashSessions.getActive.invalidate();
      setCashSessionError(null);
      setIsCashSessionModalOpen(false);
      toast.success({
        title: t('cashSession.toast.openSuccessTitle'),
        description: t('cashSession.toast.openSuccessDescription', {
          registerName: cashSession.registerName,
          amount: formatCurrency(cashSession.openingFloat),
        }),
      });
    },
    onError: error => {
      const description = getServerErrorMessage(error);
      setCashSessionError(description);
      toast.error({
        title: t('toast.error'),
        description,
      });
    },
  });

  const summary = summaryQuery.data;
  const draftSummary = getCartSummary(cartItems);
  const activeSelectedCartItemKey = getActiveCartSelectionKey(cartItems, selectedCartItemKey);
  const activeCashSession = (activeCashSessionQuery.data as CashSession | null | undefined) ?? null;
  const hasActiveCashSession = !!activeCashSession;
  const canCharge = !!currentSite && hasActiveCashSession && cartItems.length > 0;
  const canOpenCashSession =
    !!currentSite && !hasActiveCashSession && !activeCashSessionQuery.isLoading;
  const sales = (salesQuery.data?.items ?? []) as Sale[];
  const customers = ((customersQuery.data?.items ?? []) as Customer[]).filter(
    customer => customer.isActive
  );
  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const providers = ((providersQuery.data?.items ?? []) as Provider[]).filter(
    provider => provider.isActive
  );

  const getServerErrorMessage = (error: unknown) =>
    translateServerError(error, t, t('errors:server.unknown'));

  const handleProductSelect = (selection: Parameters<typeof mergeCartItem>[1]) => {
    setCartItems(currentItems => mergeCartItem(currentItems, selection));
    setSelectedCartItemKey(getCartItemKey(selection.product.id, selection.unit.unitId));
    setProductSearchQuery('');
    setSaleError(null);
  };

  const handleQuantityChange = (itemKey: string, quantity: number) => {
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updateCartItem(item, { quantity }) : item
      )
    );
  };

  const handleDiscountChange = (itemKey: string, discount: number) => {
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updateCartItem(item, { discount }) : item
      )
    );
  };

  const handleRemoveItem = (itemKey: string) => {
    setCartItems(currentItems => currentItems.filter(item => item.key !== itemKey));
  };

  const handleClearCart = () => {
    setCartItems([]);
    setSelectedCartItemKey(null);
  };

  const handleOpenProductSearch = (initialQuery = productSearchQuery) => {
    setProductSearchInitialQuery(initialQuery.trim());
    setProductSearchDialogKey(current => current + 1);
    setIsProductSearchOpen(true);
  };

  const handleOpenPaymentModal = () => {
    if (!currentSite || cartItems.length === 0) {
      return;
    }

    if (!hasActiveCashSession) {
      handleOpenCashSessionModal();
      return;
    }

    setSaleError(null);
    setPaymentModalKey(current => current + 1);
    setIsPaymentModalOpen(true);
  };

  const handleOpenCashSessionModal = () => {
    if (!currentSite) {
      return;
    }

    setCashSessionError(null);
    setCashSessionModalKey(current => current + 1);
    setIsCashSessionModalOpen(true);
  };

  const handleCreateCashSession = async (values: CashSessionOpenValues) => {
    await openCashSessionMutation.mutateAsync(values);
  };

  const handleCheckout = async (values: SalePaymentValues) => {
    try {
      await createMutation.mutateAsync({
        customerId: values.customerId || undefined,
        items: cartItems.map(item => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
        })),
        paymentMethod: values.paymentMethod,
        paymentStatus: getRequestedPaymentStatus(values, draftSummary.total),
        status: 'completed',
        amountReceived: values.paymentMethod === 'credit' ? 0 : values.amountReceived,
        discountAmount: 0,
        notes: values.notes || undefined,
      });
    } catch (error) {
      setSaleError(getServerErrorMessage(error));
    }
  };

  useSalesKeyboardShortcuts({
    selectedItemKey: activeSelectedCartItemKey,
    canCharge,
    isProductSearchOpen,
    isPaymentModalOpen,
    onOpenSearch: () => handleOpenProductSearch(),
    onOpenPayment: handleOpenPaymentModal,
    onRemoveSelectedItem: handleRemoveItem,
    focusProductInput,
    focusQuantityInput,
    focusDiscountInput,
  });

  return (
    <>
      <div className="space-y-6 pb-24 xl:pb-0">
        <SalesOverview
          currentSiteName={currentSite?.name ?? null}
          isSummaryLoading={summaryQuery.isLoading}
          todaySalesTotal={summary?.todaySalesTotal ?? 0}
          transactionCount={summary?.transactionCount ?? 0}
          averageOrder={summary?.averageOrder ?? 0}
          draftTotal={draftSummary.total}
          canCharge={canCharge}
          canOpenCashSession={canOpenCashSession}
          cashSession={activeCashSession}
          isCashSessionLoading={activeCashSessionQuery.isLoading}
          productSearchQuery={productSearchQuery}
          onProductSearchQueryChange={setProductSearchQuery}
          onOpenSearch={() => handleOpenProductSearch(productSearchQuery)}
          onCharge={handleOpenPaymentModal}
          onOpenCashSession={handleOpenCashSessionModal}
          productInputRef={productInputRef}
        />

        <section className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,360px)]">
          <SalesCartWorkspace
            items={cartItems}
            selectedItemKey={activeSelectedCartItemKey}
            itemCount={draftSummary.itemCount}
            saleError={saleError}
            onQuantityChange={handleQuantityChange}
            onDiscountChange={handleDiscountChange}
            onRemove={handleRemoveItem}
            onSelectItem={setSelectedCartItemKey}
            onClearCart={handleClearCart}
            quantityInputRefFor={quantityInputRefFor}
            discountInputRefFor={discountInputRefFor}
          />

          <SalesCheckoutPanel
            currentSite={currentSite}
            cashSession={activeCashSession}
            isCashSessionLoading={activeCashSessionQuery.isLoading}
            draftSummary={draftSummary}
            canCharge={canCharge}
            canOpenCashSession={canOpenCashSession}
            onOpenSearch={() => handleOpenProductSearch()}
            onCharge={handleOpenPaymentModal}
            onOpenCashSession={handleOpenCashSessionModal}
          />
        </section>

        <SalesHistoryTable
          sales={sales}
          isLoading={salesQuery.isLoading}
          error={salesQuery.error?.message ?? null}
          onRetry={() => {
            void salesQuery.refetch();
          }}
          onView={setSelectedSaleId}
        />
      </div>

      <SalesMobileCheckoutBar
        draftSummary={draftSummary}
        cashSession={activeCashSession}
        canCharge={canCharge}
        canOpenCashSession={canOpenCashSession}
        onOpenSearch={() => handleOpenProductSearch()}
        onCharge={handleOpenPaymentModal}
        onOpenCashSession={handleOpenCashSessionModal}
      />
      {isProductSearchOpen && (
        <ProductSearchDialog
          key={productSearchDialogKey}
          isOpen={isProductSearchOpen}
          onClose={() => setIsProductSearchOpen(false)}
          onSelect={handleProductSelect}
          categories={categories}
          providers={providers}
          initialQuery={productSearchInitialQuery}
          title={t('checkout.addProduct')}
          confirmLabel={t('checkout.addToCart')}
        />
      )}

      {isPaymentModalOpen && (
        <SalePaymentModal
          key={paymentModalKey}
          isOpen={isPaymentModalOpen}
          total={draftSummary.total}
          customers={customers}
          isSaving={createMutation.isPending}
          error={saleError}
          onClose={() => setIsPaymentModalOpen(false)}
          onSubmit={handleCheckout}
        />
      )}

      {isCashSessionModalOpen && (
        <CashSessionOpenModal
          key={cashSessionModalKey}
          isOpen={isCashSessionModalOpen}
          isSaving={openCashSessionMutation.isPending}
          error={cashSessionError}
          onClose={() => setIsCashSessionModalOpen(false)}
          onSubmit={handleCreateCashSession}
        />
      )}

      {selectedSaleId && (
        <SaleDetailsModal
          saleId={selectedSaleId}
          isOpen={!!selectedSaleId}
          onClose={() => setSelectedSaleId(null)}
        />
      )}
    </>
  );
}
