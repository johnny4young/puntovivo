import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { blobLevels, dayArcSpan, polar, semicircle, type ArcPoint } from './arcGeometry';
import { hourToIso, type OperationsToday } from './todayModel';
import { cn } from '@/lib/utils';

export interface TodayArcProps {
  today: OperationsToday;
  formatTime: (iso: string) => string;
  /** Distance from the row top to the axis the arc's baseline lines up with. */
  baselineY: number;
  className?: string;
}

const WIDTH = 300;
const HEIGHT = 160;
const CX = WIDTH / 2;
const CY = 150;
const DIAL_R = 96;
const BASE_R = 102;
const GROW = 28;
const NEEDLE_R = 139;
const BOX_WIDTH = 'min(28%, 280px)';

const at = (radius: number, ratio: number) => polar(CX, CY, radius, ratio);
const pair = ([x, y]: ArcPoint) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** Curve points up to a ratio, ending exactly on it so the blob stops at now. */
function upTo(points: ArcPoint[], ratio: number): ArcPoint[] {
  const next = points.findIndex(([position]) => position >= ratio);
  if (next <= 0) return points;
  const [fromRatio, fromLevel] = points[next - 1]!;
  const [toRatio, toLevel] = points[next]!;
  const share = (ratio - fromRatio) / (toRatio - fromRatio);
  return [...points.slice(0, next), [ratio, fromLevel + (toLevel - fromLevel) * share]];
}

function blob(points: ArcPoint[]) {
  const outline = `M${points.map(([ratio, level]) => pair(at(BASE_R + level * GROW, ratio))).join('L')}`;
  const end = at(BASE_R, points[points.length - 1]![0]);
  const start = at(BASE_R, points[0]![0]);
  return {
    outline,
    area: `${outline}L${pair(end)}A${BASE_R} ${BASE_R} 0 0 0 ${pair(start)}Z`,
  };
}

export function TodayArc({ today, formatTime, baselineY, className }: TodayArcProps) {
  const { t } = useTranslation('dashboard');
  const gradientId = `today-arc-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const model = useMemo(() => {
    const { from, to, now } = dayArcSpan(today);
    const span = to - from;
    const ratio = Math.min(1, Math.max(0, (now - from) / span));
    const rows = new Map(today.hourly.map(row => [row.hour, row]));
    const hours = Array.from({ length: span }, (_, index) => rows.get(from + index));
    const sold = hours.map(row => Math.max(0, row?.today ?? 0));
    const compared = hours.map(row => Math.max(0, row?.comparison ?? 0));
    // One peak for both curves, so today reads against last week at the same scale.
    const peak = Math.max(0, ...sold, ...compared);
    const levels = (values: number[]) => blobLevels(values.map(value => value / peak));
    const todayPoints =
      ratio > 0 && sold.some(value => value > 0) ? upTo(levels(sold), ratio) : null;
    return {
      today: todayPoints ? blob(todayPoints) : null,
      comparison: compared.some(value => value > 0) ? blob(levels(compared)) : null,
      needleFrom: at(DIAL_R, ratio),
      needleTo: at(NEEDLE_R, ratio),
      dot: at(BASE_R + (todayPoints?.[todayPoints.length - 1]?.[1] ?? 0) * GROW, ratio),
      opening: formatTime(hourToIso(from, today.dayStartIso)),
      close: formatTime(hourToIso(to, today.dayStartIso)),
      percent: Math.round(ratio * 100),
    };
  }, [today, formatTime]);

  return (
    <figure
      className={cn('m-0', className)}
      style={{
        width: BOX_WIDTH,
        // Margin percentages resolve against the row width, like the width itself.
        marginTop: `calc(${baselineY}px - ${BOX_WIDTH} * ${CY / WIDTH})`,
      }}
      data-testid="today-arc"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full"
        role="img"
        aria-label={t('today.arc.summary', {
          opening: model.opening,
          close: model.close,
          percent: model.percent,
        })}
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
        {model.comparison && (
          <>
            <path d={model.comparison.area} fill="var(--surface-3)" opacity={0.75} />
            <path
              d={model.comparison.outline}
              fill="none"
              stroke="var(--fg4)"
              strokeWidth={1.44}
              strokeDasharray="1.5 5"
              strokeLinecap="round"
              data-testid="today-arc-comparison"
            />
          </>
        )}
        {model.today && (
          <>
            <path d={model.today.area} fill={`url(#${gradientId})`} />
            <path
              d={model.today.outline}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2.4}
              strokeLinejoin="round"
              strokeLinecap="round"
              data-testid="today-arc-today"
            />
          </>
        )}
        <path
          d={semicircle(CX, CY, DIAL_R)}
          fill="none"
          stroke="var(--fg1)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <line
          x1={10}
          x2={WIDTH - 10}
          y1={CY}
          y2={CY}
          stroke="var(--fg1)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <g data-testid="today-arc-now">
          <line
            x1={model.needleFrom[0]}
            y1={model.needleFrom[1]}
            x2={model.needleTo[0]}
            y2={model.needleTo[1]}
            stroke="var(--fg1)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <circle
            cx={model.dot[0]}
            cy={model.dot[1]}
            r={5.5}
            fill="var(--cobrar)"
            stroke="var(--surface)"
            strokeWidth={3}
          />
        </g>
      </svg>
    </figure>
  );
}
