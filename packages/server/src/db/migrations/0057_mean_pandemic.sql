CREATE TABLE `purchase_item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_item_id` text NOT NULL,
	`inventory_lot_id` text NOT NULL,
	`lot_number_snapshot` text NOT NULL,
	`expires_at_snapshot` text,
	`base_quantity` real NOT NULL,
	`unit_cost` real NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_item_id`) REFERENCES `purchase_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inventory_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchase_item_lots_quantity_positive" CHECK("purchase_item_lots"."base_quantity" > 0),
	CONSTRAINT "chk_purchase_item_lots_unit_cost_nonneg" CHECK("purchase_item_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_purchase_item_lots_unit_cost_2dec" CHECK(round("purchase_item_lots"."unit_cost", 2) = "purchase_item_lots"."unit_cost")
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_item_lots_tenant` ON `purchase_item_lots` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_item_lots_item` ON `purchase_item_lots` (`purchase_item_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_item_lots_lot` ON `purchase_item_lots` (`inventory_lot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_item_lots_item_lot` ON `purchase_item_lots` (`purchase_item_id`,`inventory_lot_id`);--> statement-breakpoint
CREATE TABLE `purchase_return_item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_return_item_id` text NOT NULL,
	`purchase_item_lot_id` text NOT NULL,
	`inventory_lot_id` text NOT NULL,
	`base_quantity` real NOT NULL,
	`unit_cost` real NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_return_item_id`) REFERENCES `purchase_return_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_item_lot_id`) REFERENCES `purchase_item_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchase_return_item_lots_quantity_positive" CHECK("purchase_return_item_lots"."base_quantity" > 0),
	CONSTRAINT "chk_purchase_return_item_lots_unit_cost_nonneg" CHECK("purchase_return_item_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_purchase_return_item_lots_unit_cost_2dec" CHECK(round("purchase_return_item_lots"."unit_cost", 2) = "purchase_return_item_lots"."unit_cost")
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_return_item_lots_tenant` ON `purchase_return_item_lots` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_return_item_lots_return_item` ON `purchase_return_item_lots` (`purchase_return_item_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_return_item_lots_purchase_lot` ON `purchase_return_item_lots` (`purchase_item_lot_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_return_item_lots_inventory_lot` ON `purchase_return_item_lots` (`inventory_lot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_return_item_lots_scope` ON `purchase_return_item_lots` (`purchase_return_item_id`,`purchase_item_lot_id`);--> statement-breakpoint
CREATE TABLE `transfer_order_item_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`transfer_order_item_id` text NOT NULL,
	`source_lot_id` text NOT NULL,
	`destination_lot_id` text,
	`lot_number_snapshot` text NOT NULL,
	`expires_at_snapshot` text,
	`source_status_snapshot` text NOT NULL,
	`quantity` real NOT NULL,
	`received_quantity` real,
	`unit_cost` real NOT NULL,
	`destination_lot_was_created` integer,
	`destination_previous_on_hand` real,
	`destination_previous_unit_cost` real,
	`destination_previous_status` text,
	`destination_resulting_on_hand` real,
	`destination_resulting_unit_cost` real,
	`destination_resulting_status` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_order_item_id`) REFERENCES `transfer_order_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_transfer_order_item_lots_quantity_positive" CHECK("transfer_order_item_lots"."quantity" > 0),
	CONSTRAINT "chk_transfer_order_item_lots_received_range" CHECK("transfer_order_item_lots"."received_quantity" IS NULL OR ("transfer_order_item_lots"."received_quantity" >= 0 AND "transfer_order_item_lots"."received_quantity" <= "transfer_order_item_lots"."quantity")),
	CONSTRAINT "chk_transfer_order_item_lots_destination_snapshot" CHECK(("transfer_order_item_lots"."received_quantity" IS NULL AND "transfer_order_item_lots"."destination_lot_id" IS NULL AND "transfer_order_item_lots"."destination_lot_was_created" IS NULL AND "transfer_order_item_lots"."destination_previous_on_hand" IS NULL AND "transfer_order_item_lots"."destination_previous_unit_cost" IS NULL AND "transfer_order_item_lots"."destination_previous_status" IS NULL AND "transfer_order_item_lots"."destination_resulting_on_hand" IS NULL AND "transfer_order_item_lots"."destination_resulting_unit_cost" IS NULL AND "transfer_order_item_lots"."destination_resulting_status" IS NULL) OR ("transfer_order_item_lots"."received_quantity" = 0 AND "transfer_order_item_lots"."destination_lot_id" IS NULL AND "transfer_order_item_lots"."destination_lot_was_created" IS NULL AND "transfer_order_item_lots"."destination_previous_on_hand" IS NULL AND "transfer_order_item_lots"."destination_previous_unit_cost" IS NULL AND "transfer_order_item_lots"."destination_previous_status" IS NULL AND "transfer_order_item_lots"."destination_resulting_on_hand" IS NULL AND "transfer_order_item_lots"."destination_resulting_unit_cost" IS NULL AND "transfer_order_item_lots"."destination_resulting_status" IS NULL) OR ("transfer_order_item_lots"."received_quantity" > 0 AND "transfer_order_item_lots"."destination_lot_id" IS NOT NULL AND "transfer_order_item_lots"."destination_lot_was_created" IS NOT NULL AND "transfer_order_item_lots"."destination_resulting_on_hand" IS NOT NULL AND "transfer_order_item_lots"."destination_resulting_unit_cost" IS NOT NULL AND "transfer_order_item_lots"."destination_resulting_status" IS NOT NULL AND (("transfer_order_item_lots"."destination_lot_was_created" = 1 AND "transfer_order_item_lots"."destination_previous_on_hand" IS NULL AND "transfer_order_item_lots"."destination_previous_unit_cost" IS NULL AND "transfer_order_item_lots"."destination_previous_status" IS NULL) OR ("transfer_order_item_lots"."destination_lot_was_created" = 0 AND "transfer_order_item_lots"."destination_previous_on_hand" IS NOT NULL AND "transfer_order_item_lots"."destination_previous_unit_cost" IS NOT NULL AND "transfer_order_item_lots"."destination_previous_status" IS NOT NULL)))),
	CONSTRAINT "chk_transfer_order_item_lots_unit_cost_nonneg" CHECK("transfer_order_item_lots"."unit_cost" >= 0),
	CONSTRAINT "chk_transfer_order_item_lots_unit_cost_2dec" CHECK(round("transfer_order_item_lots"."unit_cost", 2) = "transfer_order_item_lots"."unit_cost"),
	CONSTRAINT "chk_transfer_order_item_lots_destination_previous_on_hand_nonnegative" CHECK("transfer_order_item_lots"."destination_previous_on_hand" IS NULL OR "transfer_order_item_lots"."destination_previous_on_hand" >= 0),
	CONSTRAINT "chk_transfer_order_item_lots_destination_resulting_on_hand_nonnegative" CHECK("transfer_order_item_lots"."destination_resulting_on_hand" IS NULL OR "transfer_order_item_lots"."destination_resulting_on_hand" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_transfer_order_item_lots_tenant` ON `transfer_order_item_lots` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_order_item_lots_item` ON `transfer_order_item_lots` (`transfer_order_item_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_order_item_lots_source` ON `transfer_order_item_lots` (`source_lot_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_order_item_lots_destination` ON `transfer_order_item_lots` (`destination_lot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transfer_order_item_lots_item_source` ON `transfer_order_item_lots` (`transfer_order_item_id`,`source_lot_id`);--> statement-breakpoint
CREATE TABLE `inventory_transformation_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`transformation_id` text NOT NULL,
	`recipe_input_id` text,
	`product_id` text NOT NULL,
	`lot_id` text,
	`lot_number_snapshot` text,
	`expires_at_snapshot` text,
	`source_status_snapshot` text,
	`base_quantity` real NOT NULL,
	`unit_cost` real NOT NULL,
	`total_cost` real NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transformation_id`) REFERENCES `inventory_transformations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_input_id`) REFERENCES `inventory_transformation_recipe_inputs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_inventory_transformation_inputs_lot_snapshot" CHECK(("inventory_transformation_inputs"."lot_id" IS NULL AND "inventory_transformation_inputs"."lot_number_snapshot" IS NULL AND "inventory_transformation_inputs"."expires_at_snapshot" IS NULL AND "inventory_transformation_inputs"."source_status_snapshot" IS NULL) OR ("inventory_transformation_inputs"."lot_id" IS NOT NULL AND "inventory_transformation_inputs"."lot_number_snapshot" IS NOT NULL AND "inventory_transformation_inputs"."source_status_snapshot" IS NOT NULL)),
	CONSTRAINT "chk_inventory_transformation_inputs_quantity_positive" CHECK("inventory_transformation_inputs"."base_quantity" > 0),
	CONSTRAINT "chk_inventory_transformation_inputs_unit_cost_nonneg" CHECK("inventory_transformation_inputs"."unit_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_inputs_unit_cost_2dec" CHECK(round("inventory_transformation_inputs"."unit_cost", 2) = "inventory_transformation_inputs"."unit_cost"),
	CONSTRAINT "chk_inventory_transformation_inputs_total_cost_nonneg" CHECK("inventory_transformation_inputs"."total_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_inputs_total_cost_2dec" CHECK(round("inventory_transformation_inputs"."total_cost", 2) = "inventory_transformation_inputs"."total_cost")
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_inputs_tenant` ON `inventory_transformation_inputs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_inputs_transformation` ON `inventory_transformation_inputs` (`transformation_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_inputs_product` ON `inventory_transformation_inputs` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_inputs_lot` ON `inventory_transformation_inputs` (`lot_id`);--> statement-breakpoint
CREATE TABLE `inventory_transformation_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`transformation_id` text NOT NULL,
	`recipe_output_id` text,
	`product_id` text NOT NULL,
	`lot_id` text,
	`lot_number_snapshot` text,
	`expires_at_snapshot` text,
	`role` text NOT NULL,
	`base_quantity` real NOT NULL,
	`allocation_weight` real NOT NULL,
	`allocated_cost` real NOT NULL,
	`unit_cost` real NOT NULL,
	`previous_product_cost` real NOT NULL,
	`previous_product_initial_cost` real NOT NULL,
	`resulting_product_cost` real NOT NULL,
	`resulting_product_initial_cost` real NOT NULL,
	`resulting_product_sync_version` integer NOT NULL,
	`resulting_balance_version` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transformation_id`) REFERENCES `inventory_transformations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_output_id`) REFERENCES `inventory_transformation_recipe_outputs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_inventory_transformation_outputs_lot_snapshot" CHECK(("inventory_transformation_outputs"."lot_id" IS NULL AND "inventory_transformation_outputs"."lot_number_snapshot" IS NULL AND "inventory_transformation_outputs"."expires_at_snapshot" IS NULL) OR ("inventory_transformation_outputs"."lot_id" IS NOT NULL AND "inventory_transformation_outputs"."lot_number_snapshot" IS NOT NULL)),
	CONSTRAINT "chk_inventory_transformation_outputs_quantity_positive" CHECK("inventory_transformation_outputs"."base_quantity" > 0),
	CONSTRAINT "chk_inventory_transformation_outputs_weight_positive" CHECK("inventory_transformation_outputs"."allocation_weight" > 0),
	CONSTRAINT "chk_inventory_transformation_outputs_allocated_cost_nonneg" CHECK("inventory_transformation_outputs"."allocated_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_allocated_cost_2dec" CHECK(round("inventory_transformation_outputs"."allocated_cost", 2) = "inventory_transformation_outputs"."allocated_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_unit_cost_nonneg" CHECK("inventory_transformation_outputs"."unit_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_unit_cost_2dec" CHECK(round("inventory_transformation_outputs"."unit_cost", 2) = "inventory_transformation_outputs"."unit_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_previous_cost_nonneg" CHECK("inventory_transformation_outputs"."previous_product_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_previous_cost_2dec" CHECK(round("inventory_transformation_outputs"."previous_product_cost", 2) = "inventory_transformation_outputs"."previous_product_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_previous_initial_cost_nonneg" CHECK("inventory_transformation_outputs"."previous_product_initial_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_previous_initial_cost_2dec" CHECK(round("inventory_transformation_outputs"."previous_product_initial_cost", 2) = "inventory_transformation_outputs"."previous_product_initial_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_resulting_cost_nonneg" CHECK("inventory_transformation_outputs"."resulting_product_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_resulting_cost_2dec" CHECK(round("inventory_transformation_outputs"."resulting_product_cost", 2) = "inventory_transformation_outputs"."resulting_product_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_resulting_initial_cost_nonneg" CHECK("inventory_transformation_outputs"."resulting_product_initial_cost" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_resulting_initial_cost_2dec" CHECK(round("inventory_transformation_outputs"."resulting_product_initial_cost", 2) = "inventory_transformation_outputs"."resulting_product_initial_cost"),
	CONSTRAINT "chk_inventory_transformation_outputs_product_version_nonnegative" CHECK("inventory_transformation_outputs"."resulting_product_sync_version" >= 0),
	CONSTRAINT "chk_inventory_transformation_outputs_balance_version_nonnegative" CHECK("inventory_transformation_outputs"."resulting_balance_version" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_outputs_tenant` ON `inventory_transformation_outputs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_outputs_transformation` ON `inventory_transformation_outputs` (`transformation_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_outputs_product` ON `inventory_transformation_outputs` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_outputs_lot` ON `inventory_transformation_outputs` (`lot_id`);--> statement-breakpoint
CREATE TABLE `inventory_transformation_recipe_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`product_id` text NOT NULL,
	`base_quantity` real NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `inventory_transformation_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_inventory_transformation_recipe_inputs_quantity_positive" CHECK("inventory_transformation_recipe_inputs"."base_quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_recipe_inputs_tenant` ON `inventory_transformation_recipe_inputs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_recipe_inputs_recipe` ON `inventory_transformation_recipe_inputs` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_recipe_inputs_product` ON `inventory_transformation_recipe_inputs` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_transformation_recipe_inputs_position` ON `inventory_transformation_recipe_inputs` (`recipe_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_transformation_recipe_inputs_recipe_product` ON `inventory_transformation_recipe_inputs` (`recipe_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `inventory_transformation_recipe_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`product_id` text NOT NULL,
	`expected_base_quantity` real NOT NULL,
	`allocation_weight` real NOT NULL,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `inventory_transformation_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_inventory_transformation_recipe_outputs_quantity_positive" CHECK("inventory_transformation_recipe_outputs"."expected_base_quantity" > 0),
	CONSTRAINT "chk_inventory_transformation_recipe_outputs_weight_positive" CHECK("inventory_transformation_recipe_outputs"."allocation_weight" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_recipe_outputs_tenant` ON `inventory_transformation_recipe_outputs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_recipe_outputs_recipe` ON `inventory_transformation_recipe_outputs` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_recipe_outputs_product` ON `inventory_transformation_recipe_outputs` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_transformation_recipe_outputs_position` ON `inventory_transformation_recipe_outputs` (`recipe_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_transformation_recipe_outputs_recipe_product` ON `inventory_transformation_recipe_outputs` (`recipe_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `inventory_transformation_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_recipes_tenant` ON `inventory_transformation_recipes` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_recipes_site` ON `inventory_transformation_recipes` (`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_transformation_recipes_global_name` ON `inventory_transformation_recipes` (`tenant_id`,`name`) WHERE "inventory_transformation_recipes"."site_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_transformation_recipes_site_name` ON `inventory_transformation_recipes` (`tenant_id`,`site_id`,`name`) WHERE "inventory_transformation_recipes"."site_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `inventory_transformation_waste` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`transformation_id` text NOT NULL,
	`transformation_input_id` text NOT NULL,
	`base_quantity` real NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transformation_id`) REFERENCES `inventory_transformations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transformation_input_id`) REFERENCES `inventory_transformation_inputs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_inventory_transformation_waste_quantity_positive" CHECK("inventory_transformation_waste"."base_quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_waste_tenant` ON `inventory_transformation_waste` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_waste_transformation` ON `inventory_transformation_waste` (`transformation_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformation_waste_input` ON `inventory_transformation_waste` (`transformation_input_id`);--> statement-breakpoint
CREATE TABLE `inventory_transformations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`recipe_id` text,
	`recipe_name_snapshot` text NOT NULL,
	`kind_snapshot` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`total_input_cost` real NOT NULL,
	`total_output_cost` real NOT NULL,
	`notes` text,
	`executed_by` text NOT NULL,
	`voided_by` text,
	`voided_at` text,
	`void_reason` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `inventory_transformation_recipes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`executed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_inventory_transformations_cost_conservation" CHECK("inventory_transformations"."total_input_cost" = "inventory_transformations"."total_output_cost"),
	CONSTRAINT "chk_inventory_transformations_void_state" CHECK(("inventory_transformations"."status" = 'completed' AND "inventory_transformations"."voided_by" IS NULL AND "inventory_transformations"."voided_at" IS NULL AND "inventory_transformations"."void_reason" IS NULL) OR ("inventory_transformations"."status" = 'voided' AND "inventory_transformations"."voided_by" IS NOT NULL AND "inventory_transformations"."voided_at" IS NOT NULL AND "inventory_transformations"."void_reason" IS NOT NULL)),
	CONSTRAINT "chk_inventory_transformations_input_cost_nonneg" CHECK("inventory_transformations"."total_input_cost" >= 0),
	CONSTRAINT "chk_inventory_transformations_input_cost_2dec" CHECK(round("inventory_transformations"."total_input_cost", 2) = "inventory_transformations"."total_input_cost"),
	CONSTRAINT "chk_inventory_transformations_output_cost_nonneg" CHECK("inventory_transformations"."total_output_cost" >= 0),
	CONSTRAINT "chk_inventory_transformations_output_cost_2dec" CHECK(round("inventory_transformations"."total_output_cost", 2) = "inventory_transformations"."total_output_cost")
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_transformations_tenant_created` ON `inventory_transformations` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformations_site_created` ON `inventory_transformations` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_transformations_recipe` ON `inventory_transformations` (`recipe_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transfer_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real NOT NULL,
	`received_quantity` real,
	`destination_resulting_balance_version` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`transfer_order_id`) REFERENCES `transfer_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_transfer_order_items_destination_version_nonnegative" CHECK("__new_transfer_order_items"."destination_resulting_balance_version" IS NULL OR "__new_transfer_order_items"."destination_resulting_balance_version" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_transfer_order_items`("id", "transfer_order_id", "product_id", "quantity", "received_quantity", "destination_resulting_balance_version", "created_at") SELECT "id", "transfer_order_id", "product_id", "quantity", "received_quantity", NULL, "created_at" FROM `transfer_order_items`;--> statement-breakpoint
DROP TABLE `transfer_order_items`;--> statement-breakpoint
ALTER TABLE `__new_transfer_order_items` RENAME TO `transfer_order_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_transfer_order_items_order` ON `transfer_order_items` (`transfer_order_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_order_items_product` ON `transfer_order_items` (`product_id`);
