import { lazy, Suspense, type ComponentProps, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from '@/components/feedback/Drawer';
import { SalesCartWorkspace } from '@/features/sales/SalesCartWorkspace';
import { SalesCheckoutPanel } from '@/features/sales/SalesCheckoutPanel';
import type { CashSessionModals } from '@/features/sales/CashSessionModals';
import { SalesHeaderSection } from '@/features/sales/SalesHeaderSection';
import { SalesFlowRail } from '@/features/sales/SalesFlowRail';
import type { SalesModals } from '@/features/sales/SalesModals';
import { WorkspaceTabsSection } from '@/features/sales/WorkspaceTabsSection';
import { SalesMobileCheckoutBar } from '@/features/sales/SalesMobileCheckoutBar';
import type { SuspendedSalesPanel } from '@/features/sales/SuspendedSalesPanel';

const LazySalesHistoryDrawerContent = lazy(() =>
  import('@/features/sales/SalesHistoryDrawerContent').then(module => ({
    default: module.SalesHistoryDrawerContent,
  }))
);

const LazySalesModals = lazy(() =>
  import('@/features/sales/SalesModals').then(module => ({
    default: module.SalesModals,
  }))
);

const LazyCashSessionModals = lazy(() =>
  import('@/features/sales/CashSessionModals').then(module => ({
    default: module.CashSessionModals,
  }))
);

const LazySuspendedSalesPanel = lazy(() =>
  import('@/features/sales/SuspendedSalesPanel').then(module => ({
    default: module.SuspendedSalesPanel,
  }))
);

const LazySalesQuickAccess = lazy(() =>
  import('@/features/sales/SalesQuickAccess').then(module => ({
    default: module.SalesQuickAccess,
  }))
);

type HeaderProps = ComponentProps<typeof SalesHeaderSection>;
type TabsProps = ComponentProps<typeof WorkspaceTabsSection>;
type CartProps = ComponentProps<typeof SalesCartWorkspace>;
type CheckoutProps = ComponentProps<typeof SalesCheckoutPanel>;
type SuspendedProps = ComponentProps<typeof SuspendedSalesPanel>;
type ModalsProps = ComponentProps<typeof SalesModals>;
type CashModalsProps = ComponentProps<typeof CashSessionModals>;

/**
 * Props for {@link SalesScreen}.
 *
 * slice 16b-2 — SalesPage's entire `return` JSX was relocated here so
 * the shell drops below the 500-LOC ceiling. SalesScreen is PURELY
 * presentational: it owns no state, runs no queries/mutations, and forwards
 * every value/handler to the already-extracted child components. The shell
 * assembles these props from its hooks. Forwarded handler/ref types are pinned
 * to the child components via `ComponentProps` indexed access so the seam
 * cannot drift; the tRPC query/mutation objects the old JSX read inline are
 * passed as DERIVED values instead (`isCashSessionLoading`, the four
 * `is*ing*` pending flags) so a presentational component never touches a
 * query/mutation handle. History owns its secondary query behind the drawer's
 * lazy boundary.
 */
export interface SalesScreenProps {
  // Header + product search
  productSearchQuery: string;
  setProductSearchQuery: Dispatch<SetStateAction<string>>;
  handleOpenProductSearch: (initialQuery?: string) => void;
  productInputRef: HeaderProps['productInputRef'];
  setIsHistoryDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setIsSuspendedPanelOpen: Dispatch<SetStateAction<boolean>>;
  suspendedDraftsCount: number;
  isResumedCart: boolean;
  activeWorkspace: HeaderProps['activeWorkspace'];
  // Workspace tabs
  ownedWorkspaces: TabsProps['ownedWorkspaces'];
  handleSelectWorkspace: TabsProps['onSelectWorkspace'];
  // Cart workspace
  cartItems: CartProps['items'];
  activeSelectedCartItemKey: CartProps['selectedItemKey'];
  draftSummary: CheckoutProps['draftSummary'];
  approvalDiscountAmount: number;
  currencyCode: string;
  favoriteScopeKey: string;
  saleError: CartProps['saleError'];
  handleQuantityChange: CartProps['onQuantityChange'];
  handleDiscountChange: CartProps['onDiscountChange'];
  handleSerialSelectionChange: CartProps['onSerialSelectionChange'];
  handleRemoveItem: CartProps['onRemove'];
  setSelectedCartItemKey: CartProps['onSelectItem'];
  handleClearCart: CartProps['onClearCart'];
  quantityInputRefFor: CartProps['quantityInputRefFor'];
  discountInputRefFor: CartProps['discountInputRefFor'];
  focusDiscountInput: (itemKey: string) => void;
  canUndoActiveCart: boolean;
  handleUndoCart: () => void;
  // customer price tier for the active ticket.
  activePriceTier: 1 | 2 | 3;
  handlePriceTierChange: (tier: 1 | 2 | 3) => void;
  // Checkout panel
  currentSite: CheckoutProps['currentSite'];
  activeCashSession: CheckoutProps['cashSession'];
  registerAssignments: CheckoutProps['registerAssignments'];
  selectedRegisterAssignment: CheckoutProps['selectedRegisterAssignment'];
  isCashSessionLoading: boolean;
  canCharge: boolean;
  canOpenCashSession: boolean;
  canCloseCashSession: boolean;
  userRole: CheckoutProps['userRole'];
  handleOpenPaymentModal: (fastCash?: boolean) => void;
  handleOpenCashSessionModal: () => void;
  handleOpenCloseCashSessionModal: () => void;
  handleOpenCashSessionMovementModal: () => void;
  onKickCashDrawer: CheckoutProps['onKickCashDrawer'];
  isKickingCashDrawer: boolean;
  setSelectedRegisterAssignmentId: CheckoutProps['onRegisterAssignmentChange'];
  handleOpenSuspendPrompt: () => void;
  handleNewSale: () => void;
  handleToggleSuspendedPanel: () => void;
  hubReachable: CheckoutProps['hubReachable'];
  preflightItems: CheckoutProps['preflightItems'];
  // History drawer
  isHistoryDrawerOpen: boolean;
  lastCompletedSaleId: string | null;
  setSelectedSaleId: Dispatch<SetStateAction<string | null>>;
  selectedHistorySaleId: string | null;
  setSelectedHistorySaleId: Dispatch<SetStateAction<string | null>>;
  // Suspended-sales drawer
  isSuspendedPanelOpen: boolean;
  handleResumeFromPanel: SuspendedProps['onResume'];
  // Sales modals (product search / payment / sale details / suspend prompt)
  isProductSearchOpen: boolean;
  shouldRenderQuickCreateProductGate: boolean;
  shouldRenderQuickCreateCustomerGate: boolean;
  productSearchDialogKey: number;
  setIsProductSearchOpen: Dispatch<SetStateAction<boolean>>;
  handleProductSelect: ModalsProps['onSelectProduct'];
  productSearchInitialQuery: string;
  setCartItems: ModalsProps['setCartItems'];
  isPaymentModalOpen: boolean;
  paymentModalKey: number;
  isPaymentSaving: boolean;
  serviceChargeRate: number;
  fastCashTrigger: number;
  setIsPaymentModalOpen: Dispatch<SetStateAction<boolean>>;
  setFastCashTrigger: Dispatch<SetStateAction<number>>;
  handleCheckout: ModalsProps['onSubmitPayment'];
  selectedSaleId: ModalsProps['selectedSaleId'];
  isSuspendLabelPromptOpen: boolean;
  isSuspending: boolean;
  suspendLabelDraft: string;
  setSuspendLabelDraft: Dispatch<SetStateAction<string>>;
  setIsSuspendLabelPromptOpen: Dispatch<SetStateAction<boolean>>;
  handleSuspendConfirm: () => void | Promise<void>;
  // Cash-session modals
  isCashSessionModalOpen: boolean;
  cashSessionModalKey: number;
  isOpeningCashSession: boolean;
  cashSessionError: string | null;
  setIsCashSessionModalOpen: Dispatch<SetStateAction<boolean>>;
  handleCreateCashSession: CashModalsProps['onSubmitOpen'];
  isCashSessionCloseModalOpen: boolean;
  cashSessionCloseModalKey: number;
  isClosingCashSession: boolean;
  cashSessionCloseError: string | null;
  setIsCashSessionCloseModalOpen: Dispatch<SetStateAction<boolean>>;
  handleCloseCashSession: CashModalsProps['onSubmitClose'];
  isCashSessionMovementModalOpen: boolean;
  cashSessionMovementModalKey: number;
  isRecordingMovement: boolean;
  cashSessionMovementError: string | null;
  setIsCashSessionMovementModalOpen: Dispatch<SetStateAction<boolean>>;
  handleRecordCashMovement: CashModalsProps['onSubmitMovement'];
  /** the just-closed session whose day-close ritual is showing. */
  dayCloseSessionId: string | null;
  setDayCloseSessionId: Dispatch<SetStateAction<string | null>>;
}

/**
 * The presentational composition of the /sales POS screen: header + workspace
 * tabs + the cart/checkout grid + the mobile checkout bar + the history /
 * suspended drawers + the sales and cash-session modal clusters. All children
 * are already-extracted components; SalesScreen only wires them. Behavior is
 * owned entirely by SalesPage and its hooks — this file is render-only.
 */
export function SalesScreen({
  productSearchQuery,
  setProductSearchQuery,
  handleOpenProductSearch,
  productInputRef,
  setIsHistoryDrawerOpen,
  setIsSuspendedPanelOpen,
  suspendedDraftsCount,
  isResumedCart,
  activeWorkspace,
  ownedWorkspaces,
  handleSelectWorkspace,
  cartItems,
  activeSelectedCartItemKey,
  draftSummary,
  approvalDiscountAmount,
  currencyCode,
  favoriteScopeKey,
  saleError,
  handleQuantityChange,
  handleDiscountChange,
  handleSerialSelectionChange,
  handleRemoveItem,
  setSelectedCartItemKey,
  handleClearCart,
  quantityInputRefFor,
  discountInputRefFor,
  focusDiscountInput,
  canUndoActiveCart,
  handleUndoCart,
  activePriceTier,
  handlePriceTierChange,
  currentSite,
  activeCashSession,
  registerAssignments,
  selectedRegisterAssignment,
  isCashSessionLoading,
  canCharge,
  canOpenCashSession,
  canCloseCashSession,
  userRole,
  handleOpenPaymentModal,
  handleOpenCashSessionModal,
  handleOpenCloseCashSessionModal,
  handleOpenCashSessionMovementModal,
  onKickCashDrawer,
  isKickingCashDrawer,
  setSelectedRegisterAssignmentId,
  handleOpenSuspendPrompt,
  handleNewSale,
  handleToggleSuspendedPanel,
  hubReachable,
  preflightItems,
  isHistoryDrawerOpen,
  lastCompletedSaleId,
  setSelectedSaleId,
  selectedHistorySaleId,
  setSelectedHistorySaleId,
  isSuspendedPanelOpen,
  handleResumeFromPanel,
  isProductSearchOpen,
  shouldRenderQuickCreateProductGate,
  shouldRenderQuickCreateCustomerGate,
  productSearchDialogKey,
  setIsProductSearchOpen,
  handleProductSelect,
  productSearchInitialQuery,
  setCartItems,
  isPaymentModalOpen,
  paymentModalKey,
  isPaymentSaving,
  serviceChargeRate,
  fastCashTrigger,
  setIsPaymentModalOpen,
  setFastCashTrigger,
  handleCheckout,
  selectedSaleId,
  isSuspendLabelPromptOpen,
  isSuspending,
  suspendLabelDraft,
  setSuspendLabelDraft,
  setIsSuspendLabelPromptOpen,
  handleSuspendConfirm,
  isCashSessionModalOpen,
  cashSessionModalKey,
  isOpeningCashSession,
  cashSessionError,
  setIsCashSessionModalOpen,
  handleCreateCashSession,
  isCashSessionCloseModalOpen,
  cashSessionCloseModalKey,
  isClosingCashSession,
  cashSessionCloseError,
  setIsCashSessionCloseModalOpen,
  handleCloseCashSession,
  isCashSessionMovementModalOpen,
  cashSessionMovementModalKey,
  isRecordingMovement,
  cashSessionMovementError,
  setIsCashSessionMovementModalOpen,
  handleRecordCashMovement,
  dayCloseSessionId,
  setDayCloseSessionId,
}: SalesScreenProps) {
  const { t } = useTranslation(['sales', 'errors', 'common']);

  return (
    <>
      <div className="sales-pos-shell space-y-3 pb-24 lg:flex pos:min-h-0 lg:flex-col lg:gap-3 lg:space-y-0 pos:overflow-hidden pos:pb-0">
        {/* el POS es la única superficie de /sales. En el
            breakpoint `pos:` (ancho desktop + >=900px alto), la barra de
            búsqueda y los accesos a Historial / Ventas suspendidas viven en
            una fila de acción de altura fija (shrink-0); el carrito y el
            panel de cobro toman el resto de la altura y hacen scroll por
            dentro, de modo que cobrar no exige scroll de página a 1440x900.
            Por debajo de `pos:` vuelve el scroll natural de página para que
            los controles de caja sean alcanzables.
            `productInputRef` es el objetivo del scanner wedge
            (useBarcodeWedgeListener) y de Alt+P (useScannerFocusRestoration),
            así que permanece montado y visible siempre. */}
        <SalesFlowRail
          itemCount={draftSummary.itemCount}
          total={draftSummary.total}
          hasCashSession={!!activeCashSession}
          canOpenCashSession={canOpenCashSession}
          canCharge={canCharge}
          hubReachable={hubReachable}
          preflightItems={preflightItems}
          onOpenCashSession={handleOpenCashSessionModal}
          onOpenSearch={() => handleOpenProductSearch()}
          onCharge={handleOpenPaymentModal}
        />

        <SalesHeaderSection
          productSearchQuery={productSearchQuery}
          onQueryChange={setProductSearchQuery}
          onSubmitSearch={() => handleOpenProductSearch(productSearchQuery)}
          productInputRef={productInputRef}
          onOpenHistory={() => setIsHistoryDrawerOpen(true)}
          onOpenSuspended={() => setIsSuspendedPanelOpen(true)}
          suspendedDraftsCount={suspendedDraftsCount}
          isResumedCart={isResumedCart}
          activeWorkspace={activeWorkspace ?? null}
        />

        <WorkspaceTabsSection
          ownedWorkspaces={ownedWorkspaces}
          activeWorkspaceId={activeWorkspace?.id}
          onSelectWorkspace={handleSelectWorkspace}
        />

        <section className="sales-workbench-grid grid gap-4 pos:min-h-0 pos:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,20rem)] pos:grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(0,2fr)_minmax(320px,360px)]">
          <SalesCartWorkspace
            items={cartItems}
            discountSuggestionSiteId={currentSite?.id ?? null}
            selectedItemKey={activeSelectedCartItemKey}
            itemCount={draftSummary.itemCount}
            saleError={saleError}
            onQuantityChange={handleQuantityChange}
            onDiscountChange={handleDiscountChange}
            onSerialSelectionChange={handleSerialSelectionChange}
            onRemove={handleRemoveItem}
            onSelectItem={setSelectedCartItemKey}
            onClearCart={handleClearCart}
            quantityInputRefFor={quantityInputRefFor}
            discountInputRefFor={discountInputRefFor}
            canUndo={canUndoActiveCart}
            onUndo={handleUndoCart}
            priceTier={activePriceTier}
            onPriceTierChange={isResumedCart ? undefined : handlePriceTierChange}
            quickAccess={
              currentSite && favoriteScopeKey ? (
                <Suspense
                  fallback={
                    <div
                      className="mb-4 min-h-24 animate-pulse rounded-[14px] border border-line/70 bg-surface-2/55"
                      role="status"
                      aria-label={t('common:actions.loading')}
                    />
                  }
                >
                  <LazySalesQuickAccess
                    key={favoriteScopeKey}
                    scopeKey={favoriteScopeKey}
                    siteId={currentSite.id}
                    hasCartItems={cartItems.length > 0}
                    canFocusDiscount={activeSelectedCartItemKey !== null}
                    lastCompletedSaleId={lastCompletedSaleId}
                    onOpenLastReceipt={() => {
                      if (lastCompletedSaleId) setSelectedSaleId(lastCompletedSaleId);
                    }}
                    onSelectProduct={handleProductSelect}
                    onOpenSearch={() => handleOpenProductSearch()}
                    onFocusDiscount={() => {
                      if (activeSelectedCartItemKey) {
                        focusDiscountInput(activeSelectedCartItemKey);
                      }
                    }}
                    onNewSale={handleNewSale}
                  />
                </Suspense>
              ) : undefined
            }
          />

          <SalesCheckoutPanel
            currentSite={currentSite}
            cashSession={activeCashSession}
            registerAssignments={registerAssignments}
            selectedRegisterAssignment={selectedRegisterAssignment}
            isCashSessionLoading={isCashSessionLoading}
            draftSummary={draftSummary}
            canCharge={canCharge}
            canOpenCashSession={canOpenCashSession}
            canCloseCashSession={canCloseCashSession}
            userRole={userRole}
            onOpenSearch={() => handleOpenProductSearch()}
            onCharge={handleOpenPaymentModal}
            onOpenCashSession={handleOpenCashSessionModal}
            onCloseCashSession={handleOpenCloseCashSessionModal}
            onOpenMovement={handleOpenCashSessionMovementModal}
            onKickCashDrawer={onKickCashDrawer}
            isKickingCashDrawer={isKickingCashDrawer}
            onRegisterAssignmentChange={setSelectedRegisterAssignmentId}
            canSuspend={canCharge && !isResumedCart}
            onSuspend={handleOpenSuspendPrompt}
            onNewSale={handleNewSale}
            suspendedDraftsCount={suspendedDraftsCount}
            onToggleSuspendedPanel={handleToggleSuspendedPanel}
            hubReachable={hubReachable}
            preflightItems={preflightItems}
            showPrimaryAction={false}
            showPreflightPanel={false}
          />
        </section>
      </div>

      <SalesMobileCheckoutBar
        draftSummary={draftSummary}
        cashSession={activeCashSession}
        canCharge={canCharge}
        canOpenCashSession={canOpenCashSession}
        canCloseCashSession={canCloseCashSession}
        onOpenSearch={() => handleOpenProductSearch()}
        onCharge={handleOpenPaymentModal}
        onOpenCashSession={handleOpenCashSessionModal}
        onCloseCashSession={handleOpenCloseCashSessionModal}
        canSuspend={canCharge && !isResumedCart}
        onSuspend={handleOpenSuspendPrompt}
        onNewSale={handleNewSale}
        suspendedDraftsCount={suspendedDraftsCount}
        onToggleSuspendedPanel={handleToggleSuspendedPanel}
        hubReachable={hubReachable}
      />

      {/* Historial detrás de un cajón lateral. El header del
          Drawer aporta el botón de cerrar; la tabla conserva su propio
          título, por eso el Drawer va sin `title` (solo `ariaLabel`).
          `restoreFocusTo` devuelve el foco a la barra de búsqueda al cerrar
          para mantener el flujo de cajero (). */}
      {isHistoryDrawerOpen && (
        <Drawer
          isOpen
          onClose={() => setIsHistoryDrawerOpen(false)}
          ariaLabel={t('view.history')}
          size="lg"
          contentClassName="p-0"
          restoreFocusTo={() => productInputRef.current}
          testId="sales-history-drawer"
        >
          <Suspense fallback={null}>
            <LazySalesHistoryDrawerContent
              onView={setSelectedSaleId}
              selectedSaleId={selectedHistorySaleId}
              onSelectedSaleIdChange={setSelectedHistorySaleId}
            />
          </Suspense>
        </Drawer>
      )}

      {/* Ventas suspendidas detrás de un cajón lateral. El panel
          trae su propio header (título + cerrar), así que el Drawer va sin
          chrome (`showCloseButton={false}`, sin `title`). Ctrl+R sigue
          abriéndolo vía `handleToggleSuspendedPanel`. */}
      {isSuspendedPanelOpen && (
        <Drawer
          isOpen
          onClose={() => setIsSuspendedPanelOpen(false)}
          ariaLabel={t('park.panelTitle')}
          showCloseButton={false}
          size="lg"
          contentClassName="p-0"
          restoreFocusTo={() => productInputRef.current}
          testId="sales-suspended-drawer"
        >
          <Suspense fallback={null}>
            <LazySuspendedSalesPanel
              isOpen
              onClose={() => setIsSuspendedPanelOpen(false)}
              onResume={handleResumeFromPanel}
            />
          </Suspense>
        </Drawer>
      )}

      {(isProductSearchOpen ||
        isPaymentModalOpen ||
        selectedSaleId !== null ||
        isSuspendLabelPromptOpen ||
        shouldRenderQuickCreateProductGate ||
        shouldRenderQuickCreateCustomerGate) && (
        <Suspense fallback={null}>
          <LazySalesModals
            isProductSearchOpen={isProductSearchOpen}
            discountSuggestionSiteId={currentSite?.id ?? null}
            productSearchDialogKey={productSearchDialogKey}
            onCloseProductSearch={() => setIsProductSearchOpen(false)}
            onSelectProduct={handleProductSelect}
            productSearchInitialQuery={productSearchInitialQuery}
            setCartItems={setCartItems}
            isPaymentModalOpen={isPaymentModalOpen}
            paymentModalKey={paymentModalKey}
            paymentTotal={draftSummary.total}
            paymentApprovalSaleId={activeWorkspace?.serverSaleId ?? null}
            paymentApprovalCustomerId={activeWorkspace?.serverCustomerId ?? null}
            paymentApprovalItems={cartItems}
            paymentApprovalDiscountAmount={approvalDiscountAmount}
            currencyCode={currencyCode}
            isPaymentSaving={isPaymentSaving}
            saleError={saleError}
            serviceChargeRate={serviceChargeRate}
            fastCashTrigger={fastCashTrigger}
            paymentRestoreFocusTo={() => productInputRef.current}
            onCustomerPriceTierChange={isResumedCart ? undefined : handlePriceTierChange}
            onClosePayment={() => {
              setIsPaymentModalOpen(false);
              setFastCashTrigger(0);
            }}
            onSubmitPayment={handleCheckout}
            selectedSaleId={selectedSaleId}
            onCloseSaleDetails={() => setSelectedSaleId(null)}
            isSuspendLabelPromptOpen={isSuspendLabelPromptOpen}
            isSuspending={isSuspending}
            suspendLabelDraft={suspendLabelDraft}
            onChangeSuspendLabel={setSuspendLabelDraft}
            onCloseSuspendPrompt={() => {
              if (isSuspending) return;
              setIsSuspendLabelPromptOpen(false);
            }}
            onConfirmSuspend={() => {
              void handleSuspendConfirm();
            }}
          />
        </Suspense>
      )}

      {(isCashSessionModalOpen ||
        isCashSessionCloseModalOpen ||
        isCashSessionMovementModalOpen ||
        dayCloseSessionId !== null) && (
        <Suspense fallback={null}>
          <LazyCashSessionModals
            isCashSessionModalOpen={isCashSessionModalOpen}
            cashSessionModalKey={cashSessionModalKey}
            isOpeningCashSession={isOpeningCashSession}
            cashSessionError={cashSessionError}
            selectedRegisterAssignment={selectedRegisterAssignment}
            onCloseOpenModal={() => setIsCashSessionModalOpen(false)}
            onSubmitOpen={handleCreateCashSession}
            isCashSessionCloseModalOpen={isCashSessionCloseModalOpen}
            cashSessionCloseModalKey={cashSessionCloseModalKey}
            activeCashSession={activeCashSession}
            isClosingCashSession={isClosingCashSession}
            cashSessionCloseError={cashSessionCloseError}
            onCloseCloseModal={() => setIsCashSessionCloseModalOpen(false)}
            onSubmitClose={handleCloseCashSession}
            suspendedDraftsCount={suspendedDraftsCount}
            isCashSessionMovementModalOpen={isCashSessionMovementModalOpen}
            cashSessionMovementModalKey={cashSessionMovementModalKey}
            isRecordingMovement={isRecordingMovement}
            cashSessionMovementError={cashSessionMovementError}
            onCloseMovementModal={() => setIsCashSessionMovementModalOpen(false)}
            onSubmitMovement={handleRecordCashMovement}
            dayCloseSessionId={dayCloseSessionId}
            onCloseDayClose={() => setDayCloseSessionId(null)}
          />
        </Suspense>
      )}
    </>
  );
}
