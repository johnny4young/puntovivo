ALTER TABLE `sale_item_lots` ADD `total_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `inventory_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `cogs_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `sale_return_item_lots` ADD `total_cost_cents` integer;--> statement-breakpoint
ALTER TABLE `sale_return_items` ADD `inventory_cost_cents` integer;