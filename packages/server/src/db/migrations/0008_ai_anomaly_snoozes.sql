-- ENG-047 — AI anomaly snooze table.
--
-- ENG-032 ships local-only anomaly detection that recomputes alerts
-- on every refetch from raw transactional data. Once a manager
-- investigates an alert and confirms it is legitimate (e.g. a
-- $5000 refund that was a real high-ticket return signed off by
-- ownership), they need to dismiss it for a chosen window so the
-- detector does not keep surfacing the same flag for the next
-- ~30 days until the underlying event ages out.
--
-- The snooze is keyed by (kind, cashier_id, evidence_ref) so a
-- single high-ticket-refund silenced today does not also silence
-- a different high-ticket refund next week. evidence_ref is
-- nullable because some detectors (voidRate, noSaleSessions) emit
-- aggregate alerts that have no specific entity to point to —
-- those snooze on (kind, cashier_id) with evidence_ref = NULL.
--
-- snoozed_until is an ISO timestamp; the filter in
-- `services/ai/anomalyDetection.ts::detectAnomalies` skips any
-- candidate alert whose (kind, cashier_id, evidence_ref) matches
-- a row with snoozed_until > now. Expired snoozes can be left in
-- place (cheap) or pruned via a future cron — captured in BACKLOG.

CREATE TABLE IF NOT EXISTS `ai_anomaly_snoozes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`cashier_id` text,
	`evidence_ref` text,
	`snoozed_until` text NOT NULL,
	`snoozed_by` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cashier_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snoozed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_anomaly_snoozes_tenant_until` ON `ai_anomaly_snoozes` (`tenant_id`,`snoozed_until`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_anomaly_snoozes_lookup` ON `ai_anomaly_snoozes` (`tenant_id`,`kind`,`cashier_id`,`evidence_ref`,`snoozed_until`);
