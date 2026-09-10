CREATE TABLE `employee_shift_swap_claims` (
	`tenant_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`request_id` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `shift_id`),
	FOREIGN KEY (`shift_id`) REFERENCES `scheduled_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`request_id`) REFERENCES `employee_shift_swaps`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_shift_swap_claims_request` ON `employee_shift_swap_claims` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `employee_shift_swap_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`reason` text,
	`snapshot_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`request_id`) REFERENCES `employee_shift_swaps`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_shift_swap_event_snapshot" CHECK(json_valid("employee_shift_swap_events"."snapshot_json")),
	CONSTRAINT "chk_shift_swap_event_reason" CHECK(("employee_shift_swap_events"."status" IN ('accepted','approved') AND "employee_shift_swap_events"."reason" IS NULL) OR ("employee_shift_swap_events"."status" IN ('requested','rejected','cancelled') AND "employee_shift_swap_events"."reason" IS NOT NULL AND length(trim("employee_shift_swap_events"."reason")) BETWEEN 10 AND 500))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shift_swap_events_version` ON `employee_shift_swap_events` (`tenant_id`,`request_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_shift_swap_events_operation` ON `employee_shift_swap_events` (`tenant_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `employee_shift_swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`offered_shift_id` text NOT NULL,
	`requested_shift_id` text NOT NULL,
	`intent_json` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`offered_replacement_id` text,
	`requested_replacement_id` text,
	`updated_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offered_shift_id`) REFERENCES `scheduled_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_shift_id`) REFERENCES `scheduled_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offered_replacement_id`) REFERENCES `scheduled_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_replacement_id`) REFERENCES `scheduled_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_shift_swap_distinct" CHECK("employee_shift_swaps"."requester_id"!="employee_shift_swaps"."recipient_id" AND "employee_shift_swaps"."offered_shift_id"!="employee_shift_swaps"."requested_shift_id"),
	CONSTRAINT "chk_shift_swap_version" CHECK(typeof("employee_shift_swaps"."version")='integer' AND "employee_shift_swaps"."version" BETWEEN 1 AND 9007199254740990),
	CONSTRAINT "chk_shift_swap_status" CHECK("employee_shift_swaps"."status" IN ('requested','accepted','approved','rejected','cancelled')),
	CONSTRAINT "chk_shift_swap_intent" CHECK(json_valid("employee_shift_swaps"."intent_json") AND length("employee_shift_swaps"."intent_json")<=10000),
	CONSTRAINT "chk_shift_swap_replacements" CHECK(("employee_shift_swaps"."status"='approved' AND "employee_shift_swaps"."offered_replacement_id" IS NOT NULL AND "employee_shift_swaps"."requested_replacement_id" IS NOT NULL AND "employee_shift_swaps"."offered_replacement_id"!="employee_shift_swaps"."requested_replacement_id") OR ("employee_shift_swaps"."status"!='approved' AND "employee_shift_swaps"."offered_replacement_id" IS NULL AND "employee_shift_swaps"."requested_replacement_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shift_swaps_tenant_id` ON `employee_shift_swaps` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_shift_swaps_requester_created` ON `employee_shift_swaps` (`tenant_id`,`requester_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_shift_swaps_recipient_created` ON `employee_shift_swaps` (`tenant_id`,`recipient_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_shift_swaps_status_created` ON `employee_shift_swaps` (`tenant_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_shift_swaps_offered` ON `employee_shift_swaps` (`tenant_id`,`offered_shift_id`);--> statement-breakpoint
CREATE INDEX `idx_shift_swaps_requested` ON `employee_shift_swaps` (`tenant_id`,`requested_shift_id`);
--> statement-breakpoint
-- Drizzle cannot express aggregate consent, scope and immutable lineage triggers.
CREATE TRIGGER IF NOT EXISTS shift_swaps_insert_guard BEFORE INSERT ON employee_shift_swaps BEGIN
  SELECT RAISE(ABORT,'SHIFT_SWAP_STATE_INVALID') WHERE NEW.status!='requested' OR NEW.version!=1 OR NEW.updated_by_user_id!=NEW.requester_id;
  SELECT RAISE(ABORT,'SHIFT_SWAP_SCOPE_INVALID') WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.requester_id AND tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.recipient_id AND tenant_id=NEW.tenant_id);
  SELECT RAISE(ABORT,'SHIFT_SWAP_INTENT_INVALID') WHERE NOT EXISTS(SELECT 1 FROM scheduled_shifts s WHERE s.id=NEW.offered_shift_id AND s.tenant_id=NEW.tenant_id AND s.user_id=NEW.requester_id AND s.status='scheduled' AND json_extract(NEW.intent_json,'$.offered.id') IS s.id AND json_extract(NEW.intent_json,'$.offered.userId') IS s.user_id AND json_extract(NEW.intent_json,'$.offered.siteId') IS s.site_id AND json_extract(NEW.intent_json,'$.offered.startsAt') IS s.starts_at AND json_extract(NEW.intent_json,'$.offered.endsAt') IS s.ends_at AND json_extract(NEW.intent_json,'$.offered.timeZone') IS s.time_zone AND json_extract(NEW.intent_json,'$.offered.version') IS s.version AND length(json_extract(NEW.intent_json,'$.offered.fingerprint'))=64);
  SELECT RAISE(ABORT,'SHIFT_SWAP_INTENT_INVALID') WHERE NOT EXISTS(SELECT 1 FROM scheduled_shifts s WHERE s.id=NEW.requested_shift_id AND s.tenant_id=NEW.tenant_id AND s.user_id=NEW.recipient_id AND s.status='scheduled' AND json_extract(NEW.intent_json,'$.requested.id') IS s.id AND json_extract(NEW.intent_json,'$.requested.userId') IS s.user_id AND json_extract(NEW.intent_json,'$.requested.siteId') IS s.site_id AND json_extract(NEW.intent_json,'$.requested.startsAt') IS s.starts_at AND json_extract(NEW.intent_json,'$.requested.endsAt') IS s.ends_at AND json_extract(NEW.intent_json,'$.requested.timeZone') IS s.time_zone AND json_extract(NEW.intent_json,'$.requested.version') IS s.version AND length(json_extract(NEW.intent_json,'$.requested.fingerprint'))=64);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS shift_swaps_update_guard BEFORE UPDATE ON employee_shift_swaps BEGIN
  SELECT RAISE(ABORT,'SHIFT_SWAP_IMMUTABLE') WHERE OLD.status NOT IN ('requested','accepted') OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.requester_id IS NOT OLD.requester_id OR NEW.recipient_id IS NOT OLD.recipient_id OR NEW.offered_shift_id IS NOT OLD.offered_shift_id OR NEW.requested_shift_id IS NOT OLD.requested_shift_id OR NEW.intent_json IS NOT OLD.intent_json OR NEW.created_at IS NOT OLD.created_at;
  SELECT RAISE(ABORT,'SHIFT_SWAP_STATE_INVALID') WHERE NEW.version!=OLD.version+1 OR NOT ((OLD.status='requested' AND NEW.status IN ('accepted','rejected','cancelled')) OR (OLD.status='accepted' AND NEW.status IN ('approved','rejected','cancelled')));
  SELECT RAISE(ABORT,'SHIFT_SWAP_SCOPE_INVALID') WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.updated_by_user_id AND tenant_id=NEW.tenant_id);
  SELECT RAISE(ABORT,'SHIFT_SWAP_CONSENT_INVALID') WHERE (NEW.status='accepted' AND NEW.updated_by_user_id!=NEW.recipient_id) OR (NEW.status='cancelled' AND NOT (NEW.updated_by_user_id=NEW.requester_id OR (OLD.status='accepted' AND NEW.updated_by_user_id=NEW.recipient_id)));
  SELECT RAISE(ABORT,'SHIFT_SWAP_APPROVER_INVALID') WHERE NEW.status='approved' AND (NEW.updated_by_user_id IN (NEW.requester_id,NEW.recipient_id) OR NOT EXISTS(SELECT 1 FROM users u WHERE u.tenant_id=NEW.tenant_id AND u.id=NEW.updated_by_user_id AND u.is_active=1 AND (u.role='admin' OR (u.role='manager' AND NOT EXISTS(SELECT 1 FROM users p WHERE p.tenant_id=NEW.tenant_id AND p.id IN (NEW.requester_id,NEW.recipient_id) AND p.role='admin')))));
  SELECT RAISE(ABORT,'SHIFT_SWAP_CLAIMS_INVALID') WHERE NEW.status IN ('accepted','approved') AND (SELECT count(*) FROM employee_shift_swap_claims WHERE tenant_id=NEW.tenant_id AND request_id=NEW.id)!=2;
  SELECT RAISE(ABORT,'SHIFT_SWAP_LINEAGE_INVALID') WHERE NEW.status='approved' AND NOT EXISTS(SELECT 1 FROM scheduled_shifts original JOIN scheduled_shifts replacement ON replacement.id=NEW.offered_replacement_id AND replacement.tenant_id=NEW.tenant_id WHERE original.id=NEW.offered_shift_id AND original.tenant_id=NEW.tenant_id AND original.status='cancelled' AND original.version=json_extract(NEW.intent_json,'$.offered.version')+1 AND original.cancelled_by_user_id=NEW.updated_by_user_id AND replacement.user_id=NEW.recipient_id AND replacement.site_id=original.site_id AND replacement.starts_at=original.starts_at AND replacement.ends_at=original.ends_at AND replacement.time_zone=original.time_zone AND replacement.notes IS original.notes AND replacement.status='scheduled' AND replacement.version=1 AND replacement.created_by_user_id=NEW.updated_by_user_id);
  SELECT RAISE(ABORT,'SHIFT_SWAP_LINEAGE_INVALID') WHERE NEW.status='approved' AND NOT EXISTS(SELECT 1 FROM scheduled_shifts original JOIN scheduled_shifts replacement ON replacement.id=NEW.requested_replacement_id AND replacement.tenant_id=NEW.tenant_id WHERE original.id=NEW.requested_shift_id AND original.tenant_id=NEW.tenant_id AND original.status='cancelled' AND original.version=json_extract(NEW.intent_json,'$.requested.version')+1 AND original.cancelled_by_user_id=NEW.updated_by_user_id AND replacement.user_id=NEW.requester_id AND replacement.site_id=original.site_id AND replacement.starts_at=original.starts_at AND replacement.ends_at=original.ends_at AND replacement.time_zone=original.time_zone AND replacement.notes IS original.notes AND replacement.status='scheduled' AND replacement.version=1 AND replacement.created_by_user_id=NEW.updated_by_user_id);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS shift_swaps_no_delete BEFORE DELETE ON employee_shift_swaps BEGIN SELECT RAISE(ABORT,'SHIFT_SWAP_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS shift_swap_claims_insert_guard BEFORE INSERT ON employee_shift_swap_claims BEGIN
  SELECT RAISE(ABORT,'SHIFT_SWAP_CLAIMS_INVALID') WHERE NOT EXISTS(SELECT 1 FROM employee_shift_swaps r JOIN scheduled_shifts s ON s.id=NEW.shift_id AND s.tenant_id=NEW.tenant_id WHERE r.id=NEW.request_id AND r.tenant_id=NEW.tenant_id AND r.status IN ('requested','accepted') AND NEW.shift_id IN (r.offered_shift_id,r.requested_shift_id));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS shift_swap_claims_no_update BEFORE UPDATE ON employee_shift_swap_claims BEGIN SELECT RAISE(ABORT,'SHIFT_SWAP_CLAIMS_INVALID'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS shift_swap_claims_delete_guard BEFORE DELETE ON employee_shift_swap_claims WHEN EXISTS(SELECT 1 FROM employee_shift_swaps WHERE id=OLD.request_id AND tenant_id=OLD.tenant_id AND status IN ('requested','accepted')) BEGIN SELECT RAISE(ABORT,'SHIFT_SWAP_CLAIMS_INVALID'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS shift_swap_events_insert_guard BEFORE INSERT ON employee_shift_swap_events BEGIN
  SELECT RAISE(ABORT,'SHIFT_SWAP_EVENT_INVALID') WHERE NOT EXISTS(SELECT 1 FROM employee_shift_swaps r JOIN users u ON u.id=NEW.actor_id AND u.tenant_id=NEW.tenant_id WHERE r.id=NEW.request_id AND r.tenant_id=NEW.tenant_id AND r.version=NEW.version AND r.status=NEW.status AND r.updated_by_user_id=NEW.actor_id AND json_extract(NEW.snapshot_json,'$.id') IS r.id AND json_extract(NEW.snapshot_json,'$.tenantId') IS r.tenant_id AND json_extract(NEW.snapshot_json,'$.version') IS r.version AND json_extract(NEW.snapshot_json,'$.status') IS r.status AND json_extract(NEW.snapshot_json,'$.intent') IS json(r.intent_json) AND json_extract(NEW.snapshot_json,'$.offeredReplacementId') IS r.offered_replacement_id AND json_extract(NEW.snapshot_json,'$.requestedReplacementId') IS r.requested_replacement_id);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS shift_swap_events_no_update BEFORE UPDATE ON employee_shift_swap_events BEGIN SELECT RAISE(ABORT,'SHIFT_SWAP_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS shift_swap_events_no_delete BEFORE DELETE ON employee_shift_swap_events BEGIN SELECT RAISE(ABORT,'SHIFT_SWAP_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
-- Operational replacements can themselves be exchanged later; only replaced originals are frozen.
CREATE TRIGGER IF NOT EXISTS scheduled_shifts_swap_history_update_guard BEFORE UPDATE ON scheduled_shifts WHEN EXISTS(SELECT 1 FROM employee_shift_swaps WHERE tenant_id=OLD.tenant_id AND status='approved' AND OLD.id IN (offered_shift_id,requested_shift_id)) BEGIN SELECT RAISE(ABORT,'SHIFT_SWAP_HISTORY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS scheduled_shifts_swap_history_delete_guard BEFORE DELETE ON scheduled_shifts WHEN EXISTS(SELECT 1 FROM employee_shift_swaps WHERE tenant_id=OLD.tenant_id AND status='approved' AND OLD.id IN (offered_shift_id,requested_shift_id)) BEGIN SELECT RAISE(ABORT,'SHIFT_SWAP_HISTORY_IMMUTABLE'); END;
