import {
  FilePlus2,
  ListTree,
  PauseCircle,
  Plus,
  Receipt,
  ScanLine,
  WalletCards,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CheckoutPreflightPanel,
  PREFLIGHT_PRIMARY_ELEMENT_ID,
} from '@/features/sales/CheckoutPreflightPanel';
import { SalesRegisterAssignmentField } from '@/features/sales/SalesRegisterAssignmentField';
import { ariaKeyshortcutsFor, formatKeysForDisplay, getShortcutById } from '@/lib/shortcuts';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { PreflightItem } from '@/features/sales/useCheckoutPreflight';
import type { SaleCartSummary } from '@/features/sales/saleCart';
import type { CashSession, RegisterAssignment, Site, UserRole } from '@/types';

// ENG-179b — explicit `| undefined` on optional fields.
interface SalesCheckoutPanelProps {
  currentSite: Site | null;
  cashSession: CashSession | null;
  registerAssignments: RegisterAssignment[];
  selectedRegisterAssignment: RegisterAssignment | null;
  isCashSessionLoading: boolean;
  draftSummary: SaleCartSummary;
  canCharge: boolean;
  canOpenCashSession: boolean;
  canCloseCashSession: boolean;
  /** ENG-194 — selects blind-close versus supervised-close guidance. */
  userRole?: UserRole | undefined;
  onOpenSearch: () => void;
  onCharge: () => void;
  onOpenCashSession: () => void;
  onCloseCashSession: () => void;
  onOpenMovement: () => void;
  /** ENG-062 — manager-gated cash drawer kick. When undefined the
   * button is hidden (cashier role or no escpos drawer registered).
   * Relocated here from the retired SalesOverview hero so the manager
   * hardware action survives the §06 minimal POS restructure. */
  onKickCashDrawer?: (() => void | Promise<void>) | undefined;
  /** Whether the kick mutation is in flight. */
  isKickingCashDrawer?: boolean | undefined;
  onRegisterAssignmentChange: (assignmentId: string | null) => void;
  // ENG-018b — optional multi-cart affordances. When `onSuspend` /
  // `onNewSale` are omitted the panel renders exactly like before so
  // legacy callers (Storybook, tests) stay green.
  canSuspend?: boolean | undefined;
  onSuspend?: (() => void) | undefined;
  onNewSale?: (() => void) | undefined;
  /**
   * When wired, renders a badge-button that toggles the
   * SuspendedSalesPanel. The badge count makes the feature
   * discoverable even for operators who do not know Ctrl+R.
   */
  suspendedDraftsCount?: number | undefined;
  onToggleSuspendedPanel?: (() => void) | undefined;
  /**
   * ENG-074 — when the renderer runs in `hub_client` mode and the
   * Store Hub is unreachable, this prop is set to `false` to
   * gate every operational primary action (charge sale, open
   * cash session). `undefined` keeps the historical behavior for
   * `device_local` installs (the parent never wires the prop in
   * that mode). `true` is the explicit reachable signal.
   */
  hubReachable?: boolean | undefined;
  /**
   * ENG-105b — checkout preflight items. Each entry blocks (severity
   * `blocker`, disables Cobrar) or warns (severity `warning`, leaves
   * Cobrar enabled). Default `[]` keeps legacy callers (Storybook,
   * existing tests) rendering exactly like before.
   */
  preflightItems?: readonly PreflightItem[] | undefined;
}

function shortcutLabel(id: string): string {
  const shortcut = getShortcutById(id);
  return shortcut ? formatKeysForDisplay(shortcut.keys) : '';
}

