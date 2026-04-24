-- ENG-018 + ENG-019 — park-and-resume + receipt reprint columns on `sales`.
--
-- Safe to run on every install because `drizzleMigrate()` is the
-- single schema path in `db/index.ts` (the legacy raw-DDL mirror was
-- retired in ENG-002 Step 3). These `ALTER TABLE` calls land on a
-- schema that has only the baseline columns from migration 0000.
-- Adopted DBs whose journal was pinned by the adoption shim skip this
-- migration entirely — the columns are already present from the
-- retired bootstrap.
ALTER TABLE `sales` ADD COLUMN `suspended_at` text;--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `suspended_by` text REFERENCES `users`(`id`);--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `suspended_label` text;--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `reprint_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `last_reprinted_at` text;--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `last_reprinted_by` text REFERENCES `users`(`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_suspended_by` ON `sales` (`suspended_by`);
