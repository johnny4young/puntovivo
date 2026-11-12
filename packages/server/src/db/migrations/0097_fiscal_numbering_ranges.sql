CREATE TABLE IF NOT EXISTS `fiscal_numbering_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`resolution_number` text NOT NULL,
	`prefix` text NOT NULL,
	`from_number` integer NOT NULL,
	`to_number` integer NOT NULL,
	`current_number` integer NOT NULL,
	`technical_key` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_fiscal_numbering_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`resolution_number` text NOT NULL,
	`resolution_date` text,
	`prefix` text NOT NULL,
	`from_number` integer NOT NULL,
	`to_number` integer NOT NULL,
	`current_number` integer NOT NULL,
	`technical_key` text,
	`environment` text DEFAULT 'habilitacion' NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`retired_by` text,
	`retired_at` text,
	`retire_reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_fiscal_numbering_resolutions`("id", "tenant_id", "site_id", "kind", "resolution_number", "resolution_date", "prefix", "from_number", "to_number", "current_number", "technical_key", "environment", "valid_from", "valid_until", "status", "is_active", "created_by", "retired_by", "retired_at", "retire_reason", "created_at", "updated_at")
SELECT r."id", r."tenant_id", r."site_id", r."kind", r."resolution_number", NULL, r."prefix", r."from_number", r."to_number", r."current_number", NULLIF(r."technical_key", ''),
  'habilitacion',
  r."valid_from", r."valid_until",
  CASE
    WHEN r."is_active" = 0 THEN 'retired'
    WHEN ROW_NUMBER() OVER (PARTITION BY r."tenant_id", r."site_id", r."kind" ORDER BY r."is_active" DESC, r."created_at", r."id") = 1 THEN 'active'
    ELSE 'scheduled'
  END,
  0, NULL, NULL, NULL, NULL, r."created_at", r."updated_at"
FROM `fiscal_numbering_resolutions` r;--> statement-breakpoint
UPDATE `__new_fiscal_numbering_resolutions` SET "is_active" = ("status" = 'active');--> statement-breakpoint
DROP TABLE `fiscal_numbering_resolutions`;--> statement-breakpoint
ALTER TABLE `__new_fiscal_numbering_resolutions` RENAME TO `fiscal_numbering_resolutions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_fiscal_resolutions_tenant` ON `fiscal_numbering_resolutions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_resolutions_site_kind` ON `fiscal_numbering_resolutions` (`site_id`,`kind`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_resolutions_one_active` ON `fiscal_numbering_resolutions` (`tenant_id`,`site_id`,`kind`,`environment`) WHERE "fiscal_numbering_resolutions"."status" = 'active';