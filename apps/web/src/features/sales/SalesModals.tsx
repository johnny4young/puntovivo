import { Suspense, lazy, useEffect, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isProductTemplateVerticalId } from '@puntovivo/shared/vertical-presets';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useIsModuleActive } from '@/features/modules/ModulesContext';
import { LazySalePaymentModal } from '@/features/sales/lazySalePaymentModal';
import { preloadSalePaymentModal } from '@/features/sales/salePaymentModal.loader';
import type { SalePaymentValues } from '@/features/sales/salePaymentModal.types';
import { mergeCartItem, type SaleCartItem } from '@/features/sales/saleCart';
import { useQuickCreateStore } from '@/features/sales/useQuickCreateStore';
import { normalizeRestaurantGuestCount } from '@/features/restaurants/restaurantDraft';
import { trpc } from '@/lib/trpc';
import type { Category, Customer, Provider } from '@/types';

const QuickCreateProductGate = lazy(() =>
  import('@/features/sales/QuickCreateProductGate').then(module => ({
    default: module.QuickCreateProductGate,
  }))
);

const QuickCreateCustomerGate = lazy(() =>
  import('@/features/sales/QuickCreateCustomerGate').then(module => ({
    default: module.QuickCreateCustomerGate,
  }))
);

const LazySaleDetailsModal = lazy(() =>
  import('@/features/sales/SaleDetailsModal').then(module => ({
    default: module.SaleDetailsModal,
  }))
);

const LazyReceiptShareSection = lazy(() =>
  import('@/features/sales/ReceiptShareSection').then(module => ({
    default: module.ReceiptShareSection,
  }))
);

/** Functional or value update for the active cart, mirroring SalesPage's `setCartItems` wrapper. */
type SetCartItemsArg = SaleCartItem[] | ((previous: SaleCartItem[]) => SaleCartItem[]);

/**
 * Props for {@link SalesModals}.
 *
 * The overlay cluster for the POS: product-search dialog, the lazy
 * quick-create gates, the payment modal, the sale-details modal, and the
 * suspend-label prompt. Purely presentational — every flag, key, value,
 * and handler is owned by SalesPage. The remount `key`s
 * (`productSearchDialogKey`, `paymentModalKey`) are applied to the inner
 * modal elements here exactly as in the shell. `useAuth` +
 * `useQuickCreateStore` are read internally (context/store, behavior-
 * identical) to keep the prop surface smaller.
 */
/** Modal state and callbacks owned by the sales-page orchestration shell. */
interface SalesModalsProps {
  // Product search
  isProductSearchOpen: boolean;
  /** active POS site, passed only to the suggestion-enabled dialog. */
  discountSuggestionSiteId?: string | null;
  productSearchDialogKey: number;
  onCloseProductSearch: () => void;
  onSelectProduct: (selection: Parameters<typeof mergeCartItem>[1]) => void;
  productSearchInitialQuery: string;
  // Quick-create product → cart merge
  setCartItems: (update: SetCartItemsArg) => void;
  // Payment
  isPaymentModalOpen: boolean;
  paymentModalKey: number;
  paymentTotal: number;
  paymentApprovalSaleId: string | null;
  paymentApprovalCustomerId: string | null;
  paymentCustomerLocked: boolean;
  paymentLockedCustomerName: string | null;
  paymentApprovalItems: SaleCartItem[];
  paymentApprovalDiscountAmount: number;
  promotionPricingEnabled: boolean;
  currencyCode: string;
  isPaymentSaving: boolean;
  saleError: string | null;
  serviceChargeRate: number;
  allowTip: boolean;
  fastCashTrigger: number;
  paymentRestoreFocusTo: () => HTMLElement | null;
  activePriceTier: 1 | 2 | 3;
  onCustomerPriceTierChange?: ((tier: 1 | 2 | 3) => void) | undefined;
  onClosePayment: () => void;
  onSubmitPayment: (values: SalePaymentValues) => Promise<void>;
  // Sale details
  selectedSaleId: string | null;
  onCloseSaleDetails: () => void;
  // Suspend-label prompt
  isSuspendLabelPromptOpen: boolean;
  isSuspending: boolean;
  suspendLabelDraft: string;
  onChangeSuspendLabel: (value: string) => void;
  onCloseSuspendPrompt: () => void;
  onConfirmSuspend: (restaurant?: {
    tableId: string;
    guestCount: number;
  }) => boolean | Promise<boolean>;
}

