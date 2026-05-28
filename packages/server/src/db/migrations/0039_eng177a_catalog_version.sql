-- ENG-177a — optimistic-concurrency `version` column on user-edited catalogs.
--
-- Each row carries a monotonically increasing `version` that the matching
-- tRPC `*.update` procedure bumps on every write. A client that submits a
-- stale version (because another tab already saved) is rejected with
-- `STALE_VERSION` instead of silently overwriting the other operator's edit.
-- Mirrors `users.session_version`; distinct from `sync_version`, which tracks
-- sync-outbox replay (ENG-064), not live-edit concurrency.
--
-- Pure additive columns — no table rebuild. Existing rows backfill to 0, so
-- the first edit of any pre-ENG-177a row simply moves it to version 1.
--
-- `sequentials` is intentionally NOT versioned: it is an atomically
-- incremented operational counter (`current_value + 1`) reached through an
-- upsert, not a two-tab catalog edit surface.

ALTER TABLE `products` ADD COLUMN `version` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `customers` ADD COLUMN `version` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `providers` ADD COLUMN `version` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `categories` ADD COLUMN `version` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `tenant_locale_settings` ADD COLUMN `version` integer NOT NULL DEFAULT 0;
