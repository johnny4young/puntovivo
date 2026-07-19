import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { TablePagination } from '@/components/tables/TablePagination';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import {
  PAYMENT_BREAKDOWN_WINDOW_DAYS,
  paymentStatusTone,
  type PaymentMethodBreakdown,
} from './paymentHealthPresentation';

interface PaymentBreakdownSectionProps {
  entries: PaymentMethodBreakdown;
  isLoading: boolean;
  error: unknown;
}

/** ENG-178 — Payment method and status aggregate with local pagination. */
export function PaymentBreakdownSection({
  entries,
  isLoading,
  error,
}: PaymentBreakdownSectionProps): React.ReactElement {
  const { t } = useTranslation('operations');
  const pagination = usePaginatedRows(entries, 8);
  const hasError = error !== null && error !== undefined;

  return (
    <section className="card space-y-4 p-6">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary-700" />
        <h3 className="pv-title text-lg">{t('payments.breakdown.title')}</h3>
      </div>
      <p className="text-sm text-secondary-500">{t('payments.breakdown.description')}</p>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary-500">
        {t('payments.breakdown.windowDays', {
          days: PAYMENT_BREAKDOWN_WINDOW_DAYS,
        })}
      </p>

      {isLoading && <p className="text-sm text-secondary-500">{t('common.loading')}</p>}
      {hasError && (
        <div className="pv-strip danger">
          <span className="msg">{translateServerError(error, t, t('common.errorGeneric'))}</span>
        </div>
      )}
      {!isLoading && !hasError && entries.length === 0 && (
        <EmptyState
          icon={BarChart3}
          title={t('payments.breakdown.emptyTitle')}
          description={t('payments.breakdown.emptyState', {
            days: PAYMENT_BREAKDOWN_WINDOW_DAYS,
          })}
        />
      )}
      {entries.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="pv-table" data-testid="payments-breakdown-table">
              <thead>
                <tr>
                  <th>{t('payments.breakdown.columns.rail')}</th>
                  <th>{t('payments.breakdown.columns.status')}</th>
                  <th className="num">{t('payments.breakdown.columns.count')}</th>
                  <th className="num">{t('payments.breakdown.columns.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {pagination.pageRows.map(row => (
                  <tr key={`${row.railId}-${row.status}`}>
                    <td>{t(`payments.rails.${row.railId}`)}</td>
                    <td>
                      <span className={`pv-badge ${paymentStatusTone(row.status)}`}>
                        <span className="dot" />
                        {t(`payments.status.${row.status}`, {
                          defaultValue: row.status,
                        })}
                      </span>
                    </td>
                    <td className="num">{row.count}</td>
                    <td className="num">{formatCurrency(row.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination.hasPagination && (
            <TablePagination
              page={pagination.page}
              pageCount={pagination.pageCount}
              total={pagination.total}
              rangeStart={pagination.rangeStart}
              rangeEnd={pagination.rangeEnd}
              onPageChange={pagination.setPage}
            />
          )}
        </div>
      )}
    </section>
  );
}
