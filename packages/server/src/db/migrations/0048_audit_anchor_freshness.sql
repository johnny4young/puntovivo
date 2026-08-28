ALTER TABLE `audit_chain_heads` ADD `anchor_counter` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_chain_heads` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_chain_heads` ADD `adopted_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;--> statement-breakpoint
UPDATE `audit_chain_heads` SET `adopted_at` = `updated_at`;
