import { AlertTriangle, ReceiptText, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import type { CashSession, CashSessionReport } from '@/types';

const REVIEW_EPSILON = 0.009;

interface CashSessionReportPanelProps {
  report: CashSessionReport | null;
  isLoading: boolean;
}

function getSignedCurrencyLabel(amount: number) {
  if (Math.abs(amount) < REVIEW_EPSILON) {
    return formatCurrency(0);
  }

  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount))}`;
}

function getClosureTone(overShort: number | null | undefined) {
  if (Math.abs(overShort ?? 0) < REVIEW_EPSILON) {
    return {
      labelKey: 'cashSession.report.statusBalanced',
      badgeClassName: 'bg-success-50 text-success-700',
      valueClassName: 'text-success-700',
    };
  }

  if ((overShort ?? 0) > 0) {
    return {
      labelKey: 'cashSession.report.statusOver',
      badgeClassName: 'bg-primary-50 text-primary-700',
      valueClassName: 'text-primary-700',
    };
  }

  return {
    labelKey: 'cashSession.report.statusShort',
    badgeClassName: 'bg-warning-50 text-warning-700',
    valueClassName: 'text-warning-700',
  };
}

function RecentClosureItem({ closure }: { closure: CashSession }) {
  const { t } = useTranslation('sales');
  const tone = getClosureTone(closure.overShort);

  return (
    <article className="surface-panel py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-secondary-950">{closure.registerName}</p>
          <p className="mt-1 text-xs text-secondary-500">
            {t('cashSession.report.cashier')}: {closure.cashierName ?? t('cashSession.timeline.unknownCashier')}
          </p>
          <p className="mt-1 text-xs text-secondary-500">
            {t('cashSession.report.closedAt')}: {closure.closedAt ? formatDateTime(closure.closedAt) : '—'}
          </p>
        </div>
        <div className="text-right">
          <span
            className={cn(
              'inline-flex rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em]',
              tone.badgeClassName
            )}
          >
            {t(tone.labelKey)}
          </span>
          <p className="mt-2 text-xs text-secondary-500">{t('cashSession.report.discrepancy')}</p>
          <p className={cn('mt-1 text-sm font-semibold', tone.valueClassName)}>
            {getSignedCurrencyLabel(closure.overShort ?? 0)}
          </p>
        </div>
      </div>
    </article>
  );
}

export function CashSessionReportPanel({ report, isLoading }: CashSessionReportPanelProps) {
  const { t } = useTranslation('sales');
  const summary = report?.summary ?? {
    activeSessionCount: 0,
    activeRegisterCount: 0,
    recentClosureCount: 0,
    reviewCount: 0,
    netOverShort: 0,
    largestDiscrepancy: 0,
  };
  const activeSessions = report?.activeSessions ?? [];
  const recentClosures = report?.recentClosures ?? [];
  const reviewAlerts = recentClosures.filter(
    closure => Math.abs(closure.overShort ?? 0) > 0.009
  );

  return (
    <section className="card-inset space-y-4 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-primary-50 text-primary-700">
          <ReceiptText className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
            {t('cashSession.report.title')}
          </p>
          <p className="mt-2 text-sm text-secondary-600">{t('cashSession.report.description')}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="surface-empty">{t('cashSession.report.loading')}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <div className="surface-panel">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('cashSession.report.activeSessionsMetric')}
              </p>
              <p className="mt-2 text-2xl font-semibold text-secondary-950">
                {summary.activeSessionCount}
              </p>
            </div>
            <div className="surface-panel">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('cashSession.report.activeRegistersMetric')}
              </p>
              <p className="mt-2 text-2xl font-semibold text-secondary-950">
                {summary.activeRegisterCount}
              </p>
            </div>
            <div className="surface-panel">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('cashSession.report.reviewCountMetric')}
              </p>
              <p className="mt-2 text-2xl font-semibold text-secondary-950">{summary.reviewCount}</p>
            </div>
            <div className="surface-panel">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                {t('cashSession.report.netOverShortMetric')}
              </p>
              <p
                className={cn(
                  'mt-2 text-2xl font-semibold',
                  summary.netOverShort < 0 ? 'text-warning-700' : 'text-secondary-950'
                )}
              >
                {getSignedCurrencyLabel(summary.netOverShort)}
              </p>
            </div>
          </div>

          <div
            className={cn(
              'rounded-[20px] border px-4 py-4 text-sm',
              reviewAlerts.length > 0
                ? 'border-warning-500/20 bg-warning-50 text-warning-800'
                : 'border-success-500/15 bg-success-50 text-success-800'
            )}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">{t('cashSession.report.alertsTitle')}</p>
                <p className="mt-1">
                  {reviewAlerts.length > 0
                    ? t('cashSession.report.alertsDescription', { count: reviewAlerts.length })
                    : t('cashSession.report.noAlerts')}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <WalletCards className="h-4.5 w-4.5 text-primary-700" />
                <p className="text-sm font-semibold text-secondary-950">
                  {t('cashSession.report.activeSessionsTitle')}
                </p>
              </div>
              {activeSessions.length === 0 ? (
                <div className="surface-empty">{t('cashSession.report.activeSessionsEmpty')}</div>
              ) : (
                <div className="space-y-2">
                  {activeSessions.map(session => (
                    <article key={session.id} className="surface-panel py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-secondary-950">
                            {session.registerName}
                          </p>
                          <p className="mt-1 text-xs text-secondary-500">
                            {t('cashSession.report.cashier')}:{' '}
                            {session.cashierName ?? t('cashSession.timeline.unknownCashier')}
                          </p>
                          <p className="mt-1 text-xs text-secondary-500">
                            {t('cashSession.openedAt')}: {formatDateTime(session.openedAt)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-secondary-500">
                            {t('cashSession.report.openingFloat')}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-secondary-950">
                            {formatCurrency(session.openingFloat)}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-4.5 w-4.5 text-primary-700" />
                <p className="text-sm font-semibold text-secondary-950">
                  {t('cashSession.report.recentClosuresTitle')}
                </p>
              </div>
              {recentClosures.length === 0 ? (
                <div className="surface-empty">{t('cashSession.report.recentClosuresEmpty')}</div>
              ) : (
                <div className="space-y-2">
                  {recentClosures.map(closure => (
                    <RecentClosureItem key={closure.id} closure={closure} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
