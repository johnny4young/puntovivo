ALTER TABLE `units` ADD `dimension` text;--> statement-breakpoint
ALTER TABLE `units` ADD `standard_code` text;--> statement-breakpoint
ALTER TABLE `units` ADD `reference_factor` real;--> statement-breakpoint
CREATE INDEX `idx_units_dimension` ON `units` (`dimension`);