import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { CompanionSalesCurve } from '../CompanionSalesCurve';

const start = '2026-11-11T05:00:00.000Z';
const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
const formatTime = (iso: string) => `t${(Date.parse(iso) - Date.parse(start)) / 3_600_000}`;
const busy = (hour: number) => hour >= 8 && hour < 20;
const hourly = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  today: busy(hour) && hour < 15 ? 100 + hour * 10 : 0,
  comparison: busy(hour) ? 80 + hour * 5 : 0,
}));

function renderCurve(rows = hourly, now = 15.2) {
  return render(
    <CompanionSalesCurve
      hourly={rows}
      dayStartIso={start}
      generatedAt={at(now)}
      formatTime={formatTime}
      caption="84 ventas"
    />
  );
}

/** X coordinates of a path's vertices. */
const xs = (testId: string) =>
  [
    ...screen
      .getByTestId(testId)
      .getAttribute('d')!
      .matchAll(/[ML]([\d.]+) /g),
  ].map(match => Number(match[1]));
const nowX = () =>
  Number(
    screen.getByTestId('companion-sales-curve-now').querySelector('circle')!.getAttribute('cx')
  );

describe('CompanionSalesCurve', () => {
  it('draws today only up to now', () => {
    renderCurve();
    const today = xs('companion-sales-curve-today');
    // Hours 6..14 are complete at 15.2, plus the point at now.
    expect(today).toHaveLength(10);
    expect(Math.max(...today)).toBe(nowX());
  });

  it('draws last week dashed from now on', () => {
    renderCurve();
    const path = screen.getByTestId('companion-sales-curve-comparison');
    expect(path).toHaveAttribute('stroke-dasharray');
    const comparison = xs('companion-sales-curve-comparison');
    // The point at now, then hours 15..20.
    expect(comparison).toHaveLength(7);
    expect(Math.min(...comparison)).toBe(nowX());
  });

  it('shows the caption between the first and last hour', () => {
    renderCurve();
    const labels = [...screen.getByTestId('companion-sales-curve').querySelectorAll('span')].map(
      span => span.textContent
    );
    expect(labels).toEqual(['t6', '84 ventas', 't21']);
  });

  it('hides the chart from assistive tech', () => {
    renderCurve();
    const svg = screen.getByTestId('companion-sales-curve').querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it.each([
    ['all-zero hours', hourly.map(row => ({ ...row, today: 0, comparison: 0 }))],
    ['no hours', []],
  ])('keeps the baseline and the now marker with %s', (_name, rows) => {
    renderCurve(rows);
    const root = screen.getByTestId('companion-sales-curve');
    expect(screen.queryByTestId('companion-sales-curve-today')).not.toBeInTheDocument();
    expect(screen.queryByTestId('companion-sales-curve-comparison')).not.toBeInTheDocument();
    expect(screen.getByTestId('companion-sales-curve-now').querySelector('circle')).not.toBeNull();
    expect(root.querySelector('svg > line')).not.toBeNull();
    expect(root.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
