import type { RefObject } from 'react';
import { Receipt, Search, Store, TrendingUp, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CashSessionMovementTimeline } from '@/features/sales/CashSessionMovementTimeline';
import { CashSessionReportPanel } from '@/features/sales/CashSessionReportPanel';
import { SalesRegisterAssignmentField } from '@/features/sales/SalesRegisterAssignmentField';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { SalesQuickSearchBar } from '@/features/sales/SalesQuickSearchBar';
import type { CashMovement, CashSession, CashSessionReport, RegisterAssignment } from '@/types';

interface SalesOverviewProps {
  currentSiteName: string | null;
  isSummaryLoading: boolean;
  todaySalesTotal: number;
  transactionCount: number;
  averageOrder: number;
  draftTotal: number;
  canCharge: boolean;
  canOpenCashSession: boolean;
  canCloseCashSession: boolean;
  cashSession: CashSession | null;
  registerAssignments: RegisterAssignment[];
  selectedRegisterAssignment: RegisterAssignment | null;
  isCashSessionLoading: boolean;
  cashMovements: CashMovement[];
  isCashMovementsLoading: boolean;
  cashSessionReport: CashSessionReport | null;
  isCashSessionReportLoading: boolean;
  productSearchQuery: string;
  onProductSearchQueryChange: (value: string) => void;
  onOpenSearch: () => void;
  onCharge: () => void;
  onOpenCashSession: () => void;
  onCloseCashSession: () => void;
  onOpenMovement: () => void;
  /** ENG-062 — manager-gated cash drawer kick. When undefined the
   * button is hidden (cashier role or no escpos drawer registered). */
  onKickCashDrawer?: () => void;
  /** Whether the kick mutation is in flight. */
  isKickingCashDrawer?: boolean;
  onRegisterAssignmentChange: (assignmentId: string | null) => void;
  productInputRef: RefObject<HTMLInputElement | null>;
  /**
   * ENG-074 — same hub-reachability gate as `SalesCheckoutPanel` and
   * `SalesMobileCheckoutBar`. Mirrors the disabled-when-unreachable
   * behavior so a `hub_client` terminal cannot bypass the gate by
   * triggering checkout from the overview hero.
   */
  hubReachable?: boolean;
}

