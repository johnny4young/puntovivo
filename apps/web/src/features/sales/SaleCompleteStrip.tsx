import { CheckCircle2, Receipt, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';

export interface CompletedSaleSummary {
  id: string;
  saleNumber: string;
  total: number;
  change: number;
}

interface SaleCompleteStripProps {
  sale: CompletedSaleSummary;
  onOpenReceipt: () => void;
  onDismiss: () => void;
}

export function SaleCompleteStrip({ sale, onOpenReceipt, onDismiss }: SaleCompleteStripProps) {
  const { t } = useTranslation('sales');

  return (
    <section
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-success-200 bg-success-50 px-4 py-2 text-success-900 lg:shrink-0"
      aria-label={t('toast.success')}
      data-testid="sale-complete-strip"
    >
      <CheckCircle2 className="h-5 w-5 shrink-0 text-success-700" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{t('toast.success')}</span>
        <span className="tabular-nums wrap-anywhere">
          {' · '}
          {sale.saleNumber} · {formatCurrency(sale.total)}
        </span>
        {sale.change > 0 && (
          <span className="font-semibold tabular-nums" data-testid="sale-complete-change">
            {' · '}
            {t('payment.change')} {formatCurrency(sale.change)}
          </span>
        )}
      </p>
      <button
        type="button"
        className="btn-outline min-h-11"
        onClick={onOpenReceipt}
        data-testid="sale-complete-receipt"
      >
        <Receipt className="h-4 w-4" aria-hidden="true" />
        {t('saleComplete.receipt')}
      </button>
      <button
        type="button"
        className="btn-ghost btn-icon h-11 w-11"
        onClick={onDismiss}
        aria-label={t('saleComplete.dismiss')}
        data-testid="sale-complete-dismiss"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}
