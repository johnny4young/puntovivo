ALTER TABLE `inventory_count_lines` ADD `expected_valuation_version` integer;--> statement-breakpoint
ALTER TABLE `inventory_count_lines` ADD `expected_valuation_quantity` real;--> statement-breakpoint
ALTER TABLE `inventory_count_lines` ADD `expected_inventory_value_cents` integer;--> statement-breakpoint
ALTER TABLE `inventory_count_lines` ADD `expected_cogs_value_cents` integer;--> statement-breakpoint
ALTER TABLE `inventory_count_lines` ADD `cogs_unit_cost_snapshot` real;