export function SalesModals({
  isProductSearchOpen,
  discountSuggestionSiteId = null,
  productSearchDialogKey,
  onCloseProductSearch,
  onSelectProduct,
  productSearchInitialQuery,
  setCartItems,
  isPaymentModalOpen,
  paymentModalKey,
  paymentTotal,
  paymentApprovalSaleId,
  paymentApprovalCustomerId,
  paymentCustomerLocked,
  paymentLockedCustomerName,
  paymentApprovalItems,
  paymentApprovalDiscountAmount,
  promotionPricingEnabled,
  currencyCode,
  isPaymentSaving,
  saleError,
  serviceChargeRate,
  allowTip,
  fastCashTrigger,
  paymentRestoreFocusTo,
  activePriceTier,
  onCustomerPriceTierChange,
  onClosePayment,
  onSubmitPayment,
  selectedSaleId,
  onCloseSaleDetails,
  isSuspendLabelPromptOpen,
  isSuspending,
  suspendLabelDraft,
  onChangeSuspendLabel,
  onCloseSuspendPrompt,
  onConfirmSuspend,
}: SalesModalsProps) {
  const { t } = useTranslation(['sales', 'restaurants', 'common']);
  const { user, tenant } = useAuth();
  const { currentSite } = useTenant();
  const dineInActive = useIsModuleActive('dine-in');
  const [suspendTableId, setSuspendTableId] = useState('');
  const [suspendGuestCount, setSuspendGuestCount] = useState(1);
  const templateVertical = isProductTemplateVerticalId(tenant?.settings.businessType)
    ? tenant.settings.businessType
    : null;
  const pharmacyMode = tenant?.settings.businessType === 'pharmacy';
  const shouldRenderQuickCreateProductGate = useQuickCreateStore(
    state => state.requestedCreateProduct !== null
  );
  const shouldRenderQuickCreateCustomerGate = useQuickCreateStore(
    state => state.requestedCreateCustomer !== null
  );

  // These catalogs belong to interaction-only overlays. SalesModals itself
  // is absent from the initial POS tree, so the query observers are not
  // constructed until an operator opens one of those surfaces.
  const customersQuery = trpc.customers.list.useQuery(
    { page: 1, perPage: 100, isActive: true },
    {
      enabled: isPaymentModalOpen,
      placeholderData: keepPreviousData,
    }
  );
  const categoriesQuery = trpc.categories.tree.useQuery(undefined, {
    enabled: isProductSearchOpen,
  });
  const providersQuery = trpc.providers.list.useQuery(
    { page: 1, perPage: 100 },
    { enabled: isProductSearchOpen }
  );
  const suspendTablesQuery = trpc.restaurantTables.list.useQuery(
    currentSite ? { siteId: currentSite.id, includeArchived: false } : (undefined as never),
    { enabled: isSuspendLabelPromptOpen && dineInActive && Boolean(currentSite) }
  );
  const suspendTableStateQuery = trpc.restaurantServices.getTableState.useQuery(
    suspendTableId ? { tableId: suspendTableId } : (undefined as never),
    { enabled: isSuspendLabelPromptOpen && dineInActive && suspendTableId.length > 0 }
  );
  const selectedSuspendTable = suspendTablesQuery.data?.items.find(
    table => table.id === suspendTableId
  );
  const existingGuestCount = suspendTableStateQuery.data?.service?.guestCount ?? null;
  const suspendGuestCapacity = selectedSuspendTable?.seatCount ?? 200;
  const suspendTableSelectionInvalid =
    suspendTableId.length > 0 &&
    (!dineInActive ||
      suspendTablesQuery.isLoading ||
      Boolean(suspendTablesQuery.error) ||
      !selectedSuspendTable ||
      suspendTableStateQuery.isLoading ||
      Boolean(suspendTableStateQuery.error));
  const effectiveSuspendGuestCount = normalizeRestaurantGuestCount(
    existingGuestCount ?? suspendGuestCount,
    suspendGuestCapacity
  );
  const customers = ((customersQuery.data?.items ?? []) as Customer[]).filter(
    customer => customer.isActive
  );
  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const providers = ((providersQuery.data?.items ?? []) as Provider[]).filter(
    provider => provider.isActive
  );

  // loading the payment drawer after the route's first paint keeps
  // it out of the Lighthouse-critical SalesPage chunk without moving latency
  // into the cashier's F1 interaction. Chromium supports requestIdleCallback;
  // the timer fallback keeps tests and older webviews portable.
  useEffect(() => {
    const preload = () => {
      void preloadSalePaymentModal();
    };
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(preload, { timeout: 2_000 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timeoutId = window.setTimeout(preload, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  function closeSuspendPrompt(): void {
    if (isSuspending) return;
    setSuspendTableId('');
    setSuspendGuestCount(1);
    onCloseSuspendPrompt();
  }

  return (
    <>
      {isProductSearchOpen && (
        <ProductSearchDialog
          key={productSearchDialogKey}
          isOpen={isProductSearchOpen}
          onClose={onCloseProductSearch}
          onSelect={onSelectProduct}
          categories={categories}
          providers={providers}
          initialQuery={productSearchInitialQuery}
          title={t('checkout.addProduct')}
          confirmLabel={t('checkout.addToCart')}
          // surface the quick-create CTA in the empty
          // state. The dialog closes itself before firing the
          // callback so we just dispatch the request to the store;
          // QuickCreateProductGate mounts the form modal.
          onQuickCreateRequested={defaultName => {
            useQuickCreateStore.getState().requestCreateProduct({ defaultName });
          }}
          canCreateProducts={user?.role === 'admin' || user?.role === 'manager'}
          // the POS is the surface where the expiry-radar
          // suggestion must reach the cashier; other dialog consumers
          // keep the prop off (zero extra queries).
          showDiscountSuggestions
          discountSuggestionSiteId={discountSuggestionSiteId}
        />
      )}
      {(shouldRenderQuickCreateProductGate || shouldRenderQuickCreateCustomerGate) && (
        <Suspense fallback={null}>
          {/* Quick-create gates stay split out of the hot
           * SalesPage route chunk and only mount when the store flags
           * a request. On success they invoke onCreated so SalesPage
           * can fold the new entity into the active cart / sale, then
           * they consume the store slot. */}
          {shouldRenderQuickCreateProductGate && (
            <QuickCreateProductGate
              templateVertical={templateVertical}
              pharmacyMode={pharmacyMode}
              onCreated={created => {
                // Fetch the freshly created product with its full unit
                // assignments + price so we can merge into the cart with
                // the exact shape mergeCartItem expects.
                // The mutation returns the eager shape with unitAssignments
                // already populated by the server.
                const defaultUnit =
                  created.unitAssignments?.find(assignment => assignment.isBase) ??
                  created.unitAssignments?.[0];
                if (!defaultUnit) {
                  return;
                }
                setCartItems(currentItems =>
                  mergeCartItem(currentItems, {
                    product: {
                      id: created.id,
                      name: created.name,
                      sku: created.sku,
                      stock: created.stock,
                      baseUnitPrice: defaultUnit.price,
                      baseUnitAbbreviation: defaultUnit.unitAbbreviation,
                      taxRate: created.taxRate ?? 0,
                      sellByFraction: created.sellByFraction,
                      fractionStep: created.fractionStep,
                      fractionMinimum: created.fractionMinimum,
                      tracksSerials: created.tracksSerials,
                    } as Parameters<typeof mergeCartItem>[1]['product'],
                    unit: defaultUnit,
                    price: defaultUnit.price,
                  })
                );
              }}
            />
          )}
          {shouldRenderQuickCreateCustomerGate && <QuickCreateCustomerGate />}
        </Suspense>
      )}

      {isPaymentModalOpen && (
        <Suspense fallback={null}>
          <LazySalePaymentModal
            key={paymentModalKey}
            isOpen={isPaymentModalOpen}
            total={paymentTotal}
            approvalSaleId={paymentApprovalSaleId}
            approvalCustomerId={paymentApprovalCustomerId}
            customerLocked={paymentCustomerLocked}
            lockedCustomerName={paymentLockedCustomerName}
            approvalItems={paymentApprovalItems}
            approvalDiscountAmount={paymentApprovalDiscountAmount}
            promotionPricingEnabled={promotionPricingEnabled}
            currencyCode={currencyCode}
            customers={customers}
            isSaving={isPaymentSaving}
            error={saleError}
            serviceChargeRate={serviceChargeRate}
            allowTip={allowTip}
            // role gates the credit method tile inside the
            // modal. Cashier never sees it; manager + admin do; admin
            // additionally sees the override checkbox when cupo is
            // exceeded.
            userRole={user?.role}
            // F2 fast-cash signal. Positive values apply
            // at mount; later increments re-apply exact cash while open.
            fastCashTrigger={fastCashTrigger}
            restoreFocusTo={paymentRestoreFocusTo}
            activePriceTier={activePriceTier}
            onCustomerPriceTierChange={onCustomerPriceTierChange}
            onClose={onClosePayment}
            onSubmit={onSubmitPayment}
          />
        </Suspense>
      )}

      {selectedSaleId && (
        <Suspense fallback={null}>
          <LazySaleDetailsModal
            saleId={selectedSaleId}
            isOpen={!!selectedSaleId}
            onClose={onCloseSaleDetails}
            receiptShareSection={
              <Suspense fallback={null}>
                <LazyReceiptShareSection saleId={selectedSaleId} />
              </Suspense>
            }
          />
        </Suspense>
      )}

      {isSuspendLabelPromptOpen && (
        <Modal
          isOpen={isSuspendLabelPromptOpen}
          onClose={closeSuspendPrompt}
          closeOnBackdrop={!isSuspending}
          closeOnEsc={!isSuspending}
          showCloseButton={!isSuspending}
          title={t('park.labelPromptTitle')}
          size="sm"
          footer={
            <>
              <ModalButton onClick={closeSuspendPrompt} disabled={isSuspending}>
                {t('common:actions.cancel')}
              </ModalButton>
              <ModalButton
                variant="primary"
                onClick={async () => {
                  if (suspendTableSelectionInvalid) return;
                  const shouldReset = await onConfirmSuspend(
                    suspendTableId
                      ? { tableId: suspendTableId, guestCount: effectiveSuspendGuestCount }
                      : undefined
                  );
                  if (shouldReset) {
                    setSuspendTableId('');
                    setSuspendGuestCount(1);
                  }
                }}
                disabled={isSuspending || suspendTableSelectionInvalid}
              >
                {isSuspending ? `${t('park.labelPromptConfirm')}…` : t('park.labelPromptConfirm')}
              </ModalButton>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-secondary-600">{t('park.labelPromptDescription')}</p>
            <input
              type="text"
              value={suspendLabelDraft}
              onChange={event => onChangeSuspendLabel(event.target.value)}
              placeholder={t('park.labelPlaceholder')}
              maxLength={80}
              className="block w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm"
              autoFocus
              disabled={isSuspending}
              data-testid="suspend-label-input"
            />
            {dineInActive && (suspendTablesQuery.data?.items.length ?? 0) > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-secondary-700">
                  {t('restaurants:tableLabel.label')}
                  <select
                    className="input mt-1 w-full"
                    value={suspendTableId}
                    onChange={event => {
                      const nextId = event.target.value;
                      setSuspendTableId(nextId);
                      const table = suspendTablesQuery.data?.items.find(row => row.id === nextId);
                      if (table?.seatCount) {
                        setSuspendGuestCount(current =>
                          normalizeRestaurantGuestCount(current, table.seatCount ?? 200)
                        );
                      }
                    }}
                    disabled={isSuspending}
                    data-testid="suspend-table-select"
                  >
                    <option value="">{t('restaurants:service.generalParkOption')}</option>
                    {suspendTablesQuery.data?.items.map(table => (
                      <option key={table.id} value={table.id}>
                        {table.name}
                      </option>
                    ))}
                  </select>
                </label>
                {suspendTableId && (
                  <label className="text-xs font-medium text-secondary-700">
                    {t('restaurants:service.guestCount')}
                    <input
                      className="input mt-1 w-full"
                      type="number"
                      min={1}
                      max={suspendGuestCapacity}
                      step={1}
                      value={effectiveSuspendGuestCount}
                      disabled={isSuspending || existingGuestCount !== null}
                      onChange={event =>
                        setSuspendGuestCount(
                          normalizeRestaurantGuestCount(
                            Number(event.target.value),
                            suspendGuestCapacity
                          )
                        )
                      }
                      data-testid="suspend-guest-count"
                    />
                  </label>
                )}
              </div>
            )}
            {suspendTableId && suspendTableStateQuery.isLoading && (
              <p className="text-xs text-secondary-500" data-testid="suspend-table-state-loading">
                {t('restaurants:service.tableStateLoading')}
              </p>
            )}
            {suspendTableId &&
              (suspendTableStateQuery.error ||
                (!suspendTablesQuery.isLoading && !selectedSuspendTable)) && (
                <p className="text-xs text-danger-700" data-testid="suspend-table-state-error">
                  {t('restaurants:service.tableStateError')}
                </p>
              )}
          </div>
        </Modal>
      )}
    </>
  );
}
