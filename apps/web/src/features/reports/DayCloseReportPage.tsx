import { useMemo, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import {
  AlertTriangle,
  Banknote,
  Bot,
  CheckCircle2,
  FileCheck2,
  Landmark,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Scale,
  ShoppingBag,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useToast } from '@/components/feedback/ToastProvider';
import { KpiTile } from '@/components/ui';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { formatCurrency, formatDate } from '@/lib/utils';
import { translateServerError } from '@/lib/translateServerError';
import { fetchProtectedApi, trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { downloadFile } from '@/services/export/exportService';
import { DayCloseSignoffCard } from './DayCloseSignoffCard';

type DayCloseReport = inferRouterOutputs<AppRouter>['reports']['dayClose']['preview'];
type ReadinessCode = DayCloseReport['readiness']['warnings'][number];

function calendarDayAt(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

const SECTION_CLASS = 'card space-y-4 p-5 sm:p-6';
const METRIC_CLASS = 'rounded-2xl border border-secondary-200 bg-secondary-50/70 p-4';

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className={METRIC_CLASS}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary-500">
        {label}
      </p>
      <p className="mt-1.5 font-display text-xl tabular-nums text-secondary-950">{value}</p>
      {detail && <p className="mt-1 text-xs text-secondary-500">{detail}</p>}
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof ShoppingBag; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-semibold text-secondary-950">
      <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
      {title}
    </h2>
  );
}

/** ENG-141a/ENG-141b — manager report with immutable sign-off evidence. */
export function DayCloseReportPage() {
  const { t } = useTranslation(['reports', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const locale = useResolvedLocale();
  const today = useMemo(() => calendarDayAt(new Date(), locale.timezone), [locale.timezone]);
  // Keep following the tenant timezone while locale state hydrates. Once the
  // operator picks a date, preserve that explicit choice.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const date = selectedDate ?? today;
  const signoffQuery = trpc.reports.dayClose.signoff.useQuery({ date }, { staleTime: 30_000 });
  const signoff = signoffQuery.data ?? null;
  const reportQuery = trpc.reports.dayClose.preview.useQuery(
    { date },
    { staleTime: 30_000, enabled: signoffQuery.isSuccess && !signoff }
  );
  const report = signoff?.report ?? reportQuery.data;
  const signOffMutation = useCriticalMutation('reports.dayClose.signOff', {
    onSuccess: async (_signed, variables) => {
      await utils.reports.dayClose.signoff.invalidate({ date: variables.date });
      toast.success({
        title: t('reports:dayClose.signoff.successTitle'),
        description: t('reports:dayClose.signoff.successDescription'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'reports:dayClose.signoff.errorTitle',
    }),
  });
  const isLoading =
    signoffQuery.isPending || (signoffQuery.isSuccess && !signoff && reportQuery.isPending);
  const queryError = signoffQuery.error ?? reportQuery.error;
  const isRefreshing = signoffQuery.isFetching || reportQuery.isFetching;

  const refresh = async () => {
    const refreshedSignoff = await signoffQuery.refetch();
    if (!refreshedSignoff.data) await reportQuery.refetch();
  };

  const downloadSignedPdf = async () => {
    if (!signoff?.pdf) return;
    setIsDownloadingPdf(true);
    try {
      const response = await fetchProtectedApi(
        `/api/reports/day-close/artifacts/${encodeURIComponent(signoff.pdf.id)}`
      );
      if (!response.ok) throw new Error(`Day-close PDF download failed with ${response.status}`);
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
      if (contentType !== signoff.pdf.mimeType)
        throw new Error('Unexpected day-close PDF MIME type');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== signoff.pdf.byteSize) throw new Error('Day-close PDF size mismatch');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const payloadHash = Array.from(new Uint8Array(digest), byte =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      if (payloadHash !== signoff.pdf.payloadHash) throw new Error('Day-close PDF hash mismatch');
      downloadFile(new Blob([bytes], { type: signoff.pdf.mimeType }), signoff.pdf.filename);
      toast.success({
        title: t('reports:dayClose.signoff.pdfDownloadedTitle'),
        description: t('reports:dayClose.signoff.pdfDownloadedDescription'),
      });
    } catch {
      toast.error({ title: t('reports:dayClose.signoff.pdfDownloadError') });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="day-close-report-page">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="pv-kicker">{t('dayClose.kicker')}</p>
          <h1 className="pv-title text-2xl">{t('dayClose.title')}</h1>
          <p className="mt-2 max-w-3xl text-sm text-secondary-500">{t('dayClose.description')}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block">
            <span className="label">{t('dayClose.dateLabel')}</span>
            <input
              type="date"
              className="input mt-1 min-w-[10.5rem]"
              value={date}
              max={today}
              onChange={event => setSelectedDate(event.target.value || today)}
            />
          </label>
          <button
            type="button"
            className="pv-btn outline justify-center"
            onClick={() => void refresh()}
            disabled={isRefreshing}
          >
            <RefreshCw className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />
            {t('dayClose.refresh')}
          </button>
        </div>
      </header>

      {isLoading && (
        <div className="card p-8 text-center text-sm text-secondary-500" role="status">
          {t('dayClose.loading')}
        </div>
      )}

      {queryError && (
        <div className="pv-strip danger" role="alert">
          <span className="msg">
            {translateServerError(queryError, t, t('reports:dayClose.error'))}
          </span>
        </div>
      )}

      {report && (
        <>
          <DayCloseSignoffCard
            key={`${date}:${signoff?.id ?? 'draft'}`}
            date={date}
            report={report}
            signoff={signoff}
            isSigning={signOffMutation.isPending}
            isDownloadingPdf={isDownloadingPdf}
            onSign={() => signOffMutation.mutate({ date, attestationAccepted: true })}
            onDownloadPdf={() => void downloadSignedPdf()}
          />
          <section
            className={`rounded-2xl border px-4 py-3 ${
              report.readiness.readyToSign
                ? 'border-success-300 bg-success-50 text-success-900'
                : 'border-warning-300 bg-warning-50 text-warning-950'
            }`}
            data-testid="day-close-readiness"
          >
            <div className="flex items-start gap-3">
              {report.readiness.readyToSign ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              )}
              <div>
                <p className="font-semibold">
                  {t(
                    signoff
                      ? 'dayClose.readiness.signed'
                      : report.readiness.readyToSign
                        ? 'dayClose.readiness.ready'
                        : 'dayClose.readiness.blocked'
                  )}
                </p>
                <p className="mt-0.5 text-xs opacity-80">
                  {t('dayClose.readiness.generated', {
                    date: formatDate(`${report.date}T12:00:00.000Z`, { timeZone: 'UTC' }),
                    timeZone: report.timeZone,
                  })}
                </p>
              </div>
            </div>
            {(report.readiness.blockers.length > 0 || report.readiness.warnings.length > 0) && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {[...report.readiness.blockers, ...report.readiness.warnings].map(code => (
                  <li
                    key={code}
                    className="rounded-full border border-current/20 bg-white/45 px-2.5 py-1 text-[11px] font-medium"
                  >
                    {t(`dayClose.readiness.codes.${code}`)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="pv-kpis grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              icon={Banknote}
              label={t('dayClose.kpis.netRevenue')}
              value={formatCurrency(report.sales.netRevenue, report.currencyCode)}
              context={t('dayClose.kpis.netRevenueContext', {
                gross: formatCurrency(report.sales.grossRevenue, report.currencyCode),
              })}
              tone="primary"
              mono
            />
            <KpiTile
              icon={ShoppingBag}
              label={t('dayClose.kpis.sales')}
              value={String(report.sales.count)}
              context={t('dayClose.kpis.refunds', {
                count: report.adjustments.refunds.count,
                amount: formatCurrency(report.adjustments.refunds.amount, report.currencyCode),
              })}
              tone="ink"
              mono
            />
            <KpiTile
              icon={Scale}
              label={t('dayClose.kpis.cashVariance')}
              value={formatCurrency(report.cash.overShort, report.currencyCode)}
              context={t('dayClose.kpis.cashSessions', {
                closed: report.cash.closedSessions,
                open: report.cash.openSessions,
              })}
              tone={report.cash.discrepancySessions > 0 ? 'warning' : 'success'}
              mono
            />
            <KpiTile
              icon={FileCheck2}
              label={t('dayClose.kpis.fiscal')}
              value={String(report.fiscal.total)}
              context={t('dayClose.kpis.fiscalNet', {
                amount: formatCurrency(report.fiscal.totalAmount, report.currencyCode),
              })}
              tone={report.fiscal.byStatus.rejected > 0 ? 'danger' : 'success'}
              mono
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className={SECTION_CLASS} data-testid="day-close-sales-section">
              <SectionTitle icon={ReceiptText} title={t('dayClose.sections.sales')} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Metric
                  label={t('dayClose.metrics.subtotal')}
                  value={formatCurrency(report.sales.subtotal, report.currencyCode)}
                />
                <Metric
                  label={t('dayClose.metrics.discounts')}
                  value={formatCurrency(report.sales.discounts, report.currencyCode)}
                />
                <Metric
                  label={t('dayClose.metrics.taxes')}
                  value={formatCurrency(report.sales.taxes, report.currencyCode)}
                />
                <Metric
                  label={t('dayClose.metrics.tips')}
                  value={formatCurrency(report.sales.tips, report.currencyCode)}
                />
                <Metric
                  label={t('dayClose.metrics.serviceCharges')}
                  value={formatCurrency(report.sales.serviceCharges, report.currencyCode)}
                />
                <Metric
                  label={t('dayClose.metrics.refunds')}
                  value={formatCurrency(report.sales.refundAmount, report.currencyCode)}
                />
              </div>
            </section>

            <section className={SECTION_CLASS} data-testid="day-close-payments-section">
              <SectionTitle icon={Landmark} title={t('dayClose.sections.payments')} />
              <p className="text-xs leading-5 text-secondary-500">{t('dayClose.payments.note')}</p>
              {report.payments.length === 0 ? (
                <EmptyState
                  icon={Landmark}
                  title={t('dayClose.empty.paymentsTitle')}
                  description={t('dayClose.empty.paymentsDescription')}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="pv-table [&_td:first-child]:min-w-0 [&_td]:px-2 [&_th:first-child]:min-w-0 [&_th]:px-2 sm:[&_td]:px-3 sm:[&_th]:px-3">
                    <thead>
                      <tr>
                        <th>{t('dayClose.payments.method')}</th>
                        <th className="num">{t('dayClose.payments.transactions')}</th>
                        <th className="num">{t('dayClose.payments.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.payments.map(payment => (
                        <tr key={payment.method}>
                          <td className="pname">
                            {t(`dayClose.paymentMethods.${payment.method}`)}
                          </td>
                          <td className="num">{payment.transactionCount}</td>
                          <td className="num">
                            {formatCurrency(payment.amount, report.currencyCode)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={SECTION_CLASS} data-testid="day-close-cash-section">
              <SectionTitle icon={Scale} title={t('dayClose.sections.cash')} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric
                  label={t('dayClose.metrics.expectedCash')}
                  value={formatCurrency(report.cash.expected, report.currencyCode)}
                />
                <Metric
                  label={t('dayClose.metrics.countedCash')}
                  value={formatCurrency(report.cash.counted, report.currencyCode)}
                />
                <Metric
                  label={t('dayClose.metrics.balancedSessions')}
                  value={`${report.cash.balancedSessions}/${report.cash.closedSessions}`}
                />
                <Metric
                  label={t('dayClose.metrics.openSessions')}
                  value={String(report.cash.openSessions)}
                />
              </div>
            </section>

            <section className={SECTION_CLASS} data-testid="day-close-fiscal-section">
              <SectionTitle icon={FileCheck2} title={t('dayClose.sections.fiscal')} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    'accepted',
                    'pending',
                    'sent',
                    'rejected',
                    'contingency',
                    'voided',
                    'notified_correction',
                    'partial_send',
                  ] as const
                ).map(status => (
                  <Metric
                    key={status}
                    label={t(`dayClose.fiscalStatuses.${status}`)}
                    value={String(report.fiscal.byStatus[status])}
                  />
                ))}
              </div>
            </section>

            <section className={SECTION_CLASS} data-testid="day-close-adjustments-section">
              <SectionTitle icon={RotateCcw} title={t('dayClose.sections.adjustments')} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric
                  label={t('dayClose.metrics.voids')}
                  value={formatCurrency(report.adjustments.voids.amount, report.currencyCode)}
                  detail={t('dayClose.metrics.events', { count: report.adjustments.voids.count })}
                />
                <Metric
                  label={t('dayClose.metrics.refunds')}
                  value={formatCurrency(report.adjustments.refunds.amount, report.currencyCode)}
                  detail={t('dayClose.metrics.events', { count: report.adjustments.refunds.count })}
                />
              </div>
            </section>

            <section className={SECTION_CLASS} data-testid="day-close-anomalies-section">
              <SectionTitle icon={Bot} title={t('dayClose.sections.anomalies')} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label={t('dayClose.anomalies.total')}
                  value={String(report.anomalies.total)}
                />
                <Metric
                  label={t('dayClose.anomalies.high')}
                  value={String(report.anomalies.high)}
                />
                <Metric
                  label={t('dayClose.anomalies.medium')}
                  value={String(report.anomalies.medium)}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  Object.entries(report.anomalies.byKind) as Array<
                    [keyof typeof report.anomalies.byKind, number]
                  >
                ).map(([kind, count]) => (
                  <div
                    key={kind}
                    className="flex items-center justify-between rounded-xl border border-secondary-200 px-3 py-2 text-xs"
                  >
                    <span className="text-secondary-600">{t(`dayClose.anomalyKinds.${kind}`)}</span>
                    <span className="font-mono font-semibold tabular-nums text-secondary-950">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className={SECTION_CLASS} data-testid="day-close-capabilities-section">
            <SectionTitle icon={AlertTriangle} title={t('dayClose.sections.coverage')} />
            <p className="text-sm text-secondary-500">{t('dayClose.coverage.description')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['commissions_not_tracked', 'waste_not_tracked'] as ReadinessCode[]).map(code => (
                <div
                  key={code}
                  className="rounded-2xl border border-dashed border-secondary-300 bg-secondary-50 p-4"
                >
                  <p className="font-medium text-secondary-900">
                    {t(`dayClose.coverage.${code}.title`)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-secondary-500">
                    {t(`dayClose.coverage.${code}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
