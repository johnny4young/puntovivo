import type { QuotationListEntry, QuotationStatus, QuotationTransitionStatus } from '@/types';

/**
 * Status badge utility classes — mirrors the convention used by other history
 * tables (TransferHistory, PurchasesHistory) so the visual language stays
 * consistent across modules.
 */
export const QUOTATION_STATUS_BADGE_CLASSES: Record<QuotationStatus, string> = {
  draft:
    'inline-flex items-center rounded-full bg-secondary-100 px-2 py-0.5 text-xs text-secondary-700',
  sent: 'inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-700',
  accepted:
    'inline-flex items-center rounded-full bg-success-100 px-2 py-0.5 text-xs text-success-700',
  rejected:
    'inline-flex items-center rounded-full bg-danger-100 px-2 py-0.5 text-xs text-danger-700',
  expired:
    'inline-flex items-center rounded-full bg-warning-100 px-2 py-0.5 text-xs text-warning-800',
  converted:
    'inline-flex items-center rounded-full bg-success-200 px-2 py-0.5 text-xs text-success-900',
};

/**
 * Statuses an operator can transition to from each current status. Mirrors
 * the server-side ALLOWED_TRANSITIONS contract — keep them in sync. An
 * An `accepted` quote closes either by expiring or through an atomic sale;
 * `converted` is reserved for that sale transaction and never appears as a
 * generic status button.
 */
const TRANSITIONS_FROM_STATUS: Record<QuotationStatus, readonly QuotationTransitionStatus[]> = {
  draft: ['sent', 'rejected', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: ['expired'],
  rejected: [],
  expired: [],
  converted: [],
};

export function getAvailableTransitions(
  entry: Pick<QuotationListEntry, 'status'>
): readonly QuotationTransitionStatus[] {
  return TRANSITIONS_FROM_STATUS[entry.status];
}

export function canDeleteQuotation(entry: Pick<QuotationListEntry, 'status'>): boolean {
  return entry.status === 'draft';
}

/** Accepted quotations remain convertible only while their validity is live. */
export function canConvertQuotation(
  entry: Pick<QuotationListEntry, 'status' | 'validUntil'>,
  nowIso: string
): boolean {
  if (entry.status !== 'accepted') return false;
  if (!entry.validUntil) return true;
  const validUntil = Date.parse(entry.validUntil);
  const now = Date.parse(nowIso);
  return Number.isFinite(validUntil) && Number.isFinite(now) && validUntil >= now;
}
