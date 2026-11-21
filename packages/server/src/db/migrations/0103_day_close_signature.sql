ALTER TABLE `day_close_signoffs` ADD `signature_method` text DEFAULT 'session' NOT NULL;--> statement-breakpoint
ALTER TABLE `day_close_signoffs` ADD `signature_path` text;