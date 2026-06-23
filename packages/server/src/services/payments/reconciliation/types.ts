/**
 * Shared drizzle row aliases for payment reconciliation.
 *
 * @module services/payments/reconciliation/types
 */

import type { paymentOutbox, salePayments } from '../../../db/schema.js';

export type SalePaymentRow = typeof salePayments.$inferSelect;
export type PaymentOutboxRow = typeof paymentOutbox.$inferSelect;
