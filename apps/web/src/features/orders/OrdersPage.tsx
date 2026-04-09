import { useState } from 'react';
import { ClipboardPlus, Search } from 'lucide-react';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { OrderCartTable } from '@/features/orders/OrderCartTable';
import { OrderDetailsModal } from '@/features/orders/OrderDetailsModal';
import {
  OrderFinalizeModal,
  type OrderFinalizeValues,
} from '@/features/orders/OrderFinalizeModal';
import { OrdersCheckoutPanel } from '@/features/orders/OrdersCheckoutPanel';
import { OrdersHistoryTable } from '@/features/orders/OrdersHistoryTable';
import {
  getOrderCartSummary,
  mergeOrderCartItem,
  updateOrderCartItem,
  type OrderCartItem,
} from '@/features/orders/orderCart';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { formatCurrency, getErrorMessage } from '@/lib/utils';
import type { Category, Order, Provider } from '@/types';

export function OrdersPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { currentSite } = useTenant();
  const [cartItems, setCartItems] = useState<OrderCartItem[]>([]);
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [finalizeModalKey, setFinalizeModalKey] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  const ordersQuery = trpc.orders.list.useQuery({ page: 1, perPage: 50 });
  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 100 });
  const categoriesQuery = trpc.categories.tree.useQuery();

  const createMutation = trpc.orders.create.useMutation({
    onSuccess: async data => {
      await Promise.all([utils.orders.list.invalidate(), utils.orders.getById.invalidate({ id: data.id })]);
      setCartItems([]);
      setOrderError(null);
      setIsFinalizeModalOpen(false);
      toast.success({
        title: 'Purchase order created',
        description: `${data.orderNumber} is ready for supplier follow-up.`,
      });
    },
    onError: error => {
      toast.error({
        title: 'Unable to create purchase order',
        description: getErrorMessage(error, 'Unable to create purchase order'),
      });
    },
  });

  const draftSummary = getOrderCartSummary(cartItems);
  const orders = (ordersQuery.data?.items ?? []) as Order[];
  const providers = ((providersQuery.data?.items ?? []) as Provider[]).filter(
    provider => provider.isActive
  );
  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const submittedOrders = orders.filter(order => order.status === 'submitted');
  const orderTotals = {
    committedTotal: submittedOrders.reduce((sum, order) => sum + order.total, 0),
    providerCount: new Set(submittedOrders.map(order => order.providerId)).size,
  };

  const handleProductSelect = (selection: Parameters<typeof mergeOrderCartItem>[1]) => {
    setCartItems(currentItems => mergeOrderCartItem(currentItems, selection));
    setOrderError(null);
  };

  const handleQuantityChange = (itemKey: string, quantity: number) => {
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updateOrderCartItem(item, { quantity }) : item
      )
    );
  };

  const handleCostChange = (itemKey: string, costPerUnit: number) => {
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updateOrderCartItem(item, { costPerUnit }) : item
      )
    );
  };

  const handleRemoveItem = (itemKey: string) => {
    setCartItems(currentItems => currentItems.filter(item => item.key !== itemKey));
  };

  const handleOpenFinalizeModal = () => {
    if (!currentSite || cartItems.length === 0) {
      return;
    }

    setOrderError(null);
    setFinalizeModalKey(current => current + 1);
    setIsFinalizeModalOpen(true);
  };

  const handleFinalize = async (values: OrderFinalizeValues) => {
    try {
      await createMutation.mutateAsync({
        providerId: values.providerId,
        items: cartItems.map(item => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          costPerUnit: item.costPerUnit,
        })),
        notes: values.notes || undefined,
      });
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : 'Unable to create the purchase order');
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-secondary-900">Purchase Orders</h1>
            <p className="mt-1 text-sm text-secondary-500">
              Prepare supplier orders, track committed spend, and void outdated requests when needed
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
              onClick={handleOpenFinalizeModal}
              disabled={!currentSite || cartItems.length === 0}
            >
              <ClipboardPlus className="h-4 w-4" />
              Create Order
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Submitted Orders</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">{submittedOrders.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Committed Spend</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">
              {formatCurrency(orderTotals.committedTotal)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Providers Used</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">{orderTotals.providerCount}</p>
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
            Select an active site before creating a purchase order so the correct sequential is used.
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-secondary-900">Current Request</h2>
                <p className="text-sm text-secondary-500">
                  Adjust ordered quantities and supplier costs before sending the order
                </p>
              </div>
              <button
                className="btn-ghost"
                onClick={() => setCartItems([])}
                disabled={cartItems.length === 0}
              >
                Clear
              </button>
            </div>

            <OrderCartTable
              items={cartItems}
              onQuantityChange={handleQuantityChange}
              onCostChange={handleCostChange}
              onRemove={handleRemoveItem}
            />
            {orderError && <p className="mt-4 text-sm text-danger-500">{orderError}</p>}
          </div>

          <OrdersCheckoutPanel
            currentSite={currentSite}
            draftSummary={draftSummary}
            canFinalize={!!currentSite && cartItems.length > 0}
            onOpenSearch={() => setIsProductSearchOpen(true)}
            onFinalize={handleOpenFinalizeModal}
          />
        </div>

        <OrdersHistoryTable
          orders={orders}
          isLoading={ordersQuery.isLoading}
          error={ordersQuery.error?.message ?? null}
          onRetry={() => {
            void ordersQuery.refetch();
          }}
          onView={setSelectedOrderId}
        />
      </div>

      <ProductSearchDialog
        isOpen={isProductSearchOpen}
        onClose={() => setIsProductSearchOpen(false)}
        onSelect={handleProductSelect}
        categories={categories}
        providers={providers}
        title="Add Product to Purchase Order"
        confirmLabel="Add to order"
      />

      <OrderFinalizeModal
        key={finalizeModalKey}
        isOpen={isFinalizeModalOpen}
        total={draftSummary.total}
        providers={providers}
        isSaving={createMutation.isPending}
        error={orderError}
        onClose={() => setIsFinalizeModalOpen(false)}
        onSubmit={handleFinalize}
      />

      <OrderDetailsModal
        orderId={selectedOrderId}
        isOpen={!!selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </>
  );
}
