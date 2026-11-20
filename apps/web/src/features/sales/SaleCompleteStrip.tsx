import { CheckCircle2, FileText, MessageCircle, Printer, X } from 'lucide-react';
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
  onPrint: () => void;
  isPrinting?: boolean | undefined;
  onShare: () => void;
  onOpenReceipt: () => void;
  onDismiss: () => void;
}

/** The finished sale and its receipt choices; nothing here blocks the next scan. */
export function SaleCompleteStrip({
  sale,
  onPrint,
  isPrinting = false,
  onShare,
  onOpenReceipt,
  onDismiss,
}: SaleCompleteStripProps) {
  const { t } = useTranslation('sales');

  return (
    <section
      className="sale-done-strip"
      aria-label={t('toast.success')}
      data-testid="sale-complete-strip"
    >
      <div className="flex min-w-0 items-center gap-3">
        <CheckCircle2 className="sale-done-mark" aria-hidden="true" />
        <p className="min-w-0 flex-1 wrap-anywhere">
          <b>{t('saleComplete.ready', { saleNumber: sale.saleNumber })}</b>
          <span className="sale-done-meta tabular-nums">
            {formatCurrency(sale.total)}
            {sale.change > 0 && (
              <span data-testid="sale-complete-change">
                {' · '}
                {t('payment.change')} {formatCurrency(sale.change)}
              </span>
            )}
          </span>
        </p>
      </div>
      <div className="sale-done-actions" role="group" aria-label={t('saleComplete.actions')}>
        <button
          type="button"
          className="sale-done-action"
          onClick={onPrint}
          disabled={isPrinting}
          data-testid="sale-complete-print"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          {t('saleComplete.print')}
        </button>
        <button
          type="button"
          className="sale-done-action"
          onClick={onShare}
          data-testid="sale-complete-whatsapp"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {t('saleComplete.whatsapp')}
        </button>
        <button
          type="button"
          className="sale-done-action"
          onClick={onOpenReceipt}
          data-testid="sale-complete-receipt"
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          {t('saleComplete.receipt')}
        </button>
        <button
          type="button"
          className="sale-done-action"
          onClick={onDismiss}
          data-testid="sale-complete-dismiss"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          {t('saleComplete.dismiss')}
        </button>
      </div>
    </section>
  );
}
