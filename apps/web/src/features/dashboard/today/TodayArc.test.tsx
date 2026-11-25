import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { todayFixture } from './fixtures';
import { TodayArc } from './TodayArc';
import type { OperationsToday } from './todayModel';

const start = todayFixture().dayStartIso;
const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
const formatTime = (iso: string) => `t${(Date.parse(iso) - Date.parse(start)) / 3_600_000}`;

function renderArc(overrides: Partial<OperationsToday> = {}) {
  return render(
    <TodayArc today={todayFixture(overrides)} formatTime={formatTime} baselineY={208} />
  );
}

const dotX = () =>
  Number(screen.getByTestId('today-arc-now').querySelector('circle')?.getAttribute('cx'));

describe('TodayArc', () => {
  it('names the opening, the close and the elapsed share of the day', () => {
    renderArc();
    const label = screen.getByRole('img').getAttribute('aria-label');
    expect(label).toMatch(/t7\b.*t21\b/);
    expect(label).toMatch(/\b31\b/);
  });

  it('draws today and last week when there are sales', () => {
    renderArc();
    expect(screen.getByTestId('today-arc-today')).toBeInTheDocument();
    expect(screen.getByTestId('today-arc-comparison')).toBeInTheDocument();
  });

  it('keeps the dial and the now marker on a day with no sales', () => {
    renderArc({
      hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, today: 0, comparison: 0 })),
    });
    expect(screen.queryByTestId('today-arc-today')).not.toBeInTheDocument();
    expect(screen.queryByTestId('today-arc-comparison')).not.toBeInTheDocument();
    expect(screen.getByTestId('today-arc-now').querySelector('line')).not.toBeNull();
    expect(dotX()).toBeLessThan(150);
  });

  it('puts now on the left early in the day and on the right late in it', () => {
    const { unmount } = renderArc({ generatedAt: at(8) });
    expect(dotX()).toBeLessThan(150);
    unmount();
    renderArc({ generatedAt: at(19) });
    expect(dotX()).toBeGreaterThan(150);
  });

  it('pins now to the opening end before the day starts', () => {
    renderArc({ generatedAt: at(3) });
    expect(dotX()).toBeCloseTo(48, 0);
  });
});
