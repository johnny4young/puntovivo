import { useState } from 'react';
import { PackagePlus, ScanLine, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { InvoiceOcrDialog } from '@/features/ai-invoice-ocr';
import { useAiFeatureFlag } from '@/features/ai-shared';
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
import { invalidateGroups } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { sumBy } from '@/lib/numbers';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import type { Category, Provider, Purchase } from '@/types';

interface PurchaseDialogState {
  purchaseId: string;
  initialMode: 'details' | 'return';
}

export function PurchasesPage() {
  const { t } = useTranslation('purchases');
  const utils = trpc.useUtils();
  const toast = useToast();
  const { user } = useAuth();
  const { currentSite } = useTenant();
  const [cartItems, setCartItems] = useState<PurchaseCartItem[]>([]);
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [isInvoiceOcrV2Open, setIsInvoiceOcrV2Open] = useState(false);
  const invoiceOcrV2 = useAiFeatureFlag('invoiceOcr');
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [finalizeModalKey, setFinalizeModalKey] = useState(0);
  const [selectedPurchaseDialog, setSelectedPurchaseDialog] = useState<PurchaseDialogState | null>(
    null
  );
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const purchasesQuery = trpc.purchases.list.useQuery({ page: 1, perPage: 50 });
  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 100 });
  const categoriesQuery = trpc.categories.tree.useQuery();

  const createMutation = trpc.purchases.create.useMutation({
    onSuccess: async (_data, variables) => {
      await invalidateGroups(utils, [
        u => u.purchases.list,
        u => u.inventory.listMovements,
        u => u.inventory.listBalancesBySite,
        u => u.inventory.listStock,
        u => u.products.list,
        u => u.products.search,
      ]);
      setCartItems([]);
      setPurchaseError(null);
      setIsFinalizeModalOpen(false);
      toast.success({
        title: t('toast.success'),
        description: `${variables.items.length} ${t('toast.successDetail')}`,
      });
    },
    onError: onErrorToast(toast, t),
  });

  const draftSummary = getPurchaseCartSummary(cartItems);
  const purchases = (purchasesQuery.data?.items ?? []) as Purchase[];
  const providers = ((providersQuery.data?.items ?? []) as Provider[]).filter(
    provider => provider.isActive
  );
  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const canManageReturns = user?.role === 'admin' || user?.role === 'manager';
  const completedPurchases = purchases.filter(purchase => purchase.status === 'completed');
  const purchaseTotals = {
    recentTotal: sumBy(completedPurchases, purchase => purchase.total),
    providerCount: new Set(completedPurchases.map(purchase => purchase.providerId)).size,
  };

  const handleOpenPurchaseDetails = (purchaseId: string) => {
    setSelectedPurchaseDialog({ purchaseId, initialMode: 'details' });
  };

  const handleOpenPurchaseReturn = (purchaseId: string) => {
    setSelectedPurchaseDialog({ purchaseId, initialMode: 'return' });
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
          <h1 className="text-2xl font-bold text-secondary-900">{t('page.title')}</h1>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-lg border border-secondary-200 px-3 py-2 text-sm">
              <p className="text-secondary-500">{t('page.activeSite')}</p>
              <p className="font-medium text-secondary-900">{currentSite?.name ?? t('page.noSite')}</p>
            </div>
            <button
              className="btn-outline flex items-center gap-2"
              onClick={() => setIsProductSearchOpen(true)}
            >
              <Search className="h-4 w-4" />
              {t('checkout.addProduct')}
            </button>
            {canManageReturns && invoiceOcrV2.enabled && (
              <button
                type="button"
                className="btn-outline flex items-center gap-2"
                onClick={() => setIsInvoiceOcrV2Open(true)}
                data-testid="purchases-open-ocr"
              >
                <ScanLine className="h-4 w-4" />
                <span>{t('checkout.openOcr')}</span>
              </button>
            )}
            <button
              className="btn-primary flex items-center gap-2"
              onClick={handleOpenFinalizeModal}
              disabled={!currentSite || cartItems.length === 0}
            >
              <PackagePlus className="h-4 w-4" />
              {t('checkout.register')}
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="card p-4">
            <p className="text-sm text-secondary-500">{t('page.completed')}</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">{completedPurchases.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">{t('page.recentSpend')}</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">
              {formatCurrency(purchaseTotals.recentTotal)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">{t('page.providersUsed')}</p>
            <p className="mt-1 text-2xl font-bold text-secondary-900">{purchaseTotals.providerCount}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-secondary-500">{t('page.draftTotal')}</p>
            <p className="mt-1 text-2xl font-bold text-primary-700">
              {formatCurrency(draftSummary.total)}
            </p>
          </div>
        </div>

        {!currentSite && (
          <div className="rounded-xl border border-warning-300 bg-warning-50 px-4 py-4 text-sm text-warning-700">
            {t('page.noSiteWarning')}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-secondary-900">{t('checkout.kicker')}</h2>
                <p className="text-sm text-secondary-500">
                  {t('checkout.description')}
                </p>
              </div>
              <button
                className="btn-ghost"
                onClick={() => setCartItems([])}
                disabled={cartItems.length === 0}
              >
                {t('checkout.clear')}
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
          onRetry={() => {
            void purchasesQuery.refetch();
          }}
          canManageReturns={canManageReturns}
          onView={handleOpenPurchaseDetails}
          onReturn={handleOpenPurchaseReturn}
        />
      </div>

      <ProductSearchDialog
        isOpen={isProductSearchOpen}
        onClose={() => setIsProductSearchOpen(false)}
        onSelect={handleProductSelect}
        categories={categories}
        providers={providers}
        title={t('dialog.addProduct')}
        confirmLabel={t('dialog.addButton')}
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
        key={
          selectedPurchaseDialog
            ? `${selectedPurchaseDialog.purchaseId}:${selectedPurchaseDialog.initialMode}`
            : 'purchase-details'
        }
        purchaseId={selectedPurchaseDialog?.purchaseId ?? null}
        isOpen={selectedPurchaseDialog !== null}
        initialMode={selectedPurchaseDialog?.initialMode ?? 'details'}
        onClose={() => setSelectedPurchaseDialog(null)}
      />

      <InvoiceOcrDialog
        open={isInvoiceOcrV2Open}
        providers={providers}
        onClose={() => setIsInvoiceOcrV2Open(false)}
        onConfirmed={() => {
          void purchasesQuery.refetch();
          setIsInvoiceOcrV2Open(false);
        }}
      />
    </>
  );
}
