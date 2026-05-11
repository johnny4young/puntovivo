import { useTranslation } from 'react-i18next';
import { AlertTriangle, CreditCard } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';

/**
 * ENG-038 — Operations Center: Payment Health panel.
 *
 * Read-only reconciliation over local non-cash tenders and the new
 * `payment_outbox` rail envelope. Real provider workers land later;
 * this panel gives operators one place to see missing provider refs,
 * provider declines/timeouts and amount drift as soon as rows exist.
 */

function statusVariant(status: string | null): 'success' | 'warning' | 'danger' | 'secondary' {
  if (status === 'approved' || status === 'settled') return 'success';
  if (status === 'declined' || status === 'timeout' || status === 'dead_letter') {
    return 'danger';
  }
  if (status === 'retrying' || status === 'submitting') return 'warning';
  return 'secondary';
}

function mismatchVariant(type: string): 'success' | 'warning' | 'danger' | 'secondary' {
  if (type === 'provider_issue') return 'danger';
  if (type === 'missing_provider_reference' || type === 'amount_mismatch') {
    return 'warning';
  }
  return 'secondary';
}

function getPaymentErrorMessage(value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  const message = value.message;
  if (typeof message === 'string') return message;
  const kind = value.kind;
  if (typeof kind === 'string') return kind;
  return JSON.stringify(value);
}

export function PaymentHealthPanel() {
  const { t } = useTranslation('operations');

  const reconciliationQuery = trpc.payments.reconciliation.useQuery(
    { limit: 50 },
    { staleTime: 30_000, refetchInterval: 30_000 }
  );
  const outboxQuery = trpc.payments.peekOutbox.useQuery(
    { limit: 20 },
    { staleTime: 30_000, refetchInterval: 30_000 }
  );

  const data = reconciliationQuery.data;
  const outboxRows = outboxQuery.data ?? [];

  return (
    <div className="space-y-6">
      <section className="card p-6 space-y-5">
        <header className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
            <CreditCard className="h-5 w-5 text-primary-700" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-secondary-900">{t('payments.title')}</h2>
            <p className="text-sm text-secondary-500">{t('payments.description')}</p>
          </div>
        </header>

        {reconciliationQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {reconciliationQuery.error && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {translateServerError(reconciliationQuery.error, t, t('common.errorGeneric'))}
          </div>
        )}

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="payments-summary">
            <SummaryTile
              label={t('payments.summary.tendersScanned')}
              value={String(data.summary.tendersScanned)}
            />
            <SummaryTile
              label={t('payments.summary.matched')}
              value={String(data.summary.matched)}
              variant={data.summary.matched === data.summary.tendersScanned ? 'success' : undefined}
            />
            <SummaryTile
              label={t('payments.summary.mismatches')}
              value={String(data.summary.mismatches)}
              variant={data.summary.mismatches === 0 ? 'success' : 'warning'}
            />
            <SummaryTile
              label={t('payments.summary.unmatchedAmount')}
              value={formatCurrency(data.summary.unmatchedAmount)}
              variant={data.summary.unmatchedAmount === 0 ? 'success' : 'warning'}
            />
          </div>
        )}
      </section>

      {data && (
        <section className="card p-6 space-y-4">
          <h3 className="text-base font-semibold text-secondary-900">
            {t('payments.byRail.title')}
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.byRail.map(row => (
              <div key={row.railId} className="rounded-xl border border-secondary-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-secondary-900">
                    {t(`payments.rails.${row.railId}`)}
                  </p>
                  <Badge variant={row.issues > 0 ? 'warning' : 'success'}>{row.issues}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-secondary-500">{t('payments.byRail.outboxRows')}</dt>
                    <dd className="font-semibold text-secondary-900">{row.outboxRows}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary-500">{t('payments.byRail.amount')}</dt>
                    <dd className="font-semibold text-secondary-900">
                      {formatCurrency(row.amount)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      {data && (
        <section className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning-700" />
            <h3 className="text-base font-semibold text-secondary-900">
              {t('payments.mismatches.title')}
            </h3>
          </div>
          {data.mismatches.length === 0 ? (
            <p className="text-sm text-secondary-500">{t('payments.mismatches.emptyState')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                  <tr>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.type')}</th>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.rail')}</th>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.reference')}</th>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.amount')}</th>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.status')}</th>
                    <th className="px-3 py-2">{t('payments.mismatches.columns.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.mismatches.map((row, idx) => (
                    <tr
                      key={`${row.type}-${row.paymentOutboxId ?? row.salePaymentId ?? 'unknown'}-${idx}`}
                      className="border-t border-secondary-200"
                    >
                      <td className="px-3 py-2">
                        <Badge variant={mismatchVariant(row.type)}>
                          {t(`payments.mismatches.type.${row.type}`)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {row.railId ? t(`payments.rails.${row.railId}`) : '—'}
                      </td>
                      <td className="px-3 py-2 text-secondary-700 break-all">
                        {row.reference ?? row.providerTransactionId ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-secondary-700">{formatCurrency(row.amount)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(row.status)}>
                          {row.status
                            ? t(`payments.status.${row.status}`, {
                                defaultValue: row.status,
                              })
                            : t('payments.status.missing')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {t(`payments.mismatches.action.${row.suggestedAction}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card p-6 space-y-4">
        <h3 className="text-base font-semibold text-secondary-900">{t('payments.outbox.title')}</h3>

        {outboxQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {outboxQuery.error && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {translateServerError(outboxQuery.error, t, t('common.errorGeneric'))}
          </div>
        )}

        {!outboxQuery.isLoading && !outboxQuery.error && outboxRows.length === 0 && (
          <p className="text-sm text-secondary-500">{t('payments.outbox.emptyState')}</p>
        )}

        {outboxRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-2">{t('payments.outbox.columns.rail')}</th>
                  <th className="px-3 py-2">{t('payments.outbox.columns.kind')}</th>
                  <th className="px-3 py-2">{t('payments.outbox.columns.status')}</th>
                  <th className="px-3 py-2">{t('payments.outbox.columns.attempts')}</th>
                  <th className="px-3 py-2">{t('payments.outbox.columns.lastError')}</th>
                  <th className="px-3 py-2">{t('payments.outbox.columns.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {outboxRows.map(row => (
                  <tr key={row.id} className="border-t border-secondary-200">
                    <td className="px-3 py-2 text-secondary-700">
                      {t(`payments.rails.${row.railId}`)}
                    </td>
                    <td className="px-3 py-2 text-secondary-700">
                      {t(`payments.kind.${row.kind}`)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(row.status)}>
                        {t(`payments.status.${row.status}`, {
                          defaultValue: row.status,
                        })}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-secondary-700">{row.attempts}</td>
                    <td className="px-3 py-2 text-secondary-700 break-all">
                      {getPaymentErrorMessage(row.lastError) ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-secondary-700">
                      {formatDateTime(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant?: 'success' | 'warning' | 'danger';
}) {
  const accent =
    variant === 'danger'
      ? 'text-danger-700'
      : variant === 'warning'
        ? 'text-warning-700'
        : variant === 'success'
          ? 'text-success-700'
          : 'text-secondary-900';
  return (
    <div className="rounded-xl border border-secondary-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-secondary-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}
