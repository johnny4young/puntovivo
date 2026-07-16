import { useTranslation } from 'react-i18next';
import { Flame, Scale, Share2, ShoppingBag, TrendingUp } from 'lucide-react';
import { ModalButton } from '@/components/form-controls/Modal';
import { Overlay } from '@/components/overlay/Overlay';
import { trpc } from '@/lib/trpc';
import { formatCurrency, formatDate } from '@/lib/utils';
import { buildDayPulseText, buildWhatsAppShareUrl } from './dayPulse';

/**
 * Props for {@link DayCloseSummaryModal} (ENG-198).
 *
 * The modal is additive to the close flow: it mounts AFTER
 * `cashSessions.close` succeeds (the toast stays intact) and fetches the
 * ritual payload itself. Role gating is server-side — when the viewer is a
 * cashier the payload arrives with `margin: null` and profit-less top
 * products, so the component simply renders what it gets.
 */
interface DayCloseSummaryModalProps {
  /** The just-closed session; the parent only mounts the modal when set. */
  sessionId: string;
  onClose: () => void;
}

/** Cuadre semaphore state derived from the session's signed over/short. */
function balanceStateOf(overShort: number | null, balanced: boolean) {
  if (balanced) return 'balanced' as const;
  return (overShort ?? 0) > 0 ? ('over' as const) : ('short' as const);
}

const BALANCE_TONES = {
  balanced: 'border-success-500/30 bg-success-500/15 text-success-100',
  over: 'border-warning-400/40 bg-warning-500/15 text-warning-100',
  short: 'border-danger-400/40 bg-danger-500/15 text-danger-100',
} as const;

const TILE_CLASS = 'rounded-[16px] border border-secondary-800/70 bg-secondary-900/60 p-4';
const TILE_LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary-400';

