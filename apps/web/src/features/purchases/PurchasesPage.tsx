import { useState } from 'react';
import { PackagePlus, Search } from 'lucide-react';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { PurchaseCartTable } from '@/features/purchases/PurchaseCartTable';
import { PurchasesCheckoutPanel } from '@/features/purchases/PurchasesCheckoutPanel';
import { PurchaseDetailsModal } from '@/features/purchases/PurchaseDetailsModal';
import {
  PurchaseFinalizeModal,
  type PurchaseFinalizeValues,
} from '@/features/purchases/PurchaseFinalizeModal';
import { PurchasesHistoryTable } from '@/features/purchases/PurchasesHistoryTable';
import {
  getPurchaseCartSummary,
  mergePurchaseCartItem,
  updatePurchaseCartItem,
  type PurchaseCartItem,
} from '@/features/purchases/purchaseCart';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { formatCurrency, getErrorMessage } from '@/lib/utils';
import type { Category, Provider, Purchase } from '@/types';

export function PurchasesPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { currentSite } = useTenant();
  const [cartItems, setCartItems] = useState<PurchaseCartItem[]>([]);
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [finalizeModalKey, setFinalizeModalKey] = useState(0);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const purchasesQuery = trpc.purchases.list.useQuery({ page: 1, perPage: 50 });
  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 100 });
  const categoriesQuery = trpc.categories.tree.useQuery();

  const createMutation = trpc.purchases.create.useMutation({
    onSuccess: async (_data, variables) => {
      await Promise.all([
        utils.purchases.list.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      setCartItems([]);
      setPurchaseError(null);
      setIsFinalizeModalOpen(false);
      toast.success({
        title: 'Purchase registered',
        description: `${variables.items.length} item${variables.items.length === 1 ? '' : 's'} added to stock.`,
      });
    },
    onError: error => {
      toast.error({
        title: 'Unable to register purchase',
        description: getErrorMessage(error, 'Unable to register purchase'),
      });
    },
  });

  const draftSummary = getPurchaseCartSummary(cartItems);
  const purchases = (purchasesQuery.data?.items ?? []) as Purchase[];
  const providers = ((providersQuery.data?.items ?? []) as Provider[]).filter(
    provider => provider.isActive
  );
  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const purchaseTotals = {
    recentTotal: purchases.reduce((sum, purchase) => sum + purchase.total, 0),
    providerCount: new Set(purchases.map(purchase => purchase.providerId)).size,
  };

  const handleProductSelect = (selection: Parameters<typeof mergePurchaseCartItem>[1]) => {
    setCartItems(currentItems => mergePurchaseCartItem(currentItems, selection));
    setPurchaseError(null);
  };

  const handleQuantityChange = (itemKey: string, quantity: number) => {
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updatePurchaseCartItem(item, { quantity }) : item
      )
    );
  };

  const handleCostChange = (itemKey: string, costPerUnit: number) => {
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updatePurchaseCartItem(item, { costPerUnit }) : item
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

    setPurchaseError(null);
    setFinalizeModalKey(current => current + 1);
    setIsFinalizeModalOpen(true);
  };

  const handleFinalize = async (values: PurchaseFinalizeValues) => {
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
      setPurchaseError(error instanceof Error ? error.message : 'Unable to register the purchase');
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-secondary-900">Purchases</h1>
            <p className="mt-1 text-sm text-secondary-500">
              Register inbound stock and review recent purchase history
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
              <PackagePlus className="h-4 w-4" />
              Register Purchase
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Recent Purchases</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">{purchases.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Recent Spend</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">
              {formatCurrency(purchaseTotals.recentTotal)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">Providers Used</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">{purchaseTotals.providerCount}</p>
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
            Select an active site before registering a purchase so the correct sequential is used.
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-secondary-900">Current Purchase</h2>
                <p className="text-sm text-secondary-500">
                  Adjust received quantities and costs before updating stock
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

            <PurchaseCartTable
              items={cartItems}
              onQuantityChange={handleQuantityChange}
              onCostChange={handleCostChange}
              onRemove={handleRemoveItem}
            />
            {purchaseError && <p className="mt-4 text-sm text-danger-500">{purchaseError}</p>}
          </div>

          <PurchasesCheckoutPanel
            currentSite={currentSite}
            draftSummary={draftSummary}
            canFinalize={!!currentSite && cartItems.length > 0}
            onOpenSearch={() => setIsProductSearchOpen(true)}
            onFinalize={handleOpenFinalizeModal}
          />
        </div>

        <PurchasesHistoryTable
          purchases={purchases}
          isLoading={purchasesQuery.isLoading}
          error={purchasesQuery.error?.message ?? null}
          onView={setSelectedPurchaseId}
        />
      </div>

      <ProductSearchDialog
        isOpen={isProductSearchOpen}
        onClose={() => setIsProductSearchOpen(false)}
        onSelect={handleProductSelect}
        categories={categories}
        providers={providers}
        title="Add Product to Purchase"
        confirmLabel="Add to purchase"
      />

      <PurchaseFinalizeModal
        key={finalizeModalKey}
        isOpen={isFinalizeModalOpen}
        total={draftSummary.total}
        providers={providers}
        isSaving={createMutation.isPending}
        error={purchaseError}
        onClose={() => setIsFinalizeModalOpen(false)}
        onSubmit={handleFinalize}
      />

      <PurchaseDetailsModal
        purchaseId={selectedPurchaseId}
        isOpen={!!selectedPurchaseId}
        onClose={() => setSelectedPurchaseId(null)}
      />
    </>
  );
}
