import { useState } from 'react';
import { Receipt, Search } from 'lucide-react';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { SaleCartTable } from '@/features/sales/SaleCartTable';
import { SalesCheckoutPanel } from '@/features/sales/SalesCheckoutPanel';
import { SaleDetailsModal } from '@/features/sales/SaleDetailsModal';
import { SalesHistoryTable } from '@/features/sales/SalesHistoryTable';
import {
  SalePaymentModal,
  type SalePaymentValues,
} from '@/features/sales/SalePaymentModal';
import {
  getCartSummary,
  mergeCartItem,
  updateCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import type { Category, Customer, PaymentStatus, Provider, Sale } from '@/types';

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
  const utils = trpc.useUtils();
  const { currentSite } = useTenant();
  const [cartItems, setCartItems] = useState<SaleCartItem[]>([]);
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentModalKey, setPaymentModalKey] = useState(0);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);

  const salesQuery = trpc.sales.list.useQuery({ page: 1, perPage: 50 });
  const summaryQuery = trpc.sales.summary.useQuery();
  const customersQuery = trpc.customers.list.useQuery({ page: 1, perPage: 100, isActive: true });
  const categoriesQuery = trpc.categories.tree.useQuery();
  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 100 });

  const createMutation = trpc.sales.create.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.sales.list.invalidate(),
        utils.sales.summary.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      setCartItems([]);
      setSaleError(null);
      setIsPaymentModalOpen(false);
    },
  });

  const summary = summaryQuery.data;
  const draftSummary = getCartSummary(cartItems);
  const sales = (salesQuery.data?.items ?? []) as Sale[];
  const customers = ((customersQuery.data?.items ?? []) as Customer[]).filter(
    customer => customer.isActive
  );
  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const providers = ((providersQuery.data?.items ?? []) as Provider[]).filter(
    provider => provider.isActive
  );

  const handleProductSelect = (selection: Parameters<typeof mergeCartItem>[1]) => {
    setCartItems(currentItems => mergeCartItem(currentItems, selection));
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

  const handleOpenPaymentModal = () => {
    if (!currentSite || cartItems.length === 0) {
      return;
    }

    setSaleError(null);
    setPaymentModalKey(current => current + 1);
    setIsPaymentModalOpen(true);
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
      setSaleError(error instanceof Error ? error.message : 'Unable to complete the sale');
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-secondary-900">Sales</h1>
            <p className="mt-1 text-sm text-secondary-500">
              Run POS transactions and review recent completed sales
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-lg border border-secondary-200 px-3 py-2 text-sm">
              <p className="text-secondary-500">Active site</p>
              <p className="font-medium text-secondary-900">{currentSite?.name ?? 'No site selected'}</p>
            </div>
            <button
              className="btn-outline flex items-center gap-2"
              onClick={() => setIsProductSearchOpen(true)}
            >
              <Search className="h-4 w-4" />
              Add Product
            </button>
            <button
              className="btn-primary flex items-center gap-2"
              onClick={handleOpenPaymentModal}
              disabled={!currentSite || cartItems.length === 0}
            >
              <Receipt className="h-4 w-4" />
              Charge Sale
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Today's Sales</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">
              {summaryQuery.isLoading ? '—' : formatCurrency(summary?.todaySalesTotal ?? 0)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Transactions</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">
              {summaryQuery.isLoading ? '—' : summary?.transactionCount ?? 0}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Average Order</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">
              {summaryQuery.isLoading ? '—' : formatCurrency(summary?.averageOrder ?? 0)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Draft Total</p>
            <p className="mt-1 text-2xl font-bold text-primary-700">
              {formatCurrency(draftSummary.total)}
            </p>
          </div>
        </div>

        {!currentSite && (
          <div className="rounded-xl border border-warning-300 bg-warning-50 px-4 py-4 text-sm text-warning-700">
            Select an active site before charging a sale so the correct sequential is used.
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-secondary-900">Current Cart</h2>
                <p className="text-sm text-secondary-500">Adjust quantities, discounts, or remove lines before payment</p>
              </div>
              <button
                className="btn-ghost"
                onClick={() => setCartItems([])}
                disabled={cartItems.length === 0}
              >
                Clear
              </button>
            </div>
            <SaleCartTable
              items={cartItems}
              onQuantityChange={handleQuantityChange}
              onDiscountChange={handleDiscountChange}
              onRemove={handleRemoveItem}
            />
            {saleError && <p className="mt-4 text-sm text-danger-500">{saleError}</p>}
          </div>

          <SalesCheckoutPanel
            currentSite={currentSite}
            draftSummary={draftSummary}
            canCharge={!!currentSite && cartItems.length > 0}
            onOpenSearch={() => setIsProductSearchOpen(true)}
            onCharge={handleOpenPaymentModal}
          />
        </div>

        <SalesHistoryTable
          sales={sales}
          isLoading={salesQuery.isLoading}
          error={salesQuery.error?.message ?? null}
          onView={setSelectedSaleId}
        />
      </div>

      <ProductSearchDialog
        isOpen={isProductSearchOpen}
        onClose={() => setIsProductSearchOpen(false)}
        onSelect={handleProductSelect}
        categories={categories}
        providers={providers}
        title="Add Product to Sale"
        confirmLabel="Add to cart"
      />

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

      <SaleDetailsModal
        saleId={selectedSaleId}
        isOpen={!!selectedSaleId}
        onClose={() => setSelectedSaleId(null)}
      />
    </>
  );
}
