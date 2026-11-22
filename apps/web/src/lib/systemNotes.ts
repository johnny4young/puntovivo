import type { TFunction } from 'i18next';

type Render = (match: RegExpMatchArray, t: TFunction) => string;

const RULES: ReadonlyArray<readonly [RegExp, Render]> = [
  [
    /^Sale (\S+) · completed from draft$/,
    (m, t) => t('common:systemNotes.saleFromDraft', { number: m[1] }),
  ],
  [
    /^Sale (\S+) · (.+)$/,
    (m, t) => t('common:systemNotes.saleAtSite', { number: m[1], site: m[2] }),
  ],
  [/^Refunded sale (\S+)$/, (m, t) => t('common:systemNotes.refundedSale', { number: m[1] })],
  [/^Return of sale (\S+)$/, (m, t) => t('common:systemNotes.refundedSale', { number: m[1] })],
  [/^Return \S+ for sale (\S+)$/, (m, t) => t('common:systemNotes.refundedSale', { number: m[1] })],
  [/^Voided sale (\S+)$/, (m, t) => t('common:systemNotes.voidedSale', { number: m[1] })],
  [/^Discarded draft (\S+)$/, (m, t) => t('common:systemNotes.discardedDraft', { number: m[1] })],
  [
    /^Purchase (\S+) · received from order (\S+)$/,
    (m, t) => t('common:systemNotes.purchaseReceivedFromOrder', { number: m[1], order: m[2] }),
  ],
  [
    /^Purchase (\S+) · order (\S+)$/,
    (m, t) => t('common:systemNotes.purchaseForOrder', { number: m[1], order: m[2] }),
  ],
  [
    /^Purchase (\S+) · (.+)$/,
    (m, t) => t('common:systemNotes.purchaseAtSite', { number: m[1], site: m[2] }),
  ],
  [/^Purchase (\S+)$/, (m, t) => t('common:systemNotes.purchase', { number: m[1] })],
  [
    /^Returned purchase (\S+)$/,
    (m, t) => t('common:systemNotes.returnedPurchase', { number: m[1] }),
  ],
  [/^Voided purchase (\S+)$/, (m, t) => t('common:systemNotes.voidedPurchase', { number: m[1] })],
  [
    /^Received from order (\S+)$/,
    (m, t) => t('common:systemNotes.receivedFromOrder', { order: m[1] }),
  ],
  [
    /^Supplier payment (.+)$/,
    (m, t) => t('common:systemNotes.supplierPayment', { reference: m[1] }),
  ],
  [/^Launch import (\S+)$/, (m, t) => t('common:systemNotes.launchImport', { id: m[1] })],
  [
    /^Refunded: (.+)$/,
    (m, t) =>
      t('common:systemNotes.refundedReason', {
        reason: t(`sales:refund.reasons.${m[1]}`, { defaultValue: m[1] }),
      }),
  ],
  [/^Voided: (.+)$/, (m, t) => t('common:systemNotes.voidedReason', { reason: m[1] })],
];

function translateSegment(segment: string, t: TFunction): string {
  for (const [pattern, render] of RULES) {
    const match = segment.match(pattern);
    if (match) return render(match, t);
  }
  return segment;
}

/**
 * The server writes stock, cash and document notes in a stable English
 * machine format (older rows included); this renders them in the operator's
 * language. Text an operator typed passes through untouched.
 */
export function formatSystemNote(note: string, t: TFunction): string {
  return note
    .split(' | ')
    .map(segment => translateSegment(segment, t))
    .join(' | ');
}
