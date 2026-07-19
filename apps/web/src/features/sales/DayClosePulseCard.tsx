import { useMemo, useState } from 'react';
import { Download, MessageCircle, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatDate } from '@/lib/utils';
import { downloadFile } from '@/services/export/exportService';
import {
  buildDayCloseWhatsAppUrl,
  createDayClosePulsePng,
  pulseComparisonDirection,
  type DayClosePulseCardModel,
} from './dayClosePulse';

interface DayClosePulseCardProps {
  /**
   * ENG-205 — canonical WhatsApp share URL built by the modal from the full
   * summary (buildDayPulseText). When set it replaces the card-local builder
   * so the shared text has ONE source of truth.
   */
  shareUrl?: string;
  date: string;
  salesCount: number;
  revenue: number;
  averageTicket: number;
  previousWeekRevenue: number;
  revenueChangePct: number | null;
  grossProfit: number;
  grossMarginPct: number;
}

function PulseComparisonIcon({
  direction,
}: {
  direction: ReturnType<typeof pulseComparisonDirection>;
}) {
  const iconClass = 'mt-0.5 h-4 w-4 shrink-0 text-primary-300';
  if (direction === 'up') return <TrendingUp className={iconClass} aria-hidden="true" />;
  if (direction === 'down') return <TrendingDown className={iconClass} aria-hidden="true" />;
  return <Sparkles className={iconClass} aria-hidden="true" />;
}

export function DayClosePulseCard({
  shareUrl,
  date,
  salesCount,
  revenue,
  averageTicket,
  previousWeekRevenue,
  revenueChangePct,
  grossProfit,
  grossMarginPct,
}: DayClosePulseCardProps) {
  const { t, i18n } = useTranslation('sales');
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageError, setImageError] = useState(false);
  const direction = pulseComparisonDirection(revenueChangePct);

  const model = useMemo<DayClosePulseCardModel>(() => {
    const previousAmount = formatCurrency(previousWeekRevenue);
    const percent = Math.abs(revenueChangePct ?? 0).toFixed(1);
    const comparisonValue = t(`cashSession.dayClose.pulse.comparison.${direction}`, {
      amount: previousAmount,
      percent,
    });

    return {
      brand: t('cashSession.dayClose.pulse.brand'),
      title: t('cashSession.dayClose.pulse.title'),
      date: formatDate(
        `${date}T12:00:00.000Z`,
        {
          dateStyle: 'long',
          timeZone: 'UTC',
        },
        i18n.resolvedLanguage ?? i18n.language
      ),
      salesLabel: t('cashSession.dayClose.pulse.sales'),
      salesValue: formatCurrency(revenue),
      salesDetail: t('cashSession.dayClose.pulse.salesCount', { count: salesCount }),
      marginLabel: t('cashSession.dayClose.pulse.margin'),
      marginValue: `${grossMarginPct.toFixed(1)}%`,
      marginDetail: t('cashSession.dayClose.pulse.marginDetail', {
        amount: formatCurrency(grossProfit),
      }),
      averageTicketLabel: t('cashSession.dayClose.pulse.averageTicket'),
      averageTicketValue: formatCurrency(averageTicket),
      comparisonLabel: t('cashSession.dayClose.pulse.comparisonLabel'),
      comparisonValue,
      privacyNote: t('cashSession.dayClose.pulse.privacy'),
    };
  }, [
    averageTicket,
    date,
    direction,
    grossMarginPct,
    grossProfit,
    i18n.language,
    i18n.resolvedLanguage,
    previousWeekRevenue,
    revenue,
    revenueChangePct,
    salesCount,
    t,
  ]);
  const whatsappUrl = buildDayCloseWhatsAppUrl(model);

  async function handleDownload(): Promise<void> {
    setIsGenerating(true);
    setImageError(false);
    try {
      const image = await createDayClosePulsePng(model);
      downloadFile(image, `puntovivo-pulso-${date}.png`);
    } catch {
      setImageError(true);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section
      className="overflow-hidden rounded-[18px] border border-primary-400/25 bg-gradient-to-br from-primary-500/15 via-secondary-900/80 to-secondary-950"
      data-testid="day-close-pulse"
      aria-busy={isGenerating}
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary-300">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {t('cashSession.dayClose.pulse.eyebrow')}
            </p>
            <h3 className="mt-1.5 font-display text-xl tracking-[-0.02em] text-white">
              {model.title}
            </h3>
            <p className="mt-1 text-[12px] text-secondary-300">{model.date}</p>
          </div>
          <span className="rounded-full border border-primary-400/20 bg-primary-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary-200">
            {t('cashSession.dayClose.pulse.ownerOnly')}
          </span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3">
          <PulseMetric
            label={model.salesLabel}
            value={model.salesValue}
            detail={model.salesDetail}
          />
          <PulseMetric
            label={model.marginLabel}
            value={model.marginValue}
            detail={model.marginDetail}
          />
          <PulseMetric label={model.averageTicketLabel} value={model.averageTicketValue} />
        </div>

        <div className="flex items-start gap-3 rounded-[14px] border border-secondary-700/70 bg-secondary-950/55 px-3.5 py-3">
          <PulseComparisonIcon direction={direction} />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-400">
              {model.comparisonLabel}
            </p>
            <p className="mt-1 text-[12.5px] leading-5 text-secondary-100">
              {model.comparisonValue}
            </p>
          </div>
        </div>

        <p className="text-[11px] leading-4 text-secondary-400">{model.privacyNote}</p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="pv-btn outline flex-1 justify-center disabled:cursor-wait disabled:opacity-60"
            onClick={() => void handleDownload()}
            disabled={isGenerating}
          >
            <Download className={isGenerating ? 'animate-pulse' : ''} aria-hidden="true" />
            {isGenerating
              ? t('cashSession.dayClose.pulse.generating')
              : t('cashSession.dayClose.pulse.download')}
          </button>
          <a
            className="pv-btn primary flex-1 justify-center"
            href={shareUrl ?? whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="day-close-whatsapp"
          >
            <MessageCircle aria-hidden="true" />
            {t('cashSession.dayClose.pulse.whatsapp')}
          </a>
        </div>

        {imageError && (
          <p role="alert" className="text-[11.5px] text-warning-200">
            {t('cashSession.dayClose.pulse.imageError')}
          </p>
        )}
      </div>
    </section>
  );
}

function PulseMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-[14px] border border-secondary-700/60 bg-secondary-950/50 px-3.5 py-3">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.15em] text-secondary-400">
        {label}
      </p>
      <p className="mt-1 font-display text-xl tabular-nums tracking-[-0.02em] text-white">
        {value}
      </p>
      {detail && <p className="mt-0.5 text-[10.5px] text-secondary-400">{detail}</p>}
    </div>
  );
}