export function SalesCheckoutPanel({
  currentSite,
  cashSession,
  registerAssignments,
  selectedRegisterAssignment,
  isCashSessionLoading,
  draftSummary,
  canCharge,
  canOpenCashSession,
  canCloseCashSession,
  userRole = 'cashier',
  onOpenSearch,
  onCharge,
  onOpenCashSession,
  onCloseCashSession,
  onOpenMovement,
  onKickCashDrawer,
  isKickingCashDrawer,
  onRegisterAssignmentChange,
  canSuspend = false,
  onSuspend,
  onNewSale,
  suspendedDraftsCount = 0,
  onToggleSuspendedPanel,
  hubReachable,
  preflightItems = [],
}: SalesCheckoutPanelProps) {
  const { t } = useTranslation('sales');
  const hasSupervisedClose = userRole === 'admin' || userRole === 'manager';
  // ENG-074 — when the parent passes `hubReachable === false`, every
  // operational primary action is gated. The renderer never reaches
  // this branch in `device_local` mode because the parent does not
  // wire the prop there. `undefined` and `true` are both treated as
  // "do not gate" so existing flows are unchanged.
  const isHubGated = hubReachable === false;
  // ENG-105b — preflight gate. Any blocker disables Cobrar; warnings
  // do not (the operator still controls the call).
  const preflightHasBlockers = preflightItems.some(item => item.severity === 'blocker');
  const primaryAction = cashSession ? onCharge : onOpenCashSession;
  const primaryActionLabel = cashSession ? t('checkout.chargeSale') : t('cashSession.openAction');
  const primaryActionDisabled = isHubGated
    ? true
    : cashSession
      ? !canCharge || preflightHasBlockers
      : !canOpenCashSession;
  // Keep unavailable Suspend out of the tab order; the shortcut catalogue
  // already owns discovery, and disabled button opacity fails contrast here.
  const showSuspendAction = Boolean(onSuspend && canSuspend);
  const showNewSaleAction = Boolean(onNewSale);
  const showSuspendControls = showSuspendAction || showNewSaleAction;
  const showSuspendedToggle = Boolean(onToggleSuspendedPanel);

  return (
    <aside className="card p-5 sm:p-6 xl:flex pos:h-full pos:min-h-0 xl:flex-col pos:overflow-hidden">
      <div className="flex items-start justify-between gap-4 xl:shrink-0">
        <div>
          <p className="pv-kicker">{t('checkout.kicker')}</p>
          <h2 className="pv-title text-xl">{t('checkout.chargeSummary')}</h2>
          <p className="mt-2 text-sm text-secondary-600">
            {t('checkout.chargeSummaryDescription')}
          </p>
        </div>
        <button
          className="pv-btn outline min-h-11 h-11 w-11 p-0"
          onClick={onOpenSearch}
          aria-label={t('checkout.searchProducts')}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="pv-total mt-6 xl:shrink-0">
        <div className="lbl">{t('checkout.totalDue')}</div>
        <div className="fig">{formatCurrency(draftSummary.total)}</div>
        <div className="brk">
          <div className="ln">
            <span>{t('checkout.itemsWithCount', { value: draftSummary.itemCount })}</span>
            <span className="amt">{formatCurrency(draftSummary.subtotal)}</span>
          </div>
          <div className="ln">
            <span>{t('checkout.vat')}</span>
            <span className="amt">{formatCurrency(draftSummary.taxAmount)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-3 pos:min-h-0 pos:flex-1 pos:overflow-y-auto">
        {/* ENG-081 V4 — "Último escaneado" + "Sugerencia rápida". When the
         * cart is empty we surface a 4-tile dashed-border grid as a hint
         * to the cashier (scan, scan again, search, suggest). When the
         * cart has items, the dashed grid hides and the most-recent line
         * surfaces as a one-row badge so the operator can verify the
         * last scan at a glance. */}
        {draftSummary.itemCount > 0 ? (
          <div className="card-inset relative overflow-hidden px-4 py-3">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 92% 0%, color-mix(in oklch, var(--primary) 12%, transparent), transparent 55%)',
              }}
            />
            <div className="relative flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-primary-700">
                  {t('checkout.lastScanned', { defaultValue: 'Último escaneado' })}
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-secondary-950">
                  {t('checkout.lastScannedHint', {
                    defaultValue: '{{count}} ítems en carrito · revisa el total',
                    count: draftSummary.itemCount,
                  })}
                </p>
              </div>
              <ScanLine className="h-4 w-4 shrink-0 text-primary-700" aria-hidden="true" />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-line bg-surface/40 px-3 py-3">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-secondary-500">
              {t('checkout.quickSuggestionKicker', { defaultValue: 'Sugerencia rápida' })}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ['scan', t('checkout.suggestionScan', { defaultValue: 'Escanea producto' })],
                  ['barcode', t('checkout.suggestionBarcode', { defaultValue: 'Pega código' })],
                  ['search', t('checkout.suggestionSearch', { defaultValue: 'Busca SKU' })],
                  ['waiting', t('checkout.suggestionWaiting', { defaultValue: 'Esperando…' })],
                ] as const
              ).map(([key, label]) => (
                <div
                  key={key}
                  className="rounded-xl border border-dashed border-line/70 bg-surface/70 px-2.5 py-2"
                >
                  <p className="text-[11px] leading-4 text-secondary-600">{label}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] text-secondary-500">
              {t('checkout.quickSuggestionHelper', {
                defaultValue:
                  'Las sugerencias por catálogo aparecen aquí cuando estén disponibles.',
              })}
            </p>
          </div>
        )}

        <div className="card-inset px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-primary-50 text-primary-700">
              <ScanLine className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-secondary-950">
                {t('checkout.searchProducts')}
              </p>
              <p className="mt-1 text-sm text-secondary-500">{t('checkout.searchHint')}</p>
            </div>
          </div>
        </div>

        <div className="card-inset px-4 py-4 text-sm text-secondary-600">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
            {t('checkout.chargeSite')}
          </p>
          <p className="mt-2 text-base font-semibold text-secondary-950">
            {currentSite?.name ?? t('checkout.noSite')}
          </p>
          {!cashSession && (
            <div className="mt-4">
              <SalesRegisterAssignmentField
                assignments={registerAssignments}
                selectedAssignment={selectedRegisterAssignment}
                disabled={!currentSite || isCashSessionLoading}
                onChange={onRegisterAssignmentChange}
              />
            </div>
          )}
        </div>

        <div className="card-inset px-4 py-4 text-sm text-secondary-600">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-primary-50 text-primary-700">
              <WalletCards className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('cashSession.title')}
              </p>
              <p className="mt-2 font-semibold text-secondary-950">
                {isCashSessionLoading
                  ? '—'
                  : cashSession
                    ? cashSession.registerName
                    : t('cashSession.inactive')}
              </p>
              {cashSession ? (
                <div className="mt-2 space-y-1">
                  <p>
                    {t('cashSession.openedAt')}: {formatDateTime(cashSession.openedAt)}
                  </p>
                  <p>
                    {t(
                      hasSupervisedClose
                        ? 'cashSession.supervisedCloseHint'
                        : 'cashSession.blindCloseHint'
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="btn-outline" onClick={onOpenMovement}>
                      <WalletCards className="h-4 w-4" />
                      {t('cashSession.recordMovementAction')}
                    </button>
                    {onKickCashDrawer && (
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={onKickCashDrawer}
                        disabled={isKickingCashDrawer === true}
                        data-testid="sales-kick-drawer"
                      >
                        <WalletCards className="h-4 w-4" />
                        {t('printer.kickDrawerCta')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={onCloseCashSession}
                      disabled={!canCloseCashSession}
                    >
                      <WalletCards className="h-4 w-4" />
                      {t('cashSession.closeAction')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2">{t('cashSession.chargeBlocked')}</p>
              )}
            </div>
          </div>
        </div>

        <div className="card-inset px-4 py-4 text-sm text-secondary-600">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-secondary-500">
            {t('checkout.shortcuts')}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[12px] sm:grid-cols-4">
            {(
              [
                [
                  shortcutLabel('sales.productSearch'),
                  t('checkout.shortcut.search', { defaultValue: 'Buscar' }),
                ],
                [
                  shortcutLabel('sales.suspend'),
                  t('checkout.shortcut.suspend', { defaultValue: 'Pausar' }),
                ],
                [
                  shortcutLabel('sales.toggleSuspended'),
                  t('checkout.shortcut.resume', { defaultValue: 'Retomar' }),
                ],
                [
                  shortcutLabel('sales.charge'),
                  t('checkout.shortcut.charge', { defaultValue: 'Cobrar' }),
                ],
                // ENG-105e — F2 fast-cash chip lives next to the F1
                // Cobrar chip so the cashier discovers the one-keystroke
                // exact-cash flow without opening the Command Palette.
                [
                  shortcutLabel('sales.fastCash'),
                  t('checkout.shortcut.fastCash', { defaultValue: 'Cobro rápido' }),
                ],
              ] as const
            ).map(([keyLabel, action], index) => (
              <div
                // Static list — index keys are stable here, and two
                // shortcuts can legitimately format to the same key label.
                key={index}
                className="flex items-center gap-2 rounded-xl border border-line/70 bg-surface px-2.5 py-1.5"
              >
                <kbd className="pv-kbd">{keyLabel}</kbd>
                <span className="truncate text-[11px] text-secondary-700">{action}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-secondary-500">{t('checkout.shortcutsHint')}</p>
        </div>

        {preflightItems.length > 0 && <CheckoutPreflightPanel items={preflightItems} />}
      </div>

      {/* ENG-186/189 (review follow-up) — in the `pos:` lockup this is the
          pinned action footer so Cobrar stays in view while the block above it
          scrolls. At xl-but-short viewports it remains in normal page flow so
          cash controls are reachable. Below xl these actions are hidden (the
          SalesMobileCheckoutBar owns mobile), so the footer is inert there. */}
      <div className="space-y-3 xl:shrink-0 xl:border-t xl:border-line/70 xl:pt-4">
        <button
          className="pv-btn primary lg hidden w-full justify-center xl:inline-flex"
          onClick={primaryAction}
          disabled={primaryActionDisabled}
          data-testid="checkout-primary-action"
          aria-keyshortcuts={cashSession ? ariaKeyshortcutsFor('sales.charge') : undefined}
          aria-describedby={preflightHasBlockers ? PREFLIGHT_PRIMARY_ELEMENT_ID : undefined}
        >
          {cashSession ? <Receipt className="h-4 w-4" /> : <WalletCards className="h-4 w-4" />}
          {primaryActionLabel}
        </button>

        {isHubGated && (
          <p
            className="hidden text-xs text-danger-600 xl:block"
            data-testid="checkout-hub-gate-hint"
          >
            {t('checkout.hubGatedHint')}
          </p>
        )}

        {showSuspendControls && (
          <div className="hidden gap-2 xl:flex" data-testid="checkout-park-controls">
            {showSuspendAction && (
              <button
                type="button"
                className="btn-outline flex-1 justify-center"
                onClick={onSuspend}
                data-testid="checkout-suspend"
                aria-keyshortcuts={ariaKeyshortcutsFor('sales.suspend')}
              >
                <PauseCircle className="h-4 w-4" />
                {t('park.suspend')}
              </button>
            )}
            {showNewSaleAction && (
              <button
                type="button"
                className="btn-outline flex-1 justify-center"
                onClick={onNewSale}
                data-testid="checkout-new-sale"
              >
                <FilePlus2 className="h-4 w-4" />
                {t('park.newSale')}
              </button>
            )}
          </div>
        )}

        {showSuspendedToggle && (
          <button
            type="button"
            className="btn-ghost hidden w-full justify-between xl:inline-flex"
            onClick={onToggleSuspendedPanel}
            data-testid="checkout-open-suspended-panel"
            aria-keyshortcuts={ariaKeyshortcutsFor('sales.toggleSuspended')}
          >
            <span className="inline-flex items-center gap-2">
              <ListTree className="h-4 w-4" />
              {t('park.panelTitle')}
            </span>
            {suspendedDraftsCount > 0 && (
              <span
                className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700"
                data-testid="suspended-drafts-badge"
              >
                {suspendedDraftsCount}
              </span>
            )}
          </button>
        )}
      </div>
    </aside>
  );
}
