import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Badge } from '@/components/ui';
import { TablePagination } from '@/components/tables/TablePagination';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { formatCurrency } from '@/lib/utils';
import {
  paymentMismatchTone,
  paymentStatusTone,
  type PaymentReconciliation,
} from './paymentHealthPresentation';

interface PaymentMismatchSectionProps {
  mismatches: PaymentReconciliation['mismatches'];
}

/** Paginated payment-reconciliation mismatch table. */
export function PaymentMismatchSection({
  mismatches,
}: PaymentMismatchSectionProps): React.ReactElement {
  const { t } = useTranslation('operations');
  const pagination = usePaginatedRows(mismatches, 8);

  return (
    <section className="card space-y-4 p-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning-700" />
        <h3 className="pv-title text-lg">{t('payments.mismatches.title')}</h3>
      </div>
      {mismatches.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={t('payments.mismatches.emptyTitle')}
          description={t('payments.mismatches.emptyState')}
        />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="pv-table">
              <thead>
                <tr>
                  <th>{t('payments.mismatches.columns.type')}</th>
                  <th>{t('payments.mismatches.columns.rail')}</th>
                  <th>{t('payments.mismatches.columns.reference')}</th>
                  <th className="num">{t('payments.mismatches.columns.amount')}</th>
                  <th>{t('payments.mismatches.columns.status')}</th>
                  <th>{t('payments.mismatches.columns.action')}</th>
                </tr>
              </thead>
              <tbody>
                {pagination.pageRows.map((row, index) => (
                  <tr
                    key={`${row.type}-${row.paymentOutboxId ?? row.salePaymentId ?? 'unknown'}-${index}`}
                  >
                    <td>
                      <Badge variant={paymentMismatchTone(row.type)} marker="dot">
                        {t(`payments.mismatches.type.${row.type}`)}
                      </Badge>
                    </td>
                    <td>{row.railId ? t(`payments.rails.${row.railId}`) : '—'}</td>
                    <td className="break-all">
                      {row.reference ?? row.providerTransactionId ?? '—'}
                    </td>
                    <td className="num">{formatCurrency(row.amount)}</td>
                    <td>
                      <Badge variant={paymentStatusTone(row.status)} marker="dot">
                        {row.status
                          ? t(`payments.status.${row.status}`, {
                              defaultValue: row.status,
                            })
                          : t('payments.status.missing')}
                      </Badge>
                    </td>
                    <td className="muted">
                      {t(`payments.mismatches.action.${row.suggestedAction}`)}
                    </td>
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
