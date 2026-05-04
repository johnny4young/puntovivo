-- ENG-053 — Operation journal + outbox kernel.
--
-- Closes the loop opened by ENG-052: every critical mutation now
-- has a destination table for the `operationId` it carries on the
-- envelope. The journal triplet (events/effects/errors) lets us
-- correlate UI click → tRPC procedure → DB transaction → audit
-- row → future fan-out without grepping timestamps. The outbox
-- metadata table is the cross-outbox health surface that ENG-065
-- (Operations Center) renders.
--
-- This migration ships ONLY the journal + the metadata. The five
-- concrete outboxes (sync / fiscal / payment / webhook / hardware)
-- come with their owner tickets (ENG-064 / ENG-057 / ENG-063 /
-- ENG-070 / ENG-060). The kernel at packages/server/src/lib/outbox/
-- is table-agnostic — it accepts any Drizzle table that conforms
-- to the shared shape.

CREATE TABLE IF NOT EXISTS `operation_events` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `operation_id` text NOT NULL,
  `operation_kind` text NOT NULL,
  `device_id` text NOT NULL REFERENCES `devices`(`id`),
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `status` text NOT NULL DEFAULT 'started',
  `request_hash` text NOT NULL,
  `summary` text,
  `started_at` text NOT NULL DEFAULT (datetime('now')),
  `completed_at` text,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_operation_events_tenant_operation`
  ON `operation_events` (`tenant_id`, `operation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operation_events_status`
  ON `operation_events` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operation_events_kind_status`
  ON `operation_events` (`operation_kind`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operation_events_device`
  ON `operation_events` (`device_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operation_events_user`
  ON `operation_events` (`user_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `operation_effects` (
  `id` text PRIMARY KEY NOT NULL,
  `operation_event_id` text NOT NULL REFERENCES `operation_events`(`id`) ON DELETE CASCADE,
  `kind` text NOT NULL,
  `resource_type` text NOT NULL,
  `resource_id` text NOT NULL,
  `effect_data` text,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operation_effects_event`
  ON `operation_effects` (`operation_event_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operation_effects_event_kind`
  ON `operation_effects` (`operation_event_id`, `kind`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operation_effects_resource`
  ON `operation_effects` (`resource_type`, `resource_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `operation_errors` (
  `id` text PRIMARY KEY NOT NULL,
  `operation_event_id` text NOT NULL REFERENCES `operation_events`(`id`) ON DELETE CASCADE,
  `error_code` text NOT NULL,
  `message` text NOT NULL,
  `recoverable` integer NOT NULL DEFAULT 0,
  `error_data` text,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operation_errors_event`
  ON `operation_errors` (`operation_event_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_operation_errors_code`
  ON `operation_errors` (`error_code`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `outbox_metadata` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `outbox_kind` text NOT NULL,
  `pending_count` integer NOT NULL DEFAULT 0,
  `last_success_at` text,
  `last_failure_at` text,
  `oldest_pending_at` text,
  `refreshed_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_outbox_metadata_tenant_kind`
  ON `outbox_metadata` (`tenant_id`, `outbox_kind`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_outbox_metadata_kind_pending`
  ON `outbox_metadata` (`outbox_kind`, `pending_count`);
