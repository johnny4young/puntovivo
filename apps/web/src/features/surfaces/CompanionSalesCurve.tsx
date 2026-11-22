import { useId } from 'react';
import { hourIndex, hourToIso } from '@/features/dashboard/today/todayModel';
import { useElementWidth } from '@/hooks/useElementWidth';

interface CompanionSalesCurveProps {
  /** Same shape as operations.today hourly: hour 0 starts at dayStartIso. */
  hourly: ReadonlyArray<{ hour: number; today: number; comparison: number }>;
  dayStartIso: string;
  /** When the data was read; "now" on the curve. */
  generatedAt: string;
  formatTime: (iso: string) => string;
  caption: string;
}

const HEIGHT = 70;
const PAD_X = 6;
const PAD_TOP = 6;
const BASELINE_Y = HEIGHT - 8;

const round = (value: number) => Math.round(value * 100) / 100;

export function CompanionSalesCurve({
  hourly,
  dayStartIso,
  generatedAt,
  formatTime,
  caption,
}: CompanionSalesCurveProps) {
  const gradientId = useId();
  const [rootRef, width] = useElementWidth<HTMLDivElement>(340);
  const rawNow = hourIndex(generatedAt, dayStartIso);
  const nowHour = Number.isFinite(rawNow) ? rawNow : 0;
  const activeHours = hourly.filter(row => row.today > 0 || row.comparison > 0);
  const from = Math.max(0, Math.floor(Math.min(6, nowHour, ...activeHours.map(row => row.hour))));
  const to = Math.max(
    from + 1,
    Math.min(
      hourly.length,
      Math.ceil(Math.max(21, nowHour + 1, ...activeHours.map(row => row.hour + 1)))
    )
  );
  const x = (hour: number) => round(PAD_X + ((hour - from) / (to - from)) * (width - PAD_X * 2));
  const peak = Math.max(0, ...hourly.map(row => Math.max(row.today, row.comparison)));
  const y = (value: number) =>
    round(BASELINE_Y - (peak > 0 ? value / peak : 0) * (BASELINE_Y - PAD_TOP));
  const inRange = hourly.filter(row => row.hour >= from && row.hour < to);
  const nowAt = Math.min(to, Math.max(from, nowHour));
  const nowX = x(nowAt);

  const elapsed = inRange.filter(row => row.hour + 0.5 <= nowAt);
  const ahead = inRange.filter(row => row.hour + 0.5 > nowAt);
  // The hour in progress is partial, so the line holds its last full value up to now.
  const nowY = elapsed.length > 0 && peak > 0 ? y(elapsed.at(-1)!.today) : BASELINE_Y;
  const todayLine =
    peak > 0 && elapsed.length > 0
      ? [...elapsed.map(row => `${x(row.hour + 0.5)} ${y(row.today)}`), `${nowX} ${nowY}`]
      : [];

  const before = elapsed.at(-1);
  const after = ahead[0];
  const comparisonNow =
    before && after
      ? before.comparison + (after.comparison - before.comparison) * (nowAt - before.hour - 0.5)
      : ((after ?? before)?.comparison ?? 0);
  const comparisonLine =
    peak > 0 && ahead.length > 0
      ? [
          `${nowX} ${y(comparisonNow)}`,
          ...ahead.map(row => `${x(row.hour + 0.5)} ${y(row.comparison)}`),
        ]
      : [];

  return (
    <div ref={rootRef} data-testid="companion-sales-curve">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
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
              d={`M${x(elapsed[0]!.hour + 0.5)} ${BASELINE_Y} L${todayLine.join(' L')} L${nowX} ${BASELINE_Y} Z`}
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
          y1={BASELINE_Y}
          y2={BASELINE_Y}
          stroke="var(--fg2)"
          strokeWidth={1}
        />
        <g data-testid="companion-sales-curve-now">
          <line
            x1={nowX}
            x2={nowX}
            y1={nowY}
            y2={BASELINE_Y + 5}
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
      </svg>
      <div className="flex justify-between gap-2 text-[11px] text-fg3 tabular-nums">
        <span className="shrink-0">{formatTime(hourToIso(from, dayStartIso))}</span>
        <span className="min-w-0 truncate">{caption}</span>
        <span className="shrink-0">{formatTime(hourToIso(to, dayStartIso))}</span>
      </div>
    </div>
  );
}
