import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import type { CashSessionDenomination } from '@/types';

type Outputs = inferRouterOutputs<AppRouter>['shiftHandoffs'];
export type HandOutPreview = NonNullable<Outputs['handOutPreview']>;
export type PendingHandoff = Outputs['pending']['handoffs'][number];
export type HandoffNotice = PendingHandoff['notices'][number];
export type ReceiveMode = 'counted_drawer' | 'new_float';

/** Coins are drawn round; the threshold follows the denominations the count sheet ships with. */
const COIN_MAX_VALUE = 1000;
const MATCH_EPSILON = 0.009;

export function isCoin(value: number): boolean {
  return value <= COIN_MAX_VALUE;
}

/** 100000 reads as 100 so the chip stays legible at till size. */
export function denominationLabel(value: number): string {
  return value >= 1000 && value % 1000 === 0 ? String(value / 1000) : String(value);
}

/**
 * Note and coin colours depict cash, so they stay the same in light and dark.
 * Every one keeps white text at 4.5:1 or better.
 */
const NOTE_COLORS = ['#1E7A4F', '#6B3FA0', '#9A4A12', '#A8251C', '#5E6B2A', '#0F5183'] as const;
const COIN_COLORS = ['#4D5F6C', '#6B5000'] as const;

export function denominationColor(value: number, rank: number): string {
  const palette = isCoin(value) ? COIN_COLORS : NOTE_COLORS;
  return palette[rank % palette.length]!;
}

export function countedTotal(denominations: readonly CashSessionDenomination[]): number {
  return denominations.reduce((sum, row) => sum + row.value * row.count, 0);
}

export function countsMatch(recount: number, counted: number): boolean {
  return Math.abs(recount - counted) <= MATCH_EPSILON;
}

/**
 * Cumulative sales of the shift as SVG points. The curve only needs the shape,
 * so both axes are normalised to the box.
 */
export function shiftCurvePoints(
  curve: ReadonlyArray<{ at: string; total: number }>,
  openedAt: string,
  endAt: string,
  width: number,
  height: number
): string {
  const start = Date.parse(openedAt);
  const span = Math.max(1, Date.parse(endAt) - start);
  const grand = curve.reduce((sum, sale) => sum + sale.total, 0);
  if (grand <= 0) return `0,${height} ${width},${height}`;
  let running = 0;
  const points = [`0,${height}`];
  for (const sale of curve) {
    running += sale.total;
    const x = Math.min(width, Math.max(0, ((Date.parse(sale.at) - start) / span) * width));
    const y = height - (running / grand) * height;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  points.push(`${width},0`);
  return points.join(' ');
}
