/**
 * ENG-205 — day-pulse text builder contract: aggregate lines only (never
 * customer data), owner lines gated by payload presence, weekly delta with
 * direction arrows, and the wa.me URL encoding.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { buildDayPulseText, buildWhatsAppShareUrl, type DayPulseSummary } from './dayPulse';

function makeSummary(overrides: Partial<DayPulseSummary> = {}): DayPulseSummary {
  return {
    session: { registerName: 'Caja 1' },
    day: { date: '2026-07-16', salesCount: 8, revenue: 400000 },
    previousWeek: { revenue: 320000 },
    margin: { grossProfit: 150000, grossMarginPct: 37.5 },
    streakDays: 4,
    ...overrides,
  };
}

describe('buildDayPulseText (ENG-205)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the full owner pulse with average ticket, margin, delta, and streak', () => {
    const text = buildDayPulseText(makeSummary(), i18n.t);

    expect(text).toContain('Day pulse — 2026-07-16 · Caja 1');
    expect(text).toContain('Sales: $400,000.00 (8 sales)');
    expect(text).toContain('Average ticket: $50,000.00');
    expect(text).toContain('Gross profit: $150,000.00 (37.5%)');
    expect(text).toContain('vs last week: ↑25%');
    expect(text).toContain('🔥 4 days balancing the register');
  });

  it('omits owner and reference lines when the payload lacks them', () => {
    const text = buildDayPulseText(
      makeSummary({ margin: null, previousWeek: null, streakDays: 0 }),
      i18n.t
    );

    expect(text).not.toContain('Gross profit');
    expect(text).not.toContain('vs last week');
    expect(text).not.toContain('🔥');
  });

  it('signals a down week with the inverted arrow', () => {
    const text = buildDayPulseText(
      makeSummary({ day: { date: '2026-07-16', salesCount: 4, revenue: 160000 } }),
      i18n.t
    );
    expect(text).toContain('vs last week: ↓50%');
  });

  it('encodes the text into the wa.me deep link', () => {
    const url = buildWhatsAppShareUrl('Ventas: $400.000 ↑25%');
    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(url).toContain(encodeURIComponent('↑25%'));
    expect(url).not.toContain(' ');
  });
});
