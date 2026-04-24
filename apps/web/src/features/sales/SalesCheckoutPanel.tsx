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
import { SalesRegisterAssignmentField } from '@/features/sales/SalesRegisterAssignmentField';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { SaleCartSummary } from '@/features/sales/saleCart';
import type { CashSession, RegisterAssignment, Site } from '@/types';

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
  onOpenSearch: () => void;
  onCharge: () => void;
  onOpenCashSession: () => void;
  onCloseCashSession: () => void;
  onOpenMovement: () => void;
  onRegisterAssignmentChange: (assignmentId: string | null) => void;
  // ENG-018b — optional multi-cart affordances. When `onSuspend` /
  // `onNewSale` are omitted the panel renders exactly like before so
  // legacy callers (Storybook, tests) stay green.
  canSuspend?: boolean;
  onSuspend?: () => void;
  onNewSale?: () => void;
  /**
   * When wired, renders a badge-button that toggles the
   * SuspendedSalesPanel. The badge count makes the feature
   * discoverable even for operators who do not know Ctrl+R.
   */
  suspendedDraftsCount?: number;
  onToggleSuspendedPanel?: () => void;
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
  onOpenSearch,
  onCharge,
  onOpenCashSession,
  onCloseCashSession,
  onOpenMovement,
  onRegisterAssignmentChange,
  canSuspend = false,
  onSuspend,
  onNewSale,
  suspendedDraftsCount = 0,
  onToggleSuspendedPanel,
}: SalesCheckoutPanelProps) {
  const { t } = useTranslation('sales');
  const primaryAction = cashSession ? onCharge : onOpenCashSession;
  const primaryActionLabel = cashSession ? t('checkout.chargeSale') : t('cashSession.openAction');
  const primaryActionDisabled = cashSession ? !canCharge : !canOpenCashSession;
  const showSuspendControls = Boolean(onSuspend || onNewSale);
  const showSuspendedToggle = Boolean(onToggleSuspendedPanel);

  return (
    <aside className="card p-5 sm:p-6 xl:sticky xl:top-24">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('checkout.kicker')}</p>
          <h2 className="mt-3 font-display text-3xl text-secondary-950">{t('checkout.chargeSummary')}</h2>
          <p className="mt-2 text-sm text-secondary-600">
            {t('checkout.chargeSummaryDescription')}
          </p>
        </div>
        <button className="btn-outline btn-icon h-11 w-11" onClick={onOpenSearch} aria-label={t('checkout.searchProducts')}>
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-6 rounded-[26px] border border-line/70 bg-secondary-950 px-5 py-5 text-white">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/55">{t('checkout.totalDue')}</p>
        <p className="mt-3 text-4xl font-semibold tracking-tight">{formatCurrency(draftSummary.total)}</p>
        <div className="mt-6 grid gap-3 text-sm text-white/72">
          <div className="flex items-center justify-between">
            <span>{t('checkout.itemCount')}</span>
            <span className="font-semibold text-white">{draftSummary.itemCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('checkout.subtotal')}</span>
            <span className="font-semibold text-white">{formatCurrency(draftSummary.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('checkout.vat')}</span>
            <span className="font-semibold text-white">{formatCurrency(draftSummary.taxAmount)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="card-inset px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-primary-50 text-primary-700">
              <ScanLine className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-secondary-950">{t('checkout.searchProducts')}</p>
              <p className="mt-1 text-sm text-secondary-500">
                {t('checkout.searchHint')}
              </p>
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
                  <p>{t('cashSession.openedAt')}: {formatDateTime(cashSession.openedAt)}</p>
                  <p>{t('cashSession.blindCloseHint')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="btn-outline" onClick={onOpenMovement}>
                      <WalletCards className="h-4 w-4" />
                      {t('cashSession.recordMovementAction')}
                    </button>
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
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
            {t('checkout.shortcuts')}
          </p>
          <p className="mt-2">{t('checkout.shortcutsHint')}</p>
        </div>

        <button
          className="btn-primary hidden w-full justify-center xl:inline-flex"
          onClick={primaryAction}
          disabled={primaryActionDisabled}
        >
          {cashSession ? <Receipt className="h-4 w-4" /> : <WalletCards className="h-4 w-4" />}
          {primaryActionLabel}
        </button>

        {showSuspendControls && (
          <div className="hidden gap-2 xl:flex" data-testid="checkout-park-controls">
            {onSuspend && (
              <button
                type="button"
                className="btn-outline flex-1 justify-center"
                onClick={onSuspend}
                disabled={!canSuspend}
                data-testid="checkout-suspend"
              >
                <PauseCircle className="h-4 w-4" />
                {t('park.suspend')}
              </button>
            )}
            {onNewSale && (
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
