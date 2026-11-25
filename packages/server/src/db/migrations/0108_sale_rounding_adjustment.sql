ALTER TABLE `sales` ADD `rounding_adjustment` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_returns` ADD `rounding_adjustment` real DEFAULT 0 NOT NULL;