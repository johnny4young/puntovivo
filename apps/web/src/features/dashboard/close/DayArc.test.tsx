import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { DayArc, type DayArcProps } from './DayArc';

// Midnight in Bogotá (UTC-5, no DST).
const DAY_START = '2026-03-10T05:00:00.000Z';

function hourlyWith(sales: Record<number, number>) {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, today: sales[hour] ?? 0 }));
}

function renderArc(props: Partial<DayArcProps> = {}) {
  return render(
    <DayArc
      hourly={hourlyWith({ 9: 120, 10: 340, 11: 80, 12: 510, 13: 260, 14: 90 })}
      dayStartIso={DAY_START}
      timeZone="America/Bogota"
      locale="en-US"
      marks={[]}
      {...props}
    >
      <span>centre</span>
    </DayArc>
  );
}

const hourLabels = () => screen.getAllByTestId('day-arc-hour').map(node => node.textContent);

describe('DayArc', () => {
  it('renders the children over a decorative svg', () => {
    renderArc();
    expect(screen.getByText('centre')).toBeInTheDocument();
    expect(screen.getByTestId('day-arc').querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  it('labels the active hours in the given time zone', () => {
    renderArc();
    expect(hourLabels()).toEqual(['9', '10', '11', '12', '1', '2', '3']);
  });

  it('follows the time zone, not the UTC offset of the day start', () => {
    renderArc({ timeZone: 'America/Mexico_City' });
    expect(hourLabels()).toEqual(['8', '9', '10', '11', '12', '1', '2']);
  });

  it('widens a short day to six hours and thins the labels of a long one', () => {
    const { unmount } = renderArc({ hourly: hourlyWith({ 12: 50 }) });
    expect(hourLabels()).toEqual(['10', '11', '12', '1', '2', '3', '4']);
    unmount();
    renderArc({ hourly: hourlyWith({ 6: 10, 21: 10 }) });
    expect(hourLabels()).toEqual(['6', '8', '10', '12', '2', '4', '6', '8', '10']);
  });

  it('draws one dot per mark inside the day and stretches the dial to reach it', () => {
    renderArc({
      marks: [
        '2026-03-10T19:30:00.000Z',
        '2026-03-11T02:41:00.000Z',
        '2026-03-09T23:00:00.000Z',
        'not-a-date',
      ],
    });
    const dots = screen.getAllByTestId('day-arc-mark');
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      expect(Number(dot.getAttribute('cx'))).toBeGreaterThanOrEqual(0);
      expect(Number(dot.getAttribute('cy'))).toBeLessThanOrEqual(292);
    }
    expect(hourLabels().at(-1)).toBe('9');
  });

  it('keeps the path data finite on a day without sales', () => {
    const { container } = renderArc({ hourly: hourlyWith({}) });
    const data = [...container.querySelectorAll('path')].map(path => path.getAttribute('d') ?? '');
    expect(data.length).toBeGreaterThan(0);
    for (const d of data) expect(d).not.toMatch(/NaN|Infinity|undefined/);
    expect(screen.queryAllByTestId('day-arc-mark')).toHaveLength(0);
  });

  it('gives each instance its own gradient', () => {
    const { container } = render(
      <>
        <DayArc hourly={[]} dayStartIso={DAY_START} timeZone="UTC" locale="es" marks={[]}>
          a
        </DayArc>
        <DayArc hourly={[]} dayStartIso={DAY_START} timeZone="UTC" locale="es" marks={[]}>
          b
        </DayArc>
      </>
    );
    const ids = [...container.querySelectorAll('linearGradient')].map(node => node.id);
    expect(new Set(ids).size).toBe(2);
    const fills = [...container.querySelectorAll('[data-testid="day-arc-area"]')].map(node =>
      node.getAttribute('fill')
    );
    expect(fills).toEqual(ids.map(id => `url(#${id})`));
  });
});
