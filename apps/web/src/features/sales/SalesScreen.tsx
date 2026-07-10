import { type ComponentProps, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from '@/components/feedback/Drawer';
import { SalesCartWorkspace } from '@/features/sales/SalesCartWorkspace';
import { SalesCheckoutPanel } from '@/features/sales/SalesCheckoutPanel';
import { CashSessionModals } from '@/features/sales/CashSessionModals';
import { SalesHeaderSection } from '@/features/sales/SalesHeaderSection';
import { SalesModals } from '@/features/sales/SalesModals';
import { WorkspaceTabsSection } from '@/features/sales/WorkspaceTabsSection';
import { SalesHistoryTable } from '@/features/sales/SalesHistoryTable';
import { SalesMobileCheckoutBar } from '@/features/sales/SalesMobileCheckoutBar';
import { SuspendedSalesPanel } from '@/features/sales/SuspendedSalesPanel';

type HeaderProps = ComponentProps<typeof SalesHeaderSection>;
type TabsProps = ComponentProps<typeof WorkspaceTabsSection>;
type CartProps = ComponentProps<typeof SalesCartWorkspace>;
type CheckoutProps = ComponentProps<typeof SalesCheckoutPanel>;
type HistoryProps = ComponentProps<typeof SalesHistoryTable>;
type SuspendedProps = ComponentProps<typeof SuspendedSalesPanel>;
type ModalsProps = ComponentProps<typeof SalesModals>;
type CashModalsProps = ComponentProps<typeof CashSessionModals>;

/**
 * Props for {@link SalesScreen}.
 *
 * ENG-178 slice 16b-2 — SalesPage's entire `return` JSX was relocated here so
 * the shell drops below the 500-LOC ceiling. SalesScreen is PURELY
 * presentational: it owns no state, runs no queries/mutations, and forwards
 * every value/handler to the already-extracted child components. The shell
 * assembles these props from its hooks. Forwarded handler/ref types are pinned
 * to the child components via `ComponentProps` indexed access so the seam
 * cannot drift; the tRPC query/mutation objects the old JSX read inline are
 * passed as DERIVED values instead (`salesLoading`/`salesError`/`onRetrySales`,
 * `isCashSessionLoading`, the four `is*ing*` pending flags) so a presentational
 * component never touches a query/mutation handle.
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
  saleError: CartProps['saleError'];
  handleQuantityChange: CartProps['onQuantityChange'];
  handleDiscountChange: CartProps['onDiscountChange'];
  handleRemoveItem: CartProps['onRemove'];
  setSelectedCartItemKey: CartProps['onSelectItem'];
  handleClearCart: CartProps['onClearCart'];
  quantityInputRefFor: CartProps['quantityInputRefFor'];
  discountInputRefFor: CartProps['discountInputRefFor'];
  canUndoActiveCart: boolean;
  handleUndoCart: () => void;
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
  sales: HistoryProps['sales'];
  salesLoading: boolean;
  salesError: string | null;
  onRetrySales: () => void;
  setSelectedSaleId: Dispatch<SetStateAction<string | null>>;
  selectedHistorySaleId: string | null;
  setSelectedHistorySaleId: Dispatch<SetStateAction<string | null>>;
  // Suspended-sales drawer
  isSuspendedPanelOpen: boolean;
  handleResumeFromPanel: SuspendedProps['onResume'];
  // Sales modals (product search / payment / sale details / suspend prompt)
  isProductSearchOpen: boolean;
  productSearchDialogKey: number;
  setIsProductSearchOpen: Dispatch<SetStateAction<boolean>>;
  handleProductSelect: ModalsProps['onSelectProduct'];
  categories: ModalsProps['categories'];
  providers: ModalsProps['providers'];
  productSearchInitialQuery: string;
  setCartItems: ModalsProps['setCartItems'];
  isPaymentModalOpen: boolean;
  paymentModalKey: number;
  customers: ModalsProps['customers'];
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
  /** ENG-198 — the just-closed session whose day-close ritual is showing. */
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
  saleError,
  handleQuantityChange,
  handleDiscountChange,
  handleRemoveItem,
  setSelectedCartItemKey,
  handleClearCart,
  quantityInputRefFor,
  discountInputRefFor,
  canUndoActiveCart,
  handleUndoCart,
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
  sales,
  salesLoading,
  salesError,
  onRetrySales,
  setSelectedSaleId,
  selectedHistorySaleId,
  setSelectedHistorySaleId,
  isSuspendedPanelOpen,
  handleResumeFromPanel,
  isProductSearchOpen,
  productSearchDialogKey,
  setIsProductSearchOpen,
  handleProductSelect,
  categories,
  providers,
  productSearchInitialQuery,
  setCartItems,
  isPaymentModalOpen,
  paymentModalKey,
  customers,
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
      <div className="sales-pos-shell space-y-4 pb-24 xl:flex pos:min-h-0 xl:flex-col xl:gap-4 xl:space-y-0 pos:overflow-hidden pos:pb-0">
        {/* ENG-186/189 — el POS es la única superficie de /sales. En el
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

        <section className="grid gap-6 pos:min-h-0 pos:flex-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,360px)] pos:grid-rows-[minmax(0,1fr)]">
          <SalesCartWorkspace
            items={cartItems}
            discountSuggestionSiteId={currentSite?.id ?? null}
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
            canUndo={canUndoActiveCart}
            onUndo={handleUndoCart}
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

      {/* ENG-186 — Historial detrás de un cajón lateral. El header del
          Drawer aporta el botón de cerrar; la tabla conserva su propio
          título, por eso el Drawer va sin `title` (solo `ariaLabel`).
          `restoreFocusTo` devuelve el foco a la barra de búsqueda al cerrar
          para mantener el flujo de cajero (ENG-105f). */}
      <Drawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
        ariaLabel={t('view.history')}
        size="lg"
        contentClassName="p-0"
        restoreFocusTo={() => productInputRef.current}
        testId="sales-history-drawer"
      >
        <SalesHistoryTable
          sales={sales}
          isLoading={salesLoading}
          error={salesError}
          onRetry={onRetrySales}
          onView={setSelectedSaleId}
          selectedSaleId={selectedHistorySaleId}
          onSelectedSaleIdChange={setSelectedHistorySaleId}
        />
      </Drawer>

      {/* ENG-186 — Ventas suspendidas detrás de un cajón lateral. El panel
          trae su propio header (título + cerrar), así que el Drawer va sin
          chrome (`showCloseButton={false}`, sin `title`). Ctrl+R sigue
          abriéndolo vía `handleToggleSuspendedPanel`. */}
      <Drawer
        isOpen={isSuspendedPanelOpen}
        onClose={() => setIsSuspendedPanelOpen(false)}
        ariaLabel={t('park.panelTitle')}
        showCloseButton={false}
        size="lg"
        contentClassName="p-0"
        restoreFocusTo={() => productInputRef.current}
        testId="sales-suspended-drawer"
      >
        <SuspendedSalesPanel
          isOpen={isSuspendedPanelOpen}
          onClose={() => setIsSuspendedPanelOpen(false)}
          onResume={handleResumeFromPanel}
        />
      </Drawer>

      <SalesModals
        isProductSearchOpen={isProductSearchOpen}
        discountSuggestionSiteId={currentSite?.id ?? null}
        productSearchDialogKey={productSearchDialogKey}
        onCloseProductSearch={() => setIsProductSearchOpen(false)}
        onSelectProduct={handleProductSelect}
        categories={categories}
        providers={providers}
        productSearchInitialQuery={productSearchInitialQuery}
        setCartItems={setCartItems}
        isPaymentModalOpen={isPaymentModalOpen}
        paymentModalKey={paymentModalKey}
        paymentTotal={draftSummary.total}
        customers={customers}
        isPaymentSaving={isPaymentSaving}
        saleError={saleError}
        serviceChargeRate={serviceChargeRate}
        fastCashTrigger={fastCashTrigger}
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

      <CashSessionModals
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
    </>
  );
}
