import { lazy, Suspense, useState } from 'react';
import { CheckCircle2, MessageCircle, Printer, Receipt, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { cn, formatCurrency } from '@/lib/utils';
import { useSaleReceiptPrinter } from './useSaleReceiptPrinter';

const ReceiptSharePanel = lazy(async () => {
  const module = await import('./ReceiptSharePanel');
  return { default: module.ReceiptSharePanel };
});

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

const ACTION_CLASS =
  'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-rail-muted/45 px-3.5 text-sm font-semibold text-rail-foreground transition-colors hover:bg-rail-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rail-foreground disabled:opacity-60';

/**
 * What follows a confirmed sale: the receipt options, on a strip that never
 * takes focus, so the next product can be scanned straight away.
 */
export function SaleCompleteStrip({ sale, onOpenReceipt, onDismiss }: SaleCompleteStripProps) {
  const { t } = useTranslation(['sales', 'receiptShare']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { currentSite } = useTenant();
  const printReceipt = useSaleReceiptPrinter();
  const [isPrinting, setIsPrinting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const handlePrint = async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      const outcome = await printReceipt(await utils.sales.getById.fetch({ id: sale.id }));
      if (outcome === 'failed' || outcome === null) throw new Error('Receipt was not printed');
    } catch {
      toast.warning({ title: t('saleComplete.printFailed') });
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="space-y-3 lg:shrink-0">
      <section
        className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl bg-rail px-4 py-3 text-rail-foreground"
        aria-label={t('toast.success')}
        data-testid="sale-complete-strip"
      >
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-rail-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="font-semibold wrap-anywhere">
              {t('saleComplete.ready', { saleNumber: sale.saleNumber })}
            </p>
            <p className="text-sm text-rail-muted">
              <span className="tabular-nums">{formatCurrency(sale.total)}</span>
              {sale.change > 0 && (
                <span className="font-semibold tabular-nums" data-testid="sale-complete-change">
                  {' · '}
                  {t('payment.change')} {formatCurrency(sale.change)}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 basis-96 flex-wrap gap-2">
          <button
            type="button"
            className={ACTION_CLASS}
            onClick={() => void handlePrint()}
            disabled={isPrinting}
            data-testid="sale-complete-print"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            {t('saleComplete.print')}
          </button>
          {currentSite && (
            <button
              type="button"
              className={cn(ACTION_CLASS, isSharing && 'bg-rail-foreground/15')}
              onClick={() => setIsSharing(open => !open)}
              aria-expanded={isSharing}
              data-testid="sale-complete-whatsapp"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {t('saleComplete.whatsapp')}
            </button>
          )}
          <button
            type="button"
            className={ACTION_CLASS}
            onClick={onOpenReceipt}
            data-testid="sale-complete-receipt"
          >
            <Receipt className="h-4 w-4" aria-hidden="true" />
            {t('saleComplete.receipt')}
          </button>
          <button
            type="button"
            className={ACTION_CLASS}
            onClick={onDismiss}
            data-testid="sale-complete-dismiss"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            {t('saleComplete.dismiss')}
          </button>
        </div>
      </section>
      {isSharing && currentSite && (
        <Suspense fallback={null}>
          <ReceiptSharePanel
            saleId={sale.id}
            siteId={currentSite.id}
            onClose={() => setIsSharing(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
