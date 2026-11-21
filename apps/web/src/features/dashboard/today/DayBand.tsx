import { useId } from 'react';
import { useElementWidth } from '@/hooks/useElementWidth';
import { useTranslation } from 'react-i18next';
import {
  dayPhases,
  hourIndex,
  placeBandLabels,
  type OperationsToday,
  type TodayPendingItem,
} from './todayModel';

interface DayBandProps {
  today: OperationsToday;
  numbered: ReadonlyArray<{ item: TodayPendingItem; rank: number }>;
  expanded: boolean;
  formatCurrency: (value: number) => string;
  formatTime: (iso: string) => string;
}

const PAD_X = 24;
// 11px semibold names run close to 6.5px per glyph.
const SHIFT_GLYPH_WIDTH = 6.5;

export function DayBand({ today, numbered, expanded, formatCurrency, formatTime }: DayBandProps) {
  const { t } = useTranslation('dashboard');
  const clipPrefix = useId();
  const [figureRef, WIDTH] = useElementWidth<HTMLElement>(920);
  const start = today.dayStartIso;
  const nowHour = hourIndex(today.generatedAt, start);
  const activeHours = today.hourly.filter(row => row.today > 0 || row.comparison > 0);
  const shiftHours = today.shifts.flatMap(shift => [
    hourIndex(shift.startsAt, start),
    hourIndex(shift.endsAt, start),
  ]);
  const from = Math.max(
    0,
    Math.floor(Math.min(6, nowHour, ...activeHours.map(row => row.hour), ...shiftHours))
  );
  const to = Math.min(
    today.hourly.length,
    Math.ceil(Math.max(21, nowHour + 1, ...activeHours.map(row => row.hour + 1), ...shiftHours))
  );
  const chartHeight = expanded ? 180 : 96;
  const axisY = 28 + chartHeight;
  const shiftTop = axisY + 30;
  const height = shiftTop + today.shifts.length * 22 + 8;
  const x = (hour: number) => PAD_X + ((hour - from) / (to - from)) * (WIDTH - PAD_X * 2);
  const peakValue = Math.max(1, ...today.hourly.map(row => Math.max(row.today, row.comparison)));
  const y = (value: number) => 28 + chartHeight - (value / peakValue) * (chartHeight - 8);
  const inRange = today.hourly.filter(row => row.hour >= from && row.hour < to);
  const todayPoints = inRange
    .filter(row => row.hour + 0.5 <= nowHour)
    .map(row => `${x(row.hour + 0.5)},${y(row.today)}`);
  const comparisonPoints = inRange.map(row => `${x(row.hour + 0.5)},${y(row.comparison)}`);
  const baseline = y(0);
  const phases = dayPhases(today, start);
  const nowInRange = nowHour >= from && nowHour <= to;
  const ticks = Array.from({ length: Math.floor((to - from) / 2) + 1 }, (_, i) => from + i * 2);
  const hourLabel = (hour: number) =>
    formatTime(new Date(Date.parse(start) + hour * 3_600_000).toISOString());

  const marks = [
    phases.openingHour !== null && { x: x(phases.openingHour), text: t('today.band.opening') },
    phases.peakHour !== null && {
      x: x(phases.peakHour),
      text:
        Math.floor(nowHour) === phases.peakHour ? t('today.band.peakNow') : t('today.band.peak'),
    },
    phases.handoffHour !== null && { x: x(phases.handoffHour), text: t('today.band.handoff') },
  ].filter((label): label is { x: number; text: string } => Boolean(label));
  const labels = placeBandLabels(marks, WIDTH, PAD_X);

  return (
    <figure ref={figureRef} className="m-0" data-testid="today-day-band">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={t('today.band.summary', {
          total: formatCurrency(today.sales.total),
          comparison: formatCurrency(today.sales.comparisonTotal),
        })}
      >
        {/* Every phase keeps its line; only overlapping text is dropped. */}
        {marks.map(mark => (
          <line
            key={mark.text}
            x1={mark.x}
            x2={mark.x}
            y1={14}
            y2={axisY}
            stroke="var(--line)"
            strokeWidth={1}
          />
        ))}
        {labels.map(label => (
          <text
            key={label.text}
            data-testid="today-band-label"
            x={label.textX}
            y={14}
            textAnchor={label.anchor}
            className="fill-[var(--fg3)] text-[11px] font-semibold tracking-[0.14em] uppercase"
          >
            {label.text}
          </text>
        ))}
        {comparisonPoints.length > 1 && (
          <polyline
            points={comparisonPoints.join(' ')}
            fill="none"
            stroke="var(--fg4)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            data-testid="today-band-comparison"
          />
        )}
        {todayPoints.length > 0 && (
          <>
            <polygon
              points={`${x(from + 0.5)},${baseline} ${todayPoints.join(' ')} ${todayPoints.at(-1)!.split(',')[0]},${baseline}`}
              fill="color-mix(in oklch, var(--primary-600) 28%, transparent)"
            />
            <polyline
              points={todayPoints.join(' ')}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2.5}
              strokeLinejoin="round"
              data-testid="today-band-today"
            />
          </>
        )}
        <line
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={axisY}
          y2={axisY}
          stroke="var(--fg1)"
          strokeWidth={1.5}
        />
        {ticks.map(hour => (
          <text
            key={hour}
            x={x(hour)}
            y={axisY + 18}
            textAnchor="middle"
            className="fill-[var(--fg3)] text-[11px]"
          >
            {hourLabel(hour)}
          </text>
        ))}
        {numbered
          .filter(({ item }) => hourIndex(item.at, start) >= from && item.kind !== 'attention')
          .map(({ item, rank }) => {
            const cx = x(Math.min(hourIndex(item.at, start), nowHour));
            const cy = axisY;
            return item.severity === 'blocks' ? (
              <g key={item.id}>
                <path d={`M${cx} ${cy - 9}l9 9-9 9-9-9z`} fill="var(--danger-500)" />
                <text
                  x={cx}
                  y={cy + 4}
                  textAnchor="middle"
                  className="fill-[var(--surface)] text-[10px] font-bold"
                >
                  {rank}
                </text>
              </g>
            ) : (
              <g key={item.id}>
                <circle cx={cx} cy={cy} r={8} fill="var(--warning-500)" />
                <text
                  x={cx}
                  y={cy + 3.5}
                  textAnchor="middle"
                  className="fill-[var(--fg1)] text-[10px] font-bold"
                >
                  {rank}
                </text>
              </g>
            );
          })}
        {nowInRange && (
          <g data-testid="today-band-now">
            <line
              x1={x(nowHour)}
              x2={x(nowHour)}
              y1={20}
              y2={height - 4}
              stroke="var(--fg1)"
              strokeWidth={1.5}
            />
            <circle
              cx={x(nowHour)}
              cy={todayPoints.length ? y(today.hourly[Math.floor(nowHour)]?.today ?? 0) : baseline}
              r={6}
              fill="var(--cobrar)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}
        {today.shifts.map((shift, index) => {
          const a = x(Math.max(from, hourIndex(shift.startsAt, start)));
          const b = x(Math.min(to, hourIndex(shift.endsAt, start)));
          const split = Math.min(b, Math.max(a, x(nowHour)));
          const top = shiftTop + index * 22;
          const labelX = Math.max(
            PAD_X,
            Math.min(a + 8, WIDTH - PAD_X - shift.userName.length * SHIFT_GLYPH_WIDTH)
          );
          const clipId = `${clipPrefix}-shift-${index}`;
          const label = (fill: string, clip: string, hidden = false) => (
            <text
              aria-hidden={hidden || undefined}
              x={labelX}
              y={top + 12}
              clipPath={`url(#${clip})`}
              className={`${fill} text-[11px] font-semibold`}
            >
              {shift.userName}
            </text>
          );
          return (
            <g key={`${shift.userId}-${shift.startsAt}`} data-testid="today-band-shift">
              <rect
                x={a}
                y={top}
                width={Math.max(0, b - a)}
                height={16}
                rx={8}
                fill="var(--surface-3)"
              />
              <rect
                x={a}
                y={top}
                width={Math.max(0, split - a)}
                height={16}
                rx={8}
                fill="var(--rail)"
              />
              <clipPath id={`${clipId}-elapsed`}>
                <rect x={a} y={top} width={Math.max(0, split - a)} height={16} />
              </clipPath>
              <clipPath id={`${clipId}-ahead`}>
                <rect x={0} y={top} width={a} height={16} />
                <rect x={split} y={top} width={WIDTH - split} height={16} />
              </clipPath>
              {/* Rail ink over the elapsed bar, dark ink everywhere else. */}
              {label('fill-[var(--rail-foreground)]', `${clipId}-elapsed`, true)}
              {label('fill-[var(--fg1)]', `${clipId}-ahead`)}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{t('today.band.tableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('today.band.hour')}</th>
            <th scope="col">{t('today.band.todayColumn')}</th>
            <th scope="col">{t('today.band.comparisonColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {inRange.map(row => (
            <tr key={row.hour}>
              <th scope="row">{hourLabel(row.hour)}</th>
              <td>{formatCurrency(row.today)}</td>
              <td>{formatCurrency(row.comparison)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
