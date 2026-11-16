import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

export type CloseGuide = inferRouterOutputs<AppRouter>['reports']['dayClose']['guide'];
export type CloseGuideDifference = CloseGuide['differences'][number];
export type CloseGuideDraft = CloseGuide['drafts'][number];
export type VarianceReason = 'wrong_change' | 'unrecorded_withdrawal' | 'other';

export const VARIANCE_REASONS: readonly VarianceReason[] = [
  'wrong_change',
  'unrecorded_withdrawal',
  'other',
];

/** Contar until every drawer is closed, Comparar until every decision is taken, then Firmar. */
export function closeGuideStep(guide: CloseGuide): number {
  if (guide.signoff) return 3;
  if (guide.sessions.open > 0) return 0;
  return guide.readyToSign ? 2 : 1;
}

export function pendingDrafts(guide: CloseGuide): CloseGuideDraft[] {
  return guide.drafts.filter(draft => !draft.carriedOver);
}

/** Percent of last week's same day, null when last week sold nothing. */
export function soldChange(sold: number, comparison: number): number | null {
  if (comparison <= 0) return null;
  return Math.round(((sold - comparison) / comparison) * 1000) / 10;
}

/**
 * Half-circle gauge: the track spans the larger of today and the same day
 * last week, so the fill reads as today and the marker as last week.
 */
export function soldArcFractions(sold: number, comparison: number) {
  const scale = Math.max(sold, comparison, 1);
  return {
    sold: Math.max(0, sold) / scale,
    comparison: comparison > 0 ? comparison / scale : null,
  };
}

/** Point on the upper half circle: 0 is the left end, 1 the right end. */
export function arcPoint(fraction: number, cx: number, cy: number, radius: number) {
  const angle = Math.PI * (1 - Math.min(1, Math.max(0, fraction)));
  return { x: cx + radius * Math.cos(angle), y: cy - radius * Math.sin(angle) };
}

export function arcPath(fraction: number, cx: number, cy: number, radius: number): string {
  const start = arcPoint(0, cx, cy, radius);
  const end = arcPoint(fraction, cx, cy, radius);
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${radius} ${radius} 0 0 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

export interface OwnerSummaryLabels {
  title: string;
  sold: string;
  cashToDeposit: string;
  electronic: string;
  cashDifference: string;
  signedBy: string | null;
}

/** Plain text for the owner: figures only, no customer or product data. */
export function buildOwnerSummary(
  labels: OwnerSummaryLabels,
  figures: { sold: string; cashToDeposit: string; electronic: string; cashDifference: string }
): string {
  return [
    labels.title,
    `${labels.sold}: ${figures.sold}`,
    `${labels.cashToDeposit}: ${figures.cashToDeposit}`,
    `${labels.electronic}: ${figures.electronic}`,
    `${labels.cashDifference}: ${figures.cashDifference}`,
    ...(labels.signedBy ? ['', labels.signedBy] : []),
  ].join('\n');
}

export function ownerWhatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
