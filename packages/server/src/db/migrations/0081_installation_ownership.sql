CREATE TABLE `installation_setup` (
	`id` text PRIMARY KEY NOT NULL,
	`completed_at` text,
	`completion_kind` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "installation_setup_singleton" CHECK("installation_setup"."id" = 'local'),
	CONSTRAINT "installation_setup_completion" CHECK(("installation_setup"."completed_at" IS NULL AND "installation_setup"."completion_kind" IS NULL) OR ("installation_setup"."completed_at" IS NOT NULL AND "installation_setup"."completion_kind" IS NOT NULL AND "installation_setup"."completion_kind" IN ('owner_claim', 'adopted')))
);

--> statement-breakpoint
-- Adopt existing ownership without inventing an owner or changing credentials.
-- A new empty database alone begins pending; the marker is never re-created at runtime.
INSERT OR IGNORE INTO installation_setup (id, completed_at, completion_kind)
SELECT 'local',
  CASE WHEN EXISTS (SELECT 1 FROM tenants) OR EXISTS (SELECT 1 FROM users)
    OR EXISTS (SELECT 1 FROM companies) OR EXISTS (SELECT 1 FROM sites)
    THEN datetime('now') ELSE NULL END,
  CASE WHEN EXISTS (SELECT 1 FROM tenants) OR EXISTS (SELECT 1 FROM users)
    OR EXISTS (SELECT 1 FROM companies) OR EXISTS (SELECT 1 FROM sites)
    THEN 'adopted' ELSE NULL END;
