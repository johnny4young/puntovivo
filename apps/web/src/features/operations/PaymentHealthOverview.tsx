import { ScanLine, ShieldCheck, TriangleAlert, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KpiTile } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import type { PaymentReconciliation } from './paymentHealthPresentation';

interface PaymentHealthSummaryProps {
  data: PaymentReconciliation;
}

/** Payment reconciliation KPI summary. */
export function PaymentHealthSummary({ data }: PaymentHealthSummaryProps): React.ReactElement {
  const { t } = useTranslation('operations');

  return (
    <div className="pv-kpis grid grid-cols-2 md:grid-cols-4" data-testid="payments-summary">
      <KpiTile
        icon={ScanLine}
        label={t('payments.summary.tendersScanned')}
        value={String(data.summary.tendersScanned)}
        tone="ink"
      />
      <KpiTile
        icon={ShieldCheck}
        label={t('payments.summary.matched')}
        value={String(data.summary.matched)}
        tone={data.summary.matched === data.summary.tendersScanned ? 'success' : 'primary'}
      />
      <KpiTile
        icon={TriangleAlert}
        label={t('payments.summary.mismatches')}
        value={String(data.summary.mismatches)}
        tone={data.summary.mismatches === 0 ? 'success' : 'warning'}
      />
      <KpiTile
        icon={Wallet}
        label={t('payments.summary.unmatchedAmount')}
        value={formatCurrency(data.summary.unmatchedAmount)}
        tone={data.summary.unmatchedAmount === 0 ? 'success' : 'warning'}
        mono
      />
    </div>
  );
}

/** Payment reconciliation totals grouped by payment rail. */
export function PaymentRailSummary({ data }: PaymentHealthSummaryProps): React.ReactElement {
  const { t } = useTranslation('operations');

  return (
    <section className="card space-y-4 p-6">
      <h3 className="pv-title text-lg">{t('payments.byRail.title')}</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.byRail.map(row => (
          <div key={row.railId} className="rounded-2xl border border-line/70 bg-surface-2/65 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-secondary-900">
                {t(`payments.rails.${row.railId}`)}
              </p>
              <span className={`pv-badge ${row.issues > 0 ? 'warning' : 'success'}`}>
                <span className="dot" />
                {row.issues}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-secondary-500">{t('payments.byRail.outboxRows')}</dt>
                <dd className="font-semibold text-secondary-900">{row.outboxRows}</dd>
              </div>
              <div>
                <dt className="text-secondary-500">{t('payments.byRail.amount')}</dt>
                <dd className="font-mono font-semibold tabular-nums text-secondary-900">
                  {formatCurrency(row.amount)}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
