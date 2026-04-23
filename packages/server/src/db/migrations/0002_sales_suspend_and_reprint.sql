-- ENG-018 + ENG-019 — park-and-resume + receipt reprint columns on `sales`.
--
-- Safe to run on every install because `drizzleMigrate()` always executes
-- before `runSchemaSync()` in `db/index.ts`, so these `ALTER TABLE` calls
-- land on a schema that has only the baseline columns from migration
-- 0000. The follow-up `ensureColumn()` in `runSchemaSync()` is a no-op
-- afterwards (columns already exist).
ALTER TABLE `sales` ADD COLUMN `suspended_at` text;--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `suspended_by` text REFERENCES `users`(`id`);--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `suspended_label` text;--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `reprint_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `last_reprinted_at` text;--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `last_reprinted_by` text REFERENCES `users`(`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_suspended_by` ON `sales` (`suspended_by`);
