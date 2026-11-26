import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

/**
 * Shape of the day-close transfer confirmation split as the server serves it
 * (`reports.dayClose.preview` → `transferConfirmations`).
 *
 * Everything newer than the original block is optional on purpose: a day close
 * signed before those fields existed still has to render, so the view never
 * assumes `superseded` or `notApplied` is there.
 */
export interface DayCloseTransferConfirmations {
  saleTotal: number;
  reported: number;
  confirmed: number;
  pending: number;
  rejected: number;
  legacy: number;
  unapplied: number;
  /** Money the planner replaced; already excluded from `reported`. */
  superseded?: number | undefined;
  /** Deposits received against a rejected/cancelled tender. Never sale money. */
  notApplied?: DayCloseTransferNotApplied | undefined;
  destinations: Array<{
    destinationId: string | null;
    label: string | null;
    kind: string | null;
    confirmed: number;
    pending: number;
    count: number;
    references: string[];
  }>;
}

export interface DayCloseTransferNotApplied {
  count: number;
  amount: number;
  byReason: Record<TransferNotAppliedReason, { count: number; amount: number }>;
}

/**
 * Figures the close reports, in the order the contract lists them. They are
 * never combined: each one is its own fact about the day's transfers.
 */
export const TRANSFER_FIGURE_KEYS = [
  'saleTotal',
  'reported',
  'confirmed',
  'pending',
  'rejected',
  'legacy',
  'unapplied',
] as const;

export type TransferFigureKey = (typeof TRANSFER_FIGURE_KEYS)[number] | 'superseded';

export const TRANSFER_NOT_APPLIED_REASONS = [
  'tender_rejected',
  'tender_cancelled',
  'other',
] as const;

export type TransferNotAppliedReason = (typeof TRANSFER_NOT_APPLIED_REASONS)[number];

export interface TransferFigure {
  key: TransferFigureKey;
  amount: number;
}

export interface TransferNotAppliedBucket {
  reason: TransferNotAppliedReason;
  count: number;
  amount: number;
}

export interface TransferDestinationSplit {
  key: string;
  label: string | null;
  confirmed: number;
  pending: number;
  count: number;
  references: string[];
}

export interface DayCloseTransferView {
  figures: TransferFigure[];
  notApplied: { count: number; amount: number; byReason: TransferNotAppliedBucket[] } | null;
  destinations: TransferDestinationSplit[];
  /** False when the day carries no transfer money at all, so the UI shows an empty state. */
  hasTransfers: boolean;
}

type ServerTransferConfirmations = NonNullable<
  inferRouterOutputs<AppRouter>['reports']['dayClose']['preview']['transferConfirmations']
>;

// Compile-time guard: this view stays in step with the served block, so a
// server-side rename breaks the build here instead of silently dropping a figure.
type AssertExtends<T extends U, U> = T;
export type ServerBlockSatisfiesView = AssertExtends<
  ServerTransferConfirmations,
  DayCloseTransferConfirmations
>;

/**
 * Turns the served block into what the day close renders, or `null` when the
 * report has no block at all (an older signed snapshot) so the page can skip the
 * section entirely instead of showing a header with no evidence.
 */
export function deriveDayCloseTransferSection(
  block: DayCloseTransferConfirmations | null | undefined
): DayCloseTransferView | null {
  if (!block) return null;
  const figures: TransferFigure[] = TRANSFER_FIGURE_KEYS.map(key => ({
    key,
    amount: block[key],
  }));
  if (typeof block.superseded === 'number') {
    figures.push({ key: 'superseded', amount: block.superseded });
  }
  const notAppliedSource = block.notApplied;
  const notApplied =
    notAppliedSource && (notAppliedSource.count > 0 || notAppliedSource.amount !== 0)
      ? {
          count: notAppliedSource.count,
          amount: notAppliedSource.amount,
          byReason: TRANSFER_NOT_APPLIED_REASONS.map(reason => ({
            reason,
            count: notAppliedSource.byReason[reason].count,
            amount: notAppliedSource.byReason[reason].amount,
          })),
        }
      : null;
  const destinations = block.destinations.map((destination, index) => ({
    key: destination.destinationId ?? `unlabelled-${index}`,
    label: destination.label,
    confirmed: destination.confirmed,
    pending: destination.pending,
    count: destination.count,
    references: destination.references,
  }));
  return {
    figures,
    notApplied,
    destinations,
    hasTransfers:
      destinations.length > 0 || notApplied !== null || figures.some(figure => figure.amount !== 0),
  };
}
