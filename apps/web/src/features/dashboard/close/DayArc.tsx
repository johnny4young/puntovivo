import { useId, useMemo, type ReactNode } from 'react';
import { useElementWidth } from '@/hooks/useElementWidth';
import { blobLevels, polar as polarAt, semicircle as semicircleAt } from '../today/arcGeometry';
import { hourIndex } from '../today/todayModel';

export interface DayArcProps {
  /** Revenue per hour of the business day; hour 0 starts at dayStartIso. Same shape as operations.today hourly. */
  hourly: ReadonlyArray<{ hour: number; today: number }>;
  dayStartIso: string;
  /** IANA zone used for the local hour labels. */
  timeZone: string;
  /** i18n language used for the Intl hour labels. */
  locale: string;
  /** Instants drawn as green dots on the dial (register closes). */
  marks: ReadonlyArray<string>;
  /** Centre content (label, total, caption) rendered by the caller over the arc. */
  children: ReactNode;
}

const WIDTH = 560;
const HEIGHT = 316;
const CX = WIDTH / 2;
const CY = 292;
const DIAL_R = 184;
const BASE_R = 192;
const GROW = 58;
const LABEL_R = 165;
const MIN_SPAN = 6;
const MAX_LABELS = 8;
const LABEL_PX = 11;

const fixed = (value: number) => value.toFixed(1);

const polar = (radius: number, ratio: number) => polarAt(CX, CY, radius, ratio);
const semicircle = (radius: number) => semicircleAt(CX, CY, radius);

/** Hours shown on the dial: first to last activity, widened to MIN_SPAN. */
function activeRange(activity: number[], dayHours: number): [number, number] {
  if (activity.length === 0) return [0, dayHours];
  let from = Math.floor(Math.min(...activity));
  let to = Math.max(from + 1, Math.ceil(Math.max(...activity)));
  const missing = MIN_SPAN - (to - from);
  if (missing > 0) {
    from -= Math.floor(missing / 2);
    to += Math.ceil(missing / 2);
    const shift = Math.max(0, -from) - Math.max(0, to - dayHours);
    from += shift;
    to += shift;
  }
  return [Math.max(0, from), to];
}

function hourFormatter(locale: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone });
  } catch {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
  }
}

export function DayArc({ hourly, dayStartIso, timeZone, locale, marks, children }: DayArcProps) {
  const gradientId = `day-arc-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [ref, width] = useElementWidth<HTMLDivElement>(WIDTH);

  const model = useMemo(() => {
    const dayStart = Date.parse(dayStartIso);
    const sales = new Map<number, number>();
    for (const row of hourly) {
      if (Number.isInteger(row.hour) && row.hour >= 0 && Number.isFinite(row.today)) {
        sales.set(row.hour, Math.max(0, row.today));
      }
    }
    const dayHours = Math.max(24, hourly.length);
    const markHours = marks
      .map(iso => hourIndex(iso, dayStartIso))
      .filter(hour => Number.isFinite(hour) && hour >= 0 && hour <= dayHours);
    const sold = [...sales].filter(([, value]) => value > 0).map(([hour]) => hour);
    const [from, to] = activeRange(
      [...sold, ...sold.map(hour => hour + 1), ...markHours],
      dayHours
    );
    const span = to - from;
    const peak = Math.max(0, ...sales.values());
    const levels = Array.from({ length: span }, (_, index) =>
      peak > 0 ? (sales.get(from + index) ?? 0) / peak : 0
    );
    const outer = blobLevels(levels)
      .map(([ratio, level]) => polar(BASE_R + level * GROW, ratio))
      .map(([x, y]) => `${fixed(x)} ${fixed(y)}`)
      .join('L');
    const step = [1, 2, 3, 4, 6, 8, 12].find(size => span / size <= MAX_LABELS) ?? 12;
    const formatter = Number.isFinite(dayStart) ? hourFormatter(locale, timeZone) : null;
    const hours = Array.from({ length: span + 1 }, (_, index) => {
      const labelled = index % step === 0;
      const date = new Date(dayStart + (from + index) * 3_600_000);
      const text =
        labelled && formatter
          ? (formatter.formatToParts(date).find(part => part.type === 'hour')?.value ??
            formatter.format(date))
          : null;
      return { hour: from + index, ratio: index / span, text };
    });
    return {
      outline: `M${outer}`,
      area: `M${outer}L${CX + DIAL_R} ${CY}A${DIAL_R} ${DIAL_R} 0 0 0 ${CX - DIAL_R} ${CY}Z`,
      hours,
      dots: markHours.map(hour => polar(DIAL_R, (hour - from) / span)),
    };
  }, [hourly, dayStartIso, timeZone, locale, marks]);

  // Font size in viewBox units that renders at about LABEL_PX on screen.
  const labelSize = Math.min(18, Math.max(8, (LABEL_PX * WIDTH) / width));

  return (
    <div ref={ref} className="relative w-full" data-testid="day-arc">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={CY}
            x2={0}
            y2={CY - BASE_R - GROW}
          >
            <stop offset="0" stopColor="var(--primary-600)" stopOpacity={0.2} />
            <stop offset="1" stopColor="var(--primary-600)" stopOpacity={0.62} />
          </linearGradient>
        </defs>
        <path d={model.area} fill={`url(#${gradientId})`} data-testid="day-arc-area" />
        <path
          d={model.outline}
          fill="none"
          stroke="var(--primary-600)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <path d={semicircle(DIAL_R)} fill="none" stroke="var(--fg2)" strokeWidth={1.25} />
        {model.hours.map(({ hour, ratio, text }) => {
          const [x1, y1] = polar(DIAL_R, ratio);
          const [x2, y2] = polar(DIAL_R - (text === null ? 5 : 9), ratio);
          const [tx, ty] = polar(LABEL_R, Math.min(0.97, Math.max(0.03, ratio)));
          return (
            <g key={hour}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--fg2)" strokeWidth={1.25} />
              {text !== null && (
                <text
                  x={tx}
                  y={ty}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={labelSize}
                  className="fill-[var(--fg3)] font-semibold tabular-nums"
                  data-testid="day-arc-hour"
                >
                  {text}
                </text>
              )}
            </g>
          );
        })}
        <path d={semicircle(144)} fill="none" stroke="var(--fg1)" strokeWidth={8} />
        <path d={semicircle(132)} fill="none" stroke="var(--fg1)" strokeWidth={5} />
        <path d={semicircle(122)} fill="none" stroke="var(--fg4)" strokeWidth={4} />
        <line x1={8} x2={WIDTH - 8} y1={CY} y2={CY} stroke="var(--fg1)" strokeWidth={1.5} />
        {model.dots.map(([cx, cy], index) => (
          <circle
            key={index}
            cx={cx}
            cy={cy}
            r={4.5}
            fill="var(--success-500)"
            stroke="var(--surface)"
            strokeWidth={1.5}
            data-testid="day-arc-mark"
          />
        ))}
      </svg>
      <div className="absolute inset-x-0 bottom-[10%] mx-auto flex w-[42%] flex-col items-center text-center">
        {children}
      </div>
    </div>
  );
}