export function DayCloseSummaryModal({ sessionId, onClose }: DayCloseSummaryModalProps) {
  const { t } = useTranslation('sales');
  const summaryQuery = trpc.cashSessions.dayCloseSummary.useQuery({ sessionId });
  const summary = summaryQuery.data;

  const balanceState = summary
    ? balanceStateOf(summary.session.overShort, summary.session.balanced)
    : null;

  return (
    <Overlay
      isOpen
      onClose={onClose}
      size="lg"
      kicker={t('cashSession.dayClose.kicker')}
      title={t('cashSession.dayClose.title')}
      description={
        summary
          ? t('cashSession.dayClose.subtitle', {
              registerName: summary.session.registerName,
              date: formatDate(summary.session.closedAt),
            })
          : undefined
      }
      footer={
        <>
          {summary && (
            // ENG-205 — v1 of the shareable pulse: a wa.me deep link with
            // the aggregate day text (never customer data). ENG-112's real
            // WhatsApp lane can upgrade this to an automatic push later.
            <ModalButton
              onClick={() => {
                window.open(
                  buildWhatsAppShareUrl(buildDayPulseText(summary, t)),
                  '_blank',
                  'noopener,noreferrer'
                );
              }}
              className="sm:min-w-[12rem]"
            >
              <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('cashSession.dayClose.pulse.share')}
            </ModalButton>
          )}
          <ModalButton variant="primary" onClick={onClose} className="sm:min-w-[10rem]">
            {t('cashSession.dayClose.finish')}
          </ModalButton>
        </>
      }
    >
      <div
        className="space-y-4 rounded-[20px] bg-secondary-950 p-4 text-secondary-50 sm:p-5"
        data-testid="day-close-summary"
        aria-busy={summaryQuery.isPending}
      >
        {summaryQuery.isPending && (
          <p role="status" className="animate-pulse py-8 text-center text-sm text-secondary-300">
            {t('cashSession.dayClose.loading')}
          </p>
        )}

        {summaryQuery.isError && (
          <p
            role="alert"
            className="rounded-2xl border border-danger-400/40 bg-danger-500/15 px-4 py-3 text-sm text-danger-100"
          >
            {t('cashSession.dayClose.error')}
          </p>
        )}

        {summary && balanceState && (
          <>
            <section
              className={`grid gap-3 sm:grid-cols-2 ${summary.margin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}
            >
              <div className={TILE_CLASS}>
                <p className={TILE_LABEL_CLASS}>
                  <ShoppingBag className="mr-1.5 inline h-3 w-3" aria-hidden="true" />
                  {t('cashSession.dayClose.salesTitle')}
                </p>
                <p className="mt-1.5 font-display text-2xl tabular-nums tracking-[-0.02em] text-white">
                  {formatCurrency(summary.day.revenue)}
                </p>
                <p className="mt-0.5 text-[11.5px] text-secondary-300">
                  {t('cashSession.dayClose.salesCount', { count: summary.day.salesCount })}
                </p>
              </div>

              <div
                className={`rounded-[16px] border p-4 ${BALANCE_TONES[balanceState]}`}
                data-testid="day-close-balance"
              >
                <p className={TILE_LABEL_CLASS}>
                  <Scale className="mr-1.5 inline h-3 w-3" aria-hidden="true" />
                  {t('cashSession.dayClose.balanceTitle')}
                </p>
                <p className="mt-1.5 font-display text-lg tracking-[-0.01em]">
                  {t(`cashSession.dayClose.balance.${balanceState}`, {
                    amount: formatCurrency(Math.abs(summary.session.overShort ?? 0)),
                  })}
                </p>
                <p className="mt-0.5 text-[11.5px] opacity-80">
                  {t('cashSession.dayClose.counted', {
                    amount: formatCurrency(summary.session.actualCount ?? 0),
                  })}
                </p>
              </div>

              {summary.margin && (
                <div className={TILE_CLASS} data-testid="day-close-margin">
                  <p className={TILE_LABEL_CLASS}>
                    <TrendingUp className="mr-1.5 inline h-3 w-3" aria-hidden="true" />
                    {t('cashSession.dayClose.marginTitle')}
                  </p>
                  <p className="mt-1.5 font-display text-2xl tabular-nums tracking-[-0.02em] text-white">
                    {formatCurrency(summary.margin.grossProfit)}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-secondary-300">
                    {t('cashSession.dayClose.marginDetail', {
                      percent: summary.margin.grossMarginPct.toFixed(1),
                    })}
                  </p>
                </div>
              )}

              <div className={TILE_CLASS} data-testid="day-close-streak">
                <p className={TILE_LABEL_CLASS}>
                  <Flame className="mr-1.5 inline h-3 w-3" aria-hidden="true" />
                  {t('cashSession.dayClose.streakTitle')}
                </p>
                {summary.streakDays > 0 ? (
                  <p className="mt-1.5 font-display text-2xl tabular-nums tracking-[-0.02em] text-white">
                    <span aria-hidden="true">🔥 </span>
                    {t('cashSession.dayClose.streakDays', { count: summary.streakDays })}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[12.5px] leading-5 text-secondary-300">
                    {t('cashSession.dayClose.streakZero')}
                  </p>
                )}
              </div>
            </section>

            <section className={TILE_CLASS} data-testid="day-close-top-products">
              <p className={TILE_LABEL_CLASS}>{t('cashSession.dayClose.topProductsTitle')}</p>
              {summary.topProducts.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-secondary-400">
                  {t('cashSession.dayClose.noSales')}
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {summary.topProducts.map((product, index) => (
                    <li
                      key={product.productId}
                      className="flex items-center justify-between gap-3 rounded-[10px] border border-secondary-800/70 bg-secondary-950/40 px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="font-mono text-[11px] text-secondary-500">
                          {index + 1}
                        </span>
                        <span className="truncate text-[13px] text-white">{product.name}</span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-3 font-mono text-[12px] tabular-nums">
                        <span className="text-secondary-200">
                          {formatCurrency(product.revenue)}
                        </span>
                        {product.grossProfit !== null && (
                          <span
                            className={
                              product.grossProfit < 0 ? 'text-danger-200' : 'text-success-200'
                            }
                          >
                            {t(
                              product.grossProfit < 0
                                ? 'cashSession.dayClose.lossShort'
                                : 'cashSession.dayClose.profitShort',
                              { amount: formatCurrency(Math.abs(product.grossProfit)) }
                            )}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Overlay>
  );
}
