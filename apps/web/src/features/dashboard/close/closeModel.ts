import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { buildWhatsAppShareUrl } from '@/features/sales/dayPulse';
import { roundMoney } from '@/lib/money';
import { sumBy } from '@/lib/numbers';

type DayCloseOutputs = inferRouterOutputs<AppRouter>['reports']['dayClose'];
export type CloseReport = DayCloseOutputs['preview'];
export type CloseChecklist = DayCloseOutputs['checklist'];
export type CloseSignoff = NonNullable<DayCloseOutputs['signoff']>;
export type CloseSession = CloseChecklist['sessions'][number];
export type CloseDraft = CloseChecklist['drafts'][number];
export type DifferenceReason = NonNullable<CloseSession['differenceReason']>;

export const DIFFERENCE_REASONS: readonly DifferenceReason[] = [
  'wrong_change',
  'unrecorded_withdrawal',
  'other',
];

export function fiscalInProgress(report: CloseReport): number {
  const { byStatus } = report.fiscal;
  return (
    byStatus.pending +
    byStatus.sent +
    byStatus.contingency +
    byStatus.notified_correction +
    byStatus.partial_send
  );
}

/** Card and transfer: the money that reaches the bank without being carried. */
export function electronicTotal(report: CloseReport): number {
  return roundMoney(
    sumBy(
      report.payments.filter(payment => payment.method === 'card' || payment.method === 'transfer'),
      payment => payment.amount
    )
  );
}

export interface CloseProgress {
  openRegisters: CloseSession[];
  closedRegisters: CloseSession[];
  differences: CloseSession[];
  pendingDrafts: CloseDraft[];
  carriedDrafts: CloseDraft[];
  carriedTotal: number;
  counted: boolean;
  compared: boolean;
  ready: number;
  total: number;
}

/**
 * Rows the sheet shows and how many no longer need the manager. Fiscal and
 * anomaly rows never block the close, so they count as ready.
 */
export function closeProgress(
  report: CloseReport,
  checklist: CloseChecklist,
  signed: boolean
): CloseProgress {
  const openRegisters = checklist.sessions.filter(session => session.status === 'open');
  const closedRegisters = checklist.sessions.filter(session => session.status === 'closed');
  const differences = closedRegisters.filter(session => session.hasDifference);
  const pendingDifferences = differences.filter(session => !session.differenceReason).length;
  const pendingDrafts = checklist.drafts.filter(draft => !draft.carriedOver);
  const carriedDrafts = checklist.drafts.filter(draft => draft.carriedOver);
  const differenceRows = Math.max(differences.length, 1);
  // Sales already left for tomorrow share one row; each one still pending gets its own.
  const draftRows = pendingDrafts.length + (carriedDrafts.length > 0 ? 1 : 0);
  const fiscalRows = report.fiscal.total > 0 ? 1 : 0;
  const total = 1 + differenceRows + draftRows + fiscalRows + 1 + 1;
  const pending =
    (openRegisters.length > 0 ? 1 : 0) +
    pendingDifferences +
    pendingDrafts.length +
    (signed ? 0 : 1);
  return {
    openRegisters,
    closedRegisters,
    differences,
    pendingDrafts,
    carriedDrafts,
    carriedTotal: roundMoney(sumBy(carriedDrafts, draft => draft.total)),
    counted: openRegisters.length === 0,
    compared: pendingDifferences === 0 && pendingDrafts.length === 0,
    ready: total - pending,
    total,
  };
}

/** The last register to close, which the register row names. */
export function lastClosed(sessions: readonly CloseSession[]): CloseSession | null {
  return sessions.reduce<CloseSession | null>(
    (latest, session) =>
      session.closedAt && (!latest?.closedAt || session.closedAt > latest.closedAt)
        ? session
        : latest,
    null
  );
}

export interface OwnerSummary {
  title: string;
  lines: string[];
  footer?: string;
}

/** Totals only: no customer, product or per-cashier detail leaves the device. */
export function buildOwnerSummaryUrl(summary: OwnerSummary): string {
  const text = [summary.title, ...summary.lines, ...(summary.footer ? ['', summary.footer] : [])]
    .join('\n')
    .trim();
  return buildWhatsAppShareUrl(text);
}

const SIGNATURE_PRECISION = 10;

/** Strokes in pad coordinates to the path data the server accepts: moves and lines only. */
export function strokesToPath(strokes: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>) {
  const round = (value: number) =>
    String(Math.round(Math.max(0, value) * SIGNATURE_PRECISION) / SIGNATURE_PRECISION);
  return strokes
    .filter(stroke => stroke.length > 0)
    .map(stroke =>
      stroke
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`)
        .join('')
    )
    .join('');
}
