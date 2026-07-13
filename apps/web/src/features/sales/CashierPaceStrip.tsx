import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CashierPaceMetrics } from './useCashierPace';

interface CashierPaceStripProps {
  pace: CashierPaceMetrics;
}

function formatSeconds(seconds: number | null, language: string): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${new Intl.NumberFormat(language).format(seconds)} s`;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(seconds / 60)} min`;
}

/** Compact, aggregate-only HUD visible only to the operator who opted in. */
export function CashierPaceStrip({ pace }: CashierPaceStripProps) {
  const { t, i18n } = useTranslation('sales');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const rate = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(language, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(value);

  return (
    <section
      className="rounded-2xl border border-primary-200/80 bg-primary-50/70 px-3.5 py-3"
      aria-label={t('pace.title')}
      data-testid="cashier-pace-strip"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-primary-900">
          <Gauge className="h-4 w-4" aria-hidden="true" />
          {t('pace.title')}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-700">
          {t('pace.private')}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-[10px] text-primary-800">{t('pace.itemsPerMinute')}</dt>
          <dd className="mt-1 text-sm font-bold text-primary-950">{rate(pace.itemsPerMinute)}</dd>
        </div>
        <div className="border-x border-primary-200/80 px-1">
          <dt className="text-[10px] text-primary-800">{t('pace.averageCheckout')}</dt>
          <dd className="mt-1 text-sm font-bold text-primary-950">
            {formatSeconds(pace.averageCheckoutSeconds, language)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] text-primary-800">{t('pace.personalBest')}</dt>
          <dd className="mt-1 text-sm font-bold text-primary-950">
            {rate(pace.personalBestItemsPerMinute)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
