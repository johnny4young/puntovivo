/**
 * AI Anomalies feature barrel — added 2026-05-15 per AI Núcleo handoff §3.
 *
 * The implementation still lives in `features/dashboard/` because that's
 * where the original AnomalyDetectionCard shipped and where the
 * dashboard imports it. This barrel exposes the handoff-canonical names
 * (`AnomaliesCard`, `AnomaliesDialog`) so new callers can import from
 * the conceptual folder without moving the source files (which would
 * churn git history for zero behavior change).
 */
export { AnomalyDetectionCard as AnomaliesCard } from '../dashboard/AnomalyDetectionCard';
export { AnomalyDetailsModal as AnomaliesDialog } from '../dashboard/AnomalyDetailsModal';
export type { AnomalyAlertView } from '../dashboard/AnomalyDetailsModal';
