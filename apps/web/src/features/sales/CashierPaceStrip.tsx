import { useTranslation } from 'react-i18next';
import { Gauge, Timer, Trophy } from 'lucide-react';
import { useCashierPace } from './useCashierPace';

/**
 * ENG-204 (WC-C4) — the opt-in cashier pace HUD. Three quiet micro-metrics
 * of the ACTIVE session (base items per minute, average seconds between
 * sales, personal best) rendered inside the checkout panel's session block.
 * Self-contained: reads the shared opt-in + the pace query through
 * `useCashierPace`, renders nothing while opted out, without a session, or
 * before the first payload — the cockpit stays untouched for everyone who
 * did not ask for it. When the live rate meets the cashier's own record the
 * trophy tile lights up: this motivates, it does not surveil.
 */
export function CashierPaceStrip({ hasActiveCashSession }: { hasActiveCashSession: boolean }) {
  const { t } = useTranslation('sales');
  const { enabled, pace } = useCashierPace(hasActiveCashSession);

  if (!enabled || !pace) return null;

  return (
    <div
      className="mt-3 grid grid-cols-3 gap-2"
      data-testid="cashier-pace-strip"
      role="status"
      aria-label={t('paceHud.title')}
    >
      <div className="rounded-[12px] border border-line/70 bg-surface-2/60 px-2.5 py-2">
        <p className="flex items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-secondary-500">
          <Gauge className="h-3 w-3" aria-hidden="true" />
          {t('paceHud.itemsPerMinute')}
        </p>
        <p className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-secondary-950">
          {pace.itemsPerMinute.toFixed(1)}
        </p>
      </div>
      <div className="rounded-[12px] border border-line/70 bg-surface-2/60 px-2.5 py-2">
        <p className="flex items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-secondary-500">
          <Timer className="h-3 w-3" aria-hidden="true" />
          {t('paceHud.secondsPerSale')}
        </p>
        <p className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-secondary-950">
          {pace.avgSecondsBetweenSales !== null ? `${pace.avgSecondsBetweenSales}s` : '—'}
        </p>
      </div>
      <div
        className={`rounded-[12px] border px-2.5 py-2 ${
          pace.isPersonalBest
            ? 'border-warning-400/50 bg-warning-500/10'
            : 'border-line/70 bg-surface-2/60'
        }`}
        data-testid="cashier-pace-best"
      >
        <p className="flex items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-secondary-500">
          <Trophy className="h-3 w-3" aria-hidden="true" />
          {t('paceHud.personalBest')}
        </p>
        <p className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-secondary-950">
          {pace.isPersonalBest && <span aria-hidden="true">🏆 </span>}
          {pace.personalBestItemsPerMinute !== null
            ? pace.personalBestItemsPerMinute.toFixed(1)
            : t('paceHud.noRecordYet')}
        </p>
      </div>
    </div>
  );
}
