/** ENG-141c — portable server-side PDF renderer contract. */
import { describe, expect, it } from 'vitest';
import { LOCALE_FALLBACK, type ResolvedLocale } from '../tenant-locale.js';
import type { ComprehensiveDayCloseReport } from './comprehensive-day-close.js';
import {
  MAX_DAY_CLOSE_PDF_BYTES,
  buildDayClosePdfFilename,
  renderDayClosePdf,
} from './day-close-pdf.js';

const report: ComprehensiveDayCloseReport = {
  date: '2026-07-14',
  timeZone: 'America/Bogota',
  currencyCode: 'COP',
  generatedAt: '2026-07-15T02:00:00.000Z',
  window: {
    start: '2026-07-14T05:00:00.000Z',
    endExclusive: '2026-07-15T05:00:00.000Z',
  },
  sales: {
    count: 12,
    subtotal: 900_000,
    discounts: 30_000,
    taxes: 171_000,
    tips: 20_000,
    serviceCharges: 10_000,
    grossRevenue: 1_096_000,
    refundAmount: 50_000,
    netRevenue: 1_021_000,
  },
  payments: [
    { method: 'cash', amount: 600_000, transactionCount: 7 },
    { method: 'card', amount: 471_000, transactionCount: 5 },
  ],
  cash: {
    closedSessions: 2,
    openSessions: 0,
    expected: 600_000,
    counted: 595_000,
    overShort: -5_000,
    balancedSessions: 1,
    discrepancySessions: 1,
  },
  fiscal: {
    total: 12,
    totalAmount: 1_071_000,
    byStatus: {
      pending: 1,
      sent: 0,
      accepted: 10,
      rejected: 1,
      contingency: 0,
      voided: 0,
      notified_correction: 0,
      partial_send: 0,
    },
  },
  adjustments: {
    voids: { count: 1, amount: 25_000 },
    refunds: { count: 1, amount: 50_000 },
  },
  anomalies: {
    total: 2,
    high: 1,
    medium: 1,
    byKind: { ticketsPerHourSpike: 0, voidRate: 1, refundAmount: 1, noSaleSessions: 0 },
  },
  capabilities: { commissions: 'not_tracked', waste: 'not_tracked' },
  readiness: {
    readyToSign: true,
    blockers: [],
    warnings: ['commissions_not_tracked', 'waste_not_tracked'],
  },
};

const locale = (language: 'en' | 'es'): ResolvedLocale => ({
  ...LOCALE_FALLBACK,
  locale: language === 'es' ? 'es-CO' : 'en-US',
  language,
  currency: 'COP',
  displayDecimals: 0,
  timezone: 'America/Bogota',
});

function render(language: 'en' | 'es') {
  return renderDayClosePdf({
    tenantName: 'Puntovivo Test Store',
    report,
    reportHash: 'a'.repeat(64),
    signedByName: 'María Manager',
    signedAt: '2026-07-15T03:00:00.000Z',
    locale: locale(language),
  });
}

describe('day-close PDF renderer', () => {
  it('renders a deterministic, bounded PDF carrying the evidence identity', () => {
    const first = render('en');
    const second = render('en');
    const raw = first.toString('latin1');

    expect(first.equals(second)).toBe(true);
    expect(first.subarray(0, 8).toString()).toBe('%PDF-1.3');
    expect(first.subarray(-5).toString()).toBe('%%EOF');
    expect(first.byteLength).toBeLessThan(MAX_DAY_CLOSE_PDF_BYTES);
    expect(raw).toContain('Signed day-close report 2026-07-14');
    expect(raw).toContain('Puntovivo Test Store');
  });

  it('selects neutral Spanish copy from the resolved tenant locale', () => {
    const raw = render('es').toString('latin1');
    expect(raw).toContain('Reporte firmado de cierre del día');
    expect(raw).not.toContain('Signed day-close report');
  });

  it('builds a traceable filesystem-safe filename', () => {
    expect(buildDayClosePdfFilename('2026-07-14', 'abcdef0123456789')).toBe(
      'puntovivo-cierre-2026-07-14-abcdef01.pdf'
    );
  });
});
