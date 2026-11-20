import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { shortcutDisplayFor } from '@/lib/shortcuts';

interface SalesShortcutStripProps {
  /** Product edits are frozen, so the remove-line key does nothing. */
  itemsLocked?: boolean;
}

/** The shortest path through a sale, and where every other key lives. */
export function SalesShortcutStrip({ itemsLocked = false }: SalesShortcutStripProps) {
  const { t } = useTranslation('sales');
  const more = [
    ...(itemsLocked ? [] : ([['sales.removeItem', t('sell.keys.removeLine')]] as const)),
    ['sales.toggleSuspended', t('sell.keys.parked')],
    ['sales.newSale', t('sell.keys.newSale')],
    ['palette.open', t('sell.keys.more')],
  ] as const;

  return (
    <div
      className="sales-shortcut-strip"
      role="group"
      aria-label={t('checkout.shortcuts')}
      data-testid="checkout-shortcut-chips"
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <b className="text-fg1">{t('sell.keys.shortest')}</b>
        <span>{t('sell.keys.scan')}</span>
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sales-shortcut">
          <kbd className="pv-kbd">{shortcutDisplayFor('sales.fastCash')}</kbd>
          <span>{t('sell.keys.exactCash')}</span>
        </span>
        <span className="text-fg3">{t('sell.keys.or')}</span>
        <span className="sales-shortcut">
          <kbd className="pv-kbd">{shortcutDisplayFor('sales.charge')}</kbd>
          <span>{t('sell.keys.charge')}</span>
        </span>
      </p>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 lg:ml-auto">
        {more.map(([id, label]) => (
          <span key={id} className="sales-shortcut">
            <kbd className="pv-kbd">{shortcutDisplayFor(id)}</kbd>
            <span>{label}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
