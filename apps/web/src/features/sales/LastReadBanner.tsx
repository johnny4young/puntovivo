import { Check, ScanBarcode } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LastRead } from '@/features/sales/useLastRead';
import { ariaKeyshortcutsFor, shortcutDisplayFor } from '@/lib/shortcuts';
import { formatCurrency } from '@/lib/utils';

interface LastReadBannerProps {
  read: LastRead | null;
  canUndo: boolean;
  onUndo: () => void;
}

/** Confirms what a scan or add just put on the ticket; idle keeps the slot. */
export function LastReadBanner({ read, canUndo, onUndo }: LastReadBannerProps) {
  const { t } = useTranslation('sales');

  return (
    <section
      className={`sales-last-read ${read ? '' : 'sales-last-read-idle'}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="sales-last-read"
      data-state={read ? 'read' : 'idle'}
    >
      <span className="sales-last-read-mark" aria-hidden="true">
        {read ? <Check className="h-6 w-6" /> : <ScanBarcode className="h-6 w-6" />}
      </span>
      {/* Keyed so a repeat scan of the same product replays the entrance. */}
      <div
        className="sales-last-read-body min-w-0 flex-1"
        key={read ? `${read.key}:${read.quantity}` : 'idle'}
      >
        <p className="sales-last-read-kicker">{t('sell.lastRead.kicker')}</p>
        <p className="line-clamp-2 font-display text-xl font-bold leading-tight lg:line-clamp-1 lg:text-2xl">
          {read ? read.productName : t('sell.lastRead.idle')}
        </p>
      </div>
      {read && (
        <div className="shrink-0 text-right">
          <p
            className="font-numeric text-3xl font-bold leading-none lg:text-4xl"
            data-testid="sales-last-read-price"
          >
            {formatCurrency(read.unitPrice)}
          </p>
          <p className="sales-last-read-meta mt-1 flex items-center justify-end gap-1.5 text-[13px]">
            {read.remaining !== null && (
              <span data-testid="sales-last-read-stock">
                {t('sell.lastRead.remaining', { count: read.remaining })}
              </span>
            )}
            {canUndo && (
              <>
                {read.remaining !== null && <span aria-hidden="true">·</span>}
                <button
                  type="button"
                  className="sales-last-read-undo"
                  onClick={onUndo}
                  aria-label={t('undo.button.label')}
                  aria-keyshortcuts={ariaKeyshortcutsFor('sales.undo')}
                  data-testid="sales-cart-undo"
                >
                  <kbd className="sales-last-read-kbd" aria-hidden="true">
                    {shortcutDisplayFor('sales.undo')}
                  </kbd>
                  {t('sell.lastRead.undo')}
                </button>
              </>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
