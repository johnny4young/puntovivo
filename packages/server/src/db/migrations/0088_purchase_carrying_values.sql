ALTER TABLE `purchase_item_lots` ADD `total_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `purchase_items` ADD `inventory_value_cents` integer;--> statement-breakpoint
ALTER TABLE `purchase_items` ADD `cogs_value_cents` integer;--> statement-breakpoint
ALTER TABLE `purchase_return_item_lots` ADD `total_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `purchase_return_items` ADD `inventory_value_cents` integer;--> statement-breakpoint
ALTER TABLE `purchase_return_items` ADD `cogs_value_cents` integer;