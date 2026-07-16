import type { TFunction } from 'i18next';
import { formatCurrency } from '@/lib/utils';

/**
 * ENG-205 (WC-C8) — the fields the shareable day pulse consumes. A local
 * structural type (instead of the router inference) so the pure builder
 * stays unit-testable without a tRPC harness; it matches the
 * `cashSessions.dayCloseSummary` payload by construction.
 */
export interface DayPulseSummary {
  session: { registerName: string };
  day: { date: string; salesCount: number; revenue: number };
  previousWeek: { revenue: number } | null;
  margin: { grossProfit: number; grossMarginPct: number } | null;
  streakDays: number;
}

/**
 * Build the WhatsApp-ready day pulse. Plain text on purpose (v1 of WC-C8):
 * every line is aggregate business data — sales, average ticket, optional
 * margin (only present when the server sent it, i.e. owner roles), the
 * same-weekday-last-week delta, and the balanced streak. NO customer data
 * ever enters this string.
 */
export function buildDayPulseText(summary: DayPulseSummary, t: TFunction): string {
  const lines: string[] = [];
  lines.push(
    t('sales:cashSession.dayClose.pulse.title', {
      date: summary.day.date,
      registerName: summary.session.registerName,
    })
  );
  lines.push(
    t('sales:cashSession.dayClose.pulse.sales', {
      amount: formatCurrency(summary.day.revenue),
      count: summary.day.salesCount,
    })
  );
  if (summary.day.salesCount > 0) {
    lines.push(
      t('sales:cashSession.dayClose.pulse.avgTicket', {
        amount: formatCurrency(summary.day.revenue / summary.day.salesCount),
      })
    );
  }
  if (summary.margin) {
    lines.push(
      t('sales:cashSession.dayClose.pulse.margin', {
        amount: formatCurrency(summary.margin.grossProfit),
        percent: summary.margin.grossMarginPct.toFixed(1),
      })
    );
  }
  if (summary.previousWeek && summary.previousWeek.revenue > 0) {
    const deltaPct = Math.round(
      ((summary.day.revenue - summary.previousWeek.revenue) / summary.previousWeek.revenue) * 100
    );
    const key =
      deltaPct > 0
        ? 'pulse.vsLastWeekUp'
        : deltaPct < 0
          ? 'pulse.vsLastWeekDown'
          : 'pulse.vsLastWeekFlat';
    lines.push(t(`sales:cashSession.dayClose.${key}`, { percent: Math.abs(deltaPct) }));
  }
  if (summary.streakDays > 0) {
    lines.push(t('sales:cashSession.dayClose.pulse.streak', { count: summary.streakDays }));
  }
  return lines.join('\n');
}

/** wa.me deep link for the pulse (v1 share channel per the WC-C8 spec). */
export function buildWhatsAppShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
