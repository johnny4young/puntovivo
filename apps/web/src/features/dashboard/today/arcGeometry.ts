import { hourIndex, type OperationsToday } from './todayModel';

export type ArcPoint = [number, number];

const SAMPLES_PER_HOUR = 8;

/** Point on a half-dome centred at (cx, cy): ratio 0 is the left end, 1 the right end. */
export function polar(cx: number, cy: number, radius: number, ratio: number): ArcPoint {
  const angle = Math.PI * (1 - ratio);
  return [cx + radius * Math.cos(angle), cy - radius * Math.sin(angle)];
}

export function semicircle(cx: number, cy: number, radius: number) {
  return `M${cx - radius} ${cy}A${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;
}

/** Catmull-Rom through the hourly levels, clamped so the curve never dips under the base. */
export function blobLevels(levels: number[]): ArcPoint[] {
  const span = levels.length;
  const knots: ArcPoint[] = [
    [0, 0],
    ...levels.map((level, index): ArcPoint => [index + 0.5, level]),
    [span, 0],
  ];
  const at = (index: number) => knots[Math.min(knots.length - 1, Math.max(0, index))]!;
  const points: ArcPoint[] = [[0, 0]];
  for (let i = 0; i < knots.length - 1; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1)[1], at(i)[1], at(i + 1)[1], at(i + 2)[1]];
    for (let step = 1; step <= SAMPLES_PER_HOUR; step += 1) {
      const t = step / SAMPLES_PER_HOUR;
      const level =
        0.5 *
        (2 * p1 +
          (p2 - p0) * t +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
          (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
      const position = at(i)[0] + (at(i + 1)[0] - at(i)[0]) * t;
      points.push([position / span, Math.min(1.04, Math.max(0, level))]);
    }
  }
  return points;
}

export interface DayArcSpan {
  from: number;
  to: number;
  now: number;
}

/** Whole business hours the arc covers, opening to close, plus where now falls in them. */
export function dayArcSpan(today: OperationsToday): DayArcSpan {
  const start = today.dayStartIso;
  const dayHours = today.hourly.length || 24;
  const clamp = (hour: number) => Math.min(dayHours, Math.max(0, hour));
  const rawNow = hourIndex(today.generatedAt, start);
  const now = Number.isFinite(rawNow) ? clamp(rawNow) : 0;
  const sold = today.hourly.filter(row => row.today > 0).map(row => row.hour);
  const starts = today.shifts.map(shift => hourIndex(shift.startsAt, start));
  const ends = today.shifts.map(shift => hourIndex(shift.endsAt, start));
  const opens = [...starts, ...sold].filter(Number.isFinite);
  const closes = [...ends, ...sold.map(hour => hour + 1)].filter(Number.isFinite);
  const opening = opens.length ? Math.min(...opens) : Math.min(6, now);
  const from = Math.min(dayHours - 1, Math.floor(clamp(opening)));
  const close = Math.max(now, ...(closes.length ? closes : [21]));
  return { from, to: Math.max(from + 1, Math.ceil(clamp(close))), now };
}
