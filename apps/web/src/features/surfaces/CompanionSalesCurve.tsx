import { useId } from 'react';
import { hourIndex, hourToIso } from '@/features/dashboard/today/todayModel';
import { useElementWidth } from '@/hooks/useElementWidth';

interface CompanionSalesCurveProps {
  /** Same shape as operations.today hourly: hour 0 starts at dayStartIso. */
  hourly: ReadonlyArray<{ hour: number; today: number; comparison?: number }>;
  dayStartIso: string;
  caption: string;
  /** "Now" on a live day, with the formatter for its time axis. */
  live?: { generatedAt: string; formatTime: (iso: string) => string };
}

const HEIGHT = 70;
const CLOSED_HEIGHT = 44;
const PAD_X = 6;
const PAD_TOP = 6;

const round = (value: number) => Math.round(value * 100) / 100;

export function CompanionSalesCurve({
  hourly,
  dayStartIso,
  caption,
  live,
}: CompanionSalesCurveProps) {
  // A finished day draws its whole line, without the now mark or the time axis.
  const closed = live === undefined;
  const gradientId = useId();
  const height = closed ? CLOSED_HEIGHT : HEIGHT;
  const baselineY = height - 8;
  const [rootRef, width] = useElementWidth<HTMLDivElement>(340);
  const rawNow = live ? hourIndex(live.generatedAt, dayStartIso) : hourly.length;
  const nowHour = Number.isFinite(rawNow) ? rawNow : 0;
  const activeHours = hourly.filter(row => row.today > 0 || (row.comparison ?? 0) > 0);
  const from = Math.max(0, Math.floor(Math.min(6, nowHour, ...activeHours.map(row => row.hour))));
  const to = Math.max(
    from + 1,
    Math.min(
      hourly.length,
      Math.ceil(Math.max(21, nowHour + 1, ...activeHours.map(row => row.hour + 1)))
    )
  );
  const x = (hour: number) => round(PAD_X + ((hour - from) / (to - from)) * (width - PAD_X * 2));
  const peak = Math.max(0, ...hourly.map(row => Math.max(row.today, row.comparison ?? 0)));
  const y = (value: number) =>
    round(baselineY - (peak > 0 ? value / peak : 0) * (baselineY - PAD_TOP));
  const inRange = hourly.filter(row => row.hour >= from && row.hour < to);
  const nowAt = Math.min(to, Math.max(from, nowHour));
  const nowX = x(nowAt);

  const elapsed = inRange.filter(row => row.hour + 0.5 <= nowAt);
  const ahead = inRange.filter(row => row.hour + 0.5 > nowAt);
  // The hour in progress is partial, so the line holds its last full value up to now.
  const nowY = elapsed.length > 0 && peak > 0 ? y(elapsed.at(-1)!.today) : baselineY;
  // Before the first sale there is no line to draw, only the now mark.
  const todayLine =
    peak > 0 && elapsed.some(row => row.today > 0)
      ? [...elapsed.map(row => `${x(row.hour + 0.5)} ${y(row.today)}`), `${nowX} ${nowY}`]
      : [];

  const before = elapsed.at(-1);
  const after = ahead[0];
  const comparisonNow =
    before && after
      ? (before.comparison ?? 0) +
        ((after.comparison ?? 0) - (before.comparison ?? 0)) * (nowAt - before.hour - 0.5)
      : ((after ?? before)?.comparison ?? 0);
  const comparisonLine =
    peak > 0 && ahead.length > 0
      ? [
          `${nowX} ${y(comparisonNow)}`,
          ...ahead.map(row => `${x(row.hour + 0.5)} ${y(row.comparison ?? 0)}`),
        ]
      : [];

  return (
    <div ref={rootRef} data-testid="companion-sales-curve">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--primary-600)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--primary-600)" stopOpacity={0.18} />
          </linearGradient>
        </defs>
        {comparisonLine.length > 1 && (
          <path
            d={`M${comparisonLine.join(' L')}`}
            fill="none"
            stroke="var(--fg4)"
            strokeWidth={1.25}
            strokeDasharray="3 3"
            data-testid="companion-sales-curve-comparison"
          />
        )}
        {todayLine.length > 1 && (
          <>
            <path
              d={`M${x(elapsed[0]!.hour + 0.5)} ${baselineY} L${todayLine.join(' L')} L${nowX} ${baselineY} Z`}
              fill={`url(#${gradientId})`}
            />
            <path
              d={`M${todayLine.join(' L')}`}
              fill="none"
              stroke="var(--primary-600)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              data-testid="companion-sales-curve-today"
            />
          </>
        )}
        <line
          x1={PAD_X}
          x2={width - PAD_X}
          y1={baselineY}
          y2={baselineY}
          stroke="var(--fg2)"
          strokeWidth={1}
        />
        {!closed && (
          <g data-testid="companion-sales-curve-now">
            <line
              x1={nowX}
              x2={nowX}
              y1={nowY}
              y2={baselineY + 5}
              stroke="var(--brand-accent-500)"
              strokeWidth={1.5}
            />
            <circle
              cx={nowX}
              cy={nowY}
              r={4}
              fill="var(--brand-accent-500)"
              stroke="var(--surface)"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>
      {!live ? (
        <span className="sr-only">{caption}</span>
      ) : (
        <div className="flex justify-between gap-2 text-[11px] text-fg3 tabular-nums">
          <span className="shrink-0">{live.formatTime(hourToIso(from, dayStartIso))}</span>
          <span className="min-w-0 truncate">{caption}</span>
          <span className="shrink-0">{live.formatTime(hourToIso(to, dayStartIso))}</span>
        </div>
      )}
    </div>
  );
}
