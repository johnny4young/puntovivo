ALTER TABLE `products` ADD `inventory_value_cents` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `cogs_value_cents` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `valuation_quantity` real;--> statement-breakpoint
ALTER TABLE `products` ADD `valuation_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD `inventory_value_delta_cents` integer;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD `cogs_value_delta_cents` integer;--> statement-breakpoint
ALTER TABLE `inventory_lots` ADD `carrying_value_cents` integer;--> statement-breakpoint
ALTER TABLE `inventory_lots` ADD `valuation_quantity` real;--> statement-breakpoint
ALTER TABLE `inventory_transformation_outputs` ADD `resulting_valuation_version` integer;