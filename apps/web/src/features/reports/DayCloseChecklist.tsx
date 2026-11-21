import { AlertTriangle, ArrowRight, CheckCircle2, CircleSlash, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { fiscalInProgress } from '@/features/dashboard/close/closeModel';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

type DayCloseReport = inferRouterOutputs<AppRouter>['reports']['dayClose']['preview'];

type CheckCode =
  | 'open_sessions'
  | 'unexplained_differences'
  | 'unresolved_drafts'
  | 'cash_discrepancies'
  | 'fiscal_pending'
  | 'fiscal_rejected'
  | 'high_anomalies';
type CheckState = 'blocker' | 'warning' | 'done';

// Differences and parked sales are resolved row by row in Hoy's guided close for that day.
const guidedClose = (report: DayCloseReport) => `/dashboard?close=${report.date}`;
const CHECK_LINKS: Record<CheckCode, (report: DayCloseReport) => string> = {
  open_sessions: () => '/operations?tab=cash',
  unexplained_differences: guidedClose,
  unresolved_drafts: guidedClose,
  cash_discrepancies: () => '/operations?tab=cash',
  fiscal_pending: () => '/fiscal-documents',
  fiscal_rejected: () => '/fiscal-documents',
  high_anomalies: () => '/dashboard',
};
// Fiscal documents are admin only, so managers see the count without a dead link.
const ADMIN_ONLY_CHECKS: ReadonlySet<CheckCode> = new Set(['fiscal_pending', 'fiscal_rejected']);

const STATE_STYLE: Record<CheckState, { icon: typeof XCircle; tone: string }> = {
  blocker: { icon: XCircle, tone: 'text-danger-700' },
  warning: { icon: AlertTriangle, tone: 'text-warning-700' },
  done: { icon: CheckCircle2, tone: 'text-success-700' },
};

// The guided-close checks carry no total in the report; their detail names the next step.
const CHECK_COUNTS: Partial<Record<CheckCode, (report: DayCloseReport) => number>> = {
  open_sessions: report => report.cash.openSessions,
  cash_discrepancies: report => report.cash.discrepancySessions,
  fiscal_pending: fiscalInProgress,
  fiscal_rejected: report => report.fiscal.byStatus.rejected,
  high_anomalies: report => report.anomalies.high,
};

export function DayCloseChecklist({
  report,
  frozen,
  cashDifference,
}: {
  report: DayCloseReport;
  frozen: boolean;
  cashDifference: string;
}) {
  const { t } = useTranslation('reports');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { blockers, warnings } = report.readiness;
  const checks = (Object.keys(CHECK_LINKS) as CheckCode[]).map(code => ({
    code,
    state: (blockers.includes(code)
      ? 'blocker'
      : warnings.includes(code)
        ? 'warning'
        : 'done') as CheckState,
  }));
  const clear = checks.filter(check => check.state === 'done').length;
  const untracked = warnings.filter(
    code => code === 'commissions_not_tracked' || code === 'waste_not_tracked'
  );

  return (
    <div className="mt-3" data-testid="day-close-checklist">
      <p className="text-xs font-semibold" data-testid="day-close-checklist-summary">
        {t('dayClose.checklist.summary', { clear, total: checks.length })}
      </p>
      <ul className="mt-2 divide-y divide-current/10 rounded-xl border border-current/15 bg-surface/60">
        {checks.map(({ code, state }) => {
          const { icon: Icon, tone } = STATE_STYLE[state];
          return (
            <li
              key={code}
              className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm text-ink"
              data-testid={`day-close-check-${code}`}
              data-state={state}
            >
              <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
              <span className="font-medium">{t(`dayClose.readiness.codes.${code}`)}</span>
              {state !== 'done' && (
                <span className="min-w-0 flex-1 text-xs text-secondary-600">
                  {t(`dayClose.checklist.details.${code}`, {
                    count: CHECK_COUNTS[code]?.(report) ?? 0,
                    amount: cashDifference,
                  })}
                </span>
              )}
              {state === 'done' ? (
                <span className={`ml-auto text-xs font-semibold ${tone}`}>
                  {t('dayClose.checklist.done')}
                </span>
              ) : (
                !frozen &&
                (isAdmin || !ADMIN_ONLY_CHECKS.has(code)) && (
                  <Link
                    to={CHECK_LINKS[code](report)}
                    className="ml-auto inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary-700 hover:underline"
                    data-testid={`day-close-check-link-${code}`}
                  >
                    {t('dayClose.checklist.review')}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )
              )}
            </li>
          );
        })}
        {untracked.map(code => (
          <li
            key={code}
            className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm text-secondary-600"
            data-testid={`day-close-check-${code}`}
          >
            <CircleSlash className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t(`dayClose.readiness.codes.${code}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
