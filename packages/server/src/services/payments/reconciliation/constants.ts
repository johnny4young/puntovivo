/**
 * Shared tuning constants for payment reconciliation (read report + pass).
 *
 * @module services/payments/reconciliation/constants
 */

import type { PaymentOutboxStatus } from '../../../db/schema.js';

export const RECONCILIATION_WINDOW_DAYS = 30;
export const AMOUNT_EPSILON = 0.009;
export const TIEBREAK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export const PROVIDER_ISSUE_STATUSES = new Set<PaymentOutboxStatus>([
  'declined',
  'timeout',
  'retrying',
  'dead_letter',
]);
