import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useAuth } from '@/features/auth/AuthProvider';
import { SaleDetailsModal } from '@/features/sales/SaleDetailsModal';
import { SalePaymentModal, type SalePaymentValues } from '@/features/sales/SalePaymentModal';
import { mergeCartItem, type SaleCartItem } from '@/features/sales/saleCart';
import { useQuickCreateStore } from '@/features/sales/useQuickCreateStore';
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
interface SalesModalsProps {
  // Product search
  isProductSearchOpen: boolean;
  /** ENG-199 — active POS site, passed only to the suggestion-enabled dialog. */
  discountSuggestionSiteId?: string | null;
  productSearchDialogKey: number;
  onCloseProductSearch: () => void;
  onSelectProduct: (selection: Parameters<typeof mergeCartItem>[1]) => void;
  categories: Category[];
  providers: Provider[];
  productSearchInitialQuery: string;
  // Quick-create product → cart merge
  setCartItems: (update: SetCartItemsArg) => void;
  // Payment
  isPaymentModalOpen: boolean;
  paymentModalKey: number;
  paymentTotal: number;
  customers: Customer[];
  isPaymentSaving: boolean;
  saleError: string | null;
  serviceChargeRate: number;
  fastCashTrigger: number;
  paymentRestoreFocusTo: () => HTMLElement | null;
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
  onConfirmSuspend: () => void;
}

export function SalesModals({
  isProductSearchOpen,
  discountSuggestionSiteId = null,
  productSearchDialogKey,
  onCloseProductSearch,
  onSelectProduct,
  categories,
  providers,
  productSearchInitialQuery,
  setCartItems,
  isPaymentModalOpen,
  paymentModalKey,
  paymentTotal,
  customers,
  isPaymentSaving,
  saleError,
  serviceChargeRate,
  fastCashTrigger,
  paymentRestoreFocusTo,
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
  const { t } = useTranslation(['sales', 'common']);
  const { user } = useAuth();
  const shouldRenderQuickCreateProductGate = useQuickCreateStore(
    state => state.requestedCreateProduct !== null
  );
  const shouldRenderQuickCreateCustomerGate = useQuickCreateStore(
    state => state.requestedCreateCustomer !== null
  );

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
          // ENG-105c — surface the quick-create CTA in the empty
          // state. The dialog closes itself before firing the
          // callback so we just dispatch the request to the store;
          // QuickCreateProductGate mounts the form modal.
          onQuickCreateRequested={defaultName => {
            useQuickCreateStore.getState().requestCreateProduct({ defaultName });
          }}
          canCreateProducts={user?.role === 'admin' || user?.role === 'manager'}
          // ENG-199 — the POS is the surface where the expiry-radar
          // suggestion must reach the cashier; other dialog consumers
          // keep the prop off (zero extra queries).
          showDiscountSuggestions
          discountSuggestionSiteId={discountSuggestionSiteId}
        />
      )}
      {(shouldRenderQuickCreateProductGate || shouldRenderQuickCreateCustomerGate) && (
        <Suspense fallback={null}>
          {/* ENG-105c — Quick-create gates stay split out of the hot
           * SalesPage route chunk and only mount when the store flags
           * a request. On success they invoke onCreated so SalesPage
           * can fold the new entity into the active cart / sale, then
           * they consume the store slot. */}
          {shouldRenderQuickCreateProductGate && (
            <QuickCreateProductGate
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
        <SalePaymentModal
          key={paymentModalKey}
          isOpen={isPaymentModalOpen}
          total={paymentTotal}
          customers={customers}
          isSaving={isPaymentSaving}
          error={saleError}
          serviceChargeRate={serviceChargeRate}
          // ENG-090 — role gates the credit method tile inside the
          // modal. Cashier never sees it; manager + admin do; admin
          // additionally sees the override checkbox when cupo is
          // exceeded.
          userRole={user?.role}
          // ENG-105e — F2 fast-cash signal. Positive values apply
          // at mount; later increments re-apply exact cash while open.
          fastCashTrigger={fastCashTrigger}
          restoreFocusTo={paymentRestoreFocusTo}
          onClose={onClosePayment}
          onSubmit={onSubmitPayment}
        />
      )}

      {selectedSaleId && (
        <SaleDetailsModal
          saleId={selectedSaleId}
          isOpen={!!selectedSaleId}
          onClose={onCloseSaleDetails}
        />
      )}

      {isSuspendLabelPromptOpen && (
        <Modal
          isOpen={isSuspendLabelPromptOpen}
          onClose={onCloseSuspendPrompt}
          title={t('park.labelPromptTitle')}
          size="sm"
          footer={
            <>
              <ModalButton onClick={onCloseSuspendPrompt} disabled={isSuspending}>
                {t('common:actions.cancel')}
              </ModalButton>
              <ModalButton variant="primary" onClick={onConfirmSuspend} disabled={isSuspending}>
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
          </div>
        </Modal>
      )}
    </>
  );
}