export function SalesOverview({
  currentSiteName,
  isSummaryLoading,
  todaySalesTotal,
  transactionCount,
  averageOrder,
  draftTotal,
  canCharge,
  canOpenCashSession,
  canCloseCashSession,
  cashSession,
  registerAssignments,
  selectedRegisterAssignment,
  isCashSessionLoading,
  cashMovements,
  isCashMovementsLoading,
  cashSessionReport,
  isCashSessionReportLoading,
  productSearchQuery,
  onProductSearchQueryChange,
  onOpenSearch,
  onCharge,
  onOpenCashSession,
  onCloseCashSession,
  onOpenMovement,
  onKickCashDrawer,
  isKickingCashDrawer,
  onRegisterAssignmentChange,
  productInputRef,
  hubReachable,
}: SalesOverviewProps) {
  const { t } = useTranslation('sales');
  // ENG-074 — mirror the SalesCheckoutPanel + SalesMobileCheckoutBar
  // gate so the overview hero's primary action also disables when
  // the hub is unreachable in hub_client mode.
  const isHubGated = hubReachable === false;
  const primaryActionLabel = cashSession ? t('checkout.chargeSale') : t('cashSession.openAction');
  const primaryAction = cashSession ? onCharge : onOpenCashSession;
  const primaryActionDisabled = isHubGated
    ? true
    : cashSession
      ? !canCharge
      : !canOpenCashSession;

  return (
    <section className="hero-surface p-5 sm:p-6 xl:p-7">
      <div className="relative z-10 grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(22.5rem,0.92fr)] 2xl:grid-cols-[minmax(0,1.12fr)_minmax(24rem,0.88fr)]">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <div className="metric-tile">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('page.todaySales')}
              </p>
              <p className="mt-3 text-3xl font-semibold text-secondary-950">
                {isSummaryLoading ? '—' : formatCurrency(todaySalesTotal)}
              </p>
            </div>
            <div className="metric-tile">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('page.transactions')}
              </p>
              <p className="mt-3 text-3xl font-semibold text-secondary-950">
                {isSummaryLoading ? '—' : transactionCount}
              </p>
            </div>
            <div className="metric-tile">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('page.averageOrder')}
              </p>
              <p className="mt-3 text-3xl font-semibold text-secondary-950">
                {isSummaryLoading ? '—' : formatCurrency(averageOrder)}
              </p>
            </div>
            <div className="metric-tile">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('page.draftTotal')}
              </p>
              <p className="mt-3 text-3xl font-semibold text-primary-700">{formatCurrency(draftTotal)}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <SalesQuickSearchBar
            query={productSearchQuery}
            onQueryChange={onProductSearchQueryChange}
            onSubmit={onOpenSearch}
            inputRef={productInputRef}
          />

          <div className="card-inset space-y-4 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-primary-50 text-primary-700">
                <Store className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 max-w-md">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                  {t('checkout.activeSite')}
                </p>
                <p className="mt-2 truncate text-lg font-semibold text-secondary-950">
                  {currentSiteName ?? t('checkout.noSite')}
                </p>
                <p className="mt-1 max-w-sm text-sm leading-5 text-secondary-500">
                  {t('checkout.activeSiteHint')}
                </p>
                {!cashSession && (
                  <div className="mt-4 max-w-sm">
                    <SalesRegisterAssignmentField
                      assignments={registerAssignments}
                      selectedAssignment={selectedRegisterAssignment}
                      disabled={!currentSiteName || isCashSessionLoading}
                      onChange={onRegisterAssignmentChange}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-outline" onClick={onOpenSearch}>
                <Search className="h-4 w-4" />
                {t('checkout.addProduct')}
              </button>
              <button className="btn-primary" onClick={primaryAction} disabled={primaryActionDisabled}>
                {cashSession ? <Receipt className="h-4 w-4" /> : <WalletCards className="h-4 w-4" />}
                {primaryActionLabel}
              </button>
            </div>
          </div>

          {!currentSiteName && (
            <div className="rounded-[22px] border border-warning-500/20 bg-warning-50 px-4 py-4 text-sm text-warning-700">
              {t('checkout.noSiteWarning')}
            </div>
          )}

          <div className="card-inset px-4 py-4 text-sm text-secondary-600">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-primary-50 text-primary-700">
                <WalletCards className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                  {t('cashSession.title')}
                </p>
                <p className="mt-2 text-base font-semibold text-secondary-950">
                  {isCashSessionLoading
                    ? '—'
                    : cashSession
                      ? t('cashSession.active')
                      : t('cashSession.inactive')}
                </p>
                {cashSession ? (
                  <div className="mt-3 space-y-3 text-sm text-secondary-600">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-secondary-500">{t('cashSession.register')}</p>
                        <p className="mt-1 font-medium text-secondary-900">{cashSession.registerName}</p>
                      </div>
                      <div>
                        <p className="text-secondary-500">{t('cashSession.openedAt')}</p>
                        <p className="mt-1 font-medium text-secondary-900">
                          {formatDateTime(cashSession.openedAt)}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs leading-5 text-secondary-500">{t('cashSession.blindCloseHint')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
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
                    <CashSessionMovementTimeline
                      movements={cashMovements}
                      isLoading={isCashMovementsLoading}
                    />
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-secondary-500">{t('cashSession.hint')}</p>
                )}
              </div>
            </div>
          </div>

          <CashSessionReportPanel
            report={cashSessionReport}
            isLoading={isCashSessionReportLoading}
          />

          <div className="card-inset flex items-center gap-3 px-4 py-3 text-sm text-secondary-600">
            <TrendingUp className="h-4.5 w-4.5 text-primary-700" />
            {t('checkout.keyboardHint')}
          </div>
        </div>
      </div>
    </section>
  );
}
