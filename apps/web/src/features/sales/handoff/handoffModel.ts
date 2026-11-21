import type { InvalidationPicker } from '@/lib/invalidateGroups';
import type { CashSessionDenomination } from '@/types';
import { cashDenominationsFor, isCashCoin } from '../cashDenominations';

/** Fewer coins than this in the drawer reads as short on change. */
export const LOW_CHANGE_COIN_PIECES = 10;

/** Coins counted when the drawer is short on change; null when it is not or the currency is unknown. */
export function lowChangeCoins(
  denominations: readonly CashSessionDenomination[],
  currencyCode: string
): CashSessionDenomination[] | null {
  if (cashDenominationsFor(currencyCode).length === 0) return null;
  const coins = denominations.filter(row => isCashCoin(row.value, currencyCode));
  const pieces = coins.reduce((sum, row) => sum + row.count, 0);
  return pieces < LOW_CHANGE_COIN_PIECES ? coins.filter(row => row.count > 0) : null;
}

export interface ShiftDuration {
  hours: number;
  minutes: number;
}

export function shiftDuration(fromIso: string, now: Date): ShiftDuration {
  const totalMinutes = Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 60_000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

export interface Sparkline {
  line: string;
  area: string;
  end: { x: number; y: number };
}

/** Smoothed path through the slice values, scaled to the box; null without sales. */
export function sparkline(
  slices: readonly number[],
  width: number,
  height: number
): Sparkline | null {
  const peak = Math.max(...slices, 0);
  if (slices.length < 2 || peak <= 0) return null;
  const step = width / (slices.length - 1);
  const top = 4;
  const points = slices.map((value, index) => ({
    x: index * step,
    y: top + (height - top) * (1 - value / peak),
  }));
  let line = `M${points[0]!.x},${points[0]!.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]!;
    const point = points[index]!;
    const midX = (prev.x + point.x) / 2;
    line += ` C${midX},${prev.y} ${midX},${point.y} ${point.x},${point.y}`;
  }
  const end = points[points.length - 1]!;
  return { line, area: `${line} L${end.x},${height} L0,${height} Z`, end };
}

interface DraftRow {
  id: string;
  saleNumber: string;
  total: number;
  suspendedAt: string | null;
  suspendedBy: string | null;
  suspendedLabel: string | null;
  createdBy: string;
  tableId: string | null;
  cashSessionId: string | null;
}

/** Retail drafts the cashier parked; the server passes the same set to whoever receives. */
export function draftsPassingOn<T extends DraftRow>(drafts: readonly T[], userId: string): T[] {
  return drafts.filter(
    draft =>
      draft.suspendedAt !== null &&
      draft.tableId === null &&
      draft.cashSessionId !== null &&
      (draft.suspendedBy === userId || (draft.suspendedBy === null && draft.createdBy === userId))
  );
}

/** The rows with one count replaced, for the counters' change handler. */
export function withCountAt(
  rows: readonly CashSessionDenomination[],
  index: number,
  count: number
): CashSessionDenomination[] {
  return rows.map((row, rowIndex) => (rowIndex === index ? { ...row, count } : row));
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map(part => part.charAt(0).toLocaleUpperCase())
    .join('');
}

export const PIN_LENGTH = 6;

export const isCompletePin = (pin: string) => pin.length === PIN_LENGTH;

/** Reads a handoff changes besides the session itself. */
export const HANDOFF_INVALIDATIONS: ReadonlyArray<InvalidationPicker> = [
  u => u.cashSessions.pendingHandoffs,
  u => u.sales.listDrafts,
  u => u.operations.today,
];
