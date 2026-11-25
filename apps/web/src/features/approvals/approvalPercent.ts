import { formatPercent } from '@/lib/utils';

/** A share as the approver reads it: whole numbers bare, others to one decimal. */
export function percent(value: number): string;
export function percent(value: number | null): string | null;
export function percent(value: number | null) {
  return value === null ? null : formatPercent(value, Number.isInteger(value) ? 0 : 1);
}
