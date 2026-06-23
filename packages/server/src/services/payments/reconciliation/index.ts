/**
 * Payment reconciliation — public barrel.
 *
 * Re-assembles the read report + write-back pass into the original public
 * surface (2 functions + their result/option types) so importers resolve
 * unchanged.
 *
 * @module services/payments/reconciliation
 */

export {
  getPaymentReconciliation,
  type PaymentReconciliationInput,
  type PaymentReconciliationMismatch,
  type PaymentReconciliationRailSummary,
  type PaymentReconciliationResult,
} from './report.js';
export {
  runReconciliationPass,
  type StatementRow,
  type ReconciliationMismatchKind,
  type ReconciliationPassMismatch,
  type RunReconciliationPassResult,
  type RunReconciliationPassOptions,
} from './pass.js';
