ALTER TABLE `customers` ADD `privacy_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `privacy_disposed_at` text;