/**
 * Shared classification helper for payment reconciliation.
 *
 * @module services/payments/reconciliation/helpers
 */

import type { SalePaymentRow } from './types.js';

export function isRailCandidateTender(tender: SalePaymentRow): boolean {
  return tender.method === 'card' || tender.method === 'transfer' || tender.method === 'other';
}
