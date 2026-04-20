CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`before` text,
	`after` text,
	`metadata` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_tenant` ON `audit_logs` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_actor` ON `audit_logs` (`actor_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_action` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_resource` ON `audit_logs` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_created_at` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `cash_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`reference_id` text,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cash_movements_tenant` ON `cash_movements` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_cash_movements_session` ON `cash_movements` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_cash_movements_type` ON `cash_movements` (`type`);--> statement-breakpoint
CREATE INDEX `idx_cash_movements_created_by` ON `cash_movements` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_cash_movements_session_created` ON `cash_movements` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cash_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`cashier_id` text NOT NULL,
	`register_name` text NOT NULL,
	`opening_float` real DEFAULT 0 NOT NULL,
	`opening_count_denominations` text NOT NULL,
	`expected_balance` real DEFAULT 0 NOT NULL,
	`actual_count` real,
	`actual_count_denominations` text,
	`over_short` real,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_at` text DEFAULT (datetime('now')) NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cashier_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_tenant` ON `cash_sessions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_site` ON `cash_sessions` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_cashier` ON `cash_sessions` (`cashier_id`);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_status` ON `cash_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_site_status` ON `cash_sessions` (`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_cash_sessions_register_status` ON `cash_sessions` (`site_id`,`register_name`,`status`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`parent_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_categories_tenant` ON `categories` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_categories_parent` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `category_x_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`category_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_category_x_provider_tenant` ON `category_x_provider` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_category_x_provider_category` ON `category_x_provider` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_category_x_provider_provider` ON `category_x_provider` (`provider_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_category_x_provider_scope` ON `category_x_provider` (`tenant_id`,`category_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `cities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`department_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cities_tenant` ON `cities` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_cities_department` ON `cities` (`department_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cities_tenant_code` ON `cities` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cities_scope_name` ON `cities` (`tenant_id`,`department_id`,`name`);--> statement-breakpoint
CREATE TABLE `client_types` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_client_types_tenant` ON `client_types` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_client_types_tenant_code` ON `client_types` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_client_types_tenant_name` ON `client_types` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `commercial_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_commercial_activities_tenant` ON `commercial_activities` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commercial_activities_tenant_code` ON `commercial_activities` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commercial_activities_tenant_name` ON `commercial_activities` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`tax_id` text,
	`address` text,
	`phone` text,
	`email` text,
	`logo_id` text,
	`logo_url` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`logo_id`) REFERENCES `logos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_companies_tenant` ON `companies` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_companies_logo` ON `companies` (`logo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_companies_tenant_name` ON `companies` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `countries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_countries_tenant` ON `countries` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_countries_tenant_code` ON `countries` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_countries_tenant_name` ON `countries` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`address` text,
	`city` text,
	`state` text,
	`postal_code` text,
	`country` text,
	`tax_id` text,
	`identification_type_id` text,
	`person_type_id` text,
	`regime_type_id` text,
	`client_type_id` text,
	`commercial_activity_id` text,
	`notes` text,
	`is_active` integer DEFAULT true,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_customers_tenant` ON `customers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_customers_email` ON `customers` (`email`);--> statement-breakpoint
CREATE TABLE `denomination_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`register_name` text NOT NULL,
	`label` text NOT NULL,
	`opening_float` real DEFAULT 0 NOT NULL,
	`denominations` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_denomination_templates_tenant` ON `denomination_templates` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_denomination_templates_site` ON `denomination_templates` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_denomination_templates_site_active` ON `denomination_templates` (`site_id`,`is_active`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_denomination_templates_site_register` ON `denomination_templates` (`site_id`,`register_name`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`country_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`country_id`) REFERENCES `countries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_departments_tenant` ON `departments` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_departments_tenant_code` ON `departments` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_departments_tenant_name` ON `departments` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `identification_types` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_identification_types_tenant` ON `identification_types` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_identification_types_tenant_code` ON `identification_types` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_identification_types_tenant_name` ON `identification_types` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `initial_inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`site_id` text,
	`mode` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`normalized_quantity` real NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`previous_stock` real NOT NULL,
	`new_stock` real NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_initial_inventory_tenant` ON `initial_inventory` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_initial_inventory_product` ON `initial_inventory` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_initial_inventory_unit` ON `initial_inventory` (`unit_id`);--> statement-breakpoint
CREATE INDEX `idx_initial_inventory_site` ON `initial_inventory` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_initial_inventory_created_by` ON `initial_inventory` (`created_by`);--> statement-breakpoint
CREATE TABLE `inventory_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`product_id` text NOT NULL,
	`on_hand` real DEFAULT 0 NOT NULL,
	`reserved` real DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_balances_tenant` ON `inventory_balances` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_balances_site` ON `inventory_balances` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_balances_product` ON `inventory_balances` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_balances_scope` ON `inventory_balances` (`tenant_id`,`site_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity` real NOT NULL,
	`previous_stock` real NOT NULL,
	`new_stock` real NOT NULL,
	`reference` text,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_tenant` ON `inventory_movements` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_product` ON `inventory_movements` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_created_by` ON `inventory_movements` (`created_by`);--> statement-breakpoint
CREATE TABLE `location_x_site` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`site_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_location_x_site_tenant` ON `location_x_site` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_location_x_site_location` ON `location_x_site` (`location_id`);--> statement-breakpoint
CREATE INDEX `idx_location_x_site_site` ON `location_x_site` (`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_location_x_site_scope` ON `location_x_site` (`tenant_id`,`location_id`,`site_id`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_locations_tenant` ON `locations` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_locations_tenant_code` ON `locations` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_locations_tenant_name` ON `locations` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `logos` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`image_url` text NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_logos_tenant` ON `logos` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_logos_tenant_name` ON `logos` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_id` text NOT NULL,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`cost_per_unit` real DEFAULT 0 NOT NULL,
	`base_unit_cost` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`order_number` text NOT NULL,
	`provider_id` text NOT NULL,
	`site_id` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_orders_tenant` ON `orders` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_provider` ON `orders` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_site` ON `orders` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_created_by` ON `orders` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_tenant_number` ON `orders` (`tenant_id`,`order_number`);--> statement-breakpoint
CREATE TABLE `person_types` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_person_types_tenant` ON `person_types` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_person_types_tenant_code` ON `person_types` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_person_types_tenant_name` ON `person_types` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `product_x_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_product_x_provider_product` ON `product_x_provider` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_product_x_provider_provider` ON `product_x_provider` (`provider_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_x_provider_scope` ON `product_x_provider` (`product_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`sku` text NOT NULL,
	`description` text,
	`category_id` text,
	`price` real DEFAULT 0 NOT NULL,
	`price2` real DEFAULT 0 NOT NULL,
	`price3` real DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`margin_percent1` real DEFAULT 0 NOT NULL,
	`margin_percent2` real DEFAULT 0 NOT NULL,
	`margin_percent3` real DEFAULT 0 NOT NULL,
	`margin_amount1` real DEFAULT 0 NOT NULL,
	`margin_amount2` real DEFAULT 0 NOT NULL,
	`margin_amount3` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`vat_rate_id` text,
	`provider_id` text,
	`location_id` text,
	`initial_cost` real DEFAULT 0 NOT NULL,
	`stock` real DEFAULT 0 NOT NULL,
	`min_stock` real DEFAULT 0 NOT NULL,
	`sell_by_fraction` integer DEFAULT false NOT NULL,
	`fraction_step` real,
	`fraction_minimum` real,
	`is_active` integer DEFAULT true,
	`barcode` text,
	`image_url` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vat_rate_id`) REFERENCES `vat_rates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_products_tenant` ON `products` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_products_sku` ON `products` (`sku`);--> statement-breakpoint
CREATE INDEX `idx_products_barcode` ON `products` (`barcode`);--> statement-breakpoint
CREATE INDEX `idx_products_category` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_products_provider` ON `products` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_products_vat_rate` ON `products` (`vat_rate_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_tenant_sku` ON `products` (`tenant_id`,`sku`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`tax_id` text,
	`phone` text,
	`email` text,
	`address` text,
	`city_id` text,
	`contact_name` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_providers_tenant` ON `providers` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_providers_tenant_name` ON `providers` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `purchase_items` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`product_id` text NOT NULL,
	`source_order_item_id` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_id` text NOT NULL,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`cost_per_unit` real DEFAULT 0 NOT NULL,
	`base_unit_cost` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_items_purchase` ON `purchase_items` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_items_product` ON `purchase_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_items_source_order_item` ON `purchase_items` (`source_order_item_id`);--> statement-breakpoint
CREATE TABLE `purchase_return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_return_id` text NOT NULL,
	`purchase_item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_id` text NOT NULL,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`cost_per_unit` real DEFAULT 0 NOT NULL,
	`base_unit_cost` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`purchase_return_id`) REFERENCES `purchase_returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_item_id`) REFERENCES `purchase_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_return_items_return` ON `purchase_return_items` (`purchase_return_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_return_items_purchase_item` ON `purchase_return_items` (`purchase_item_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_return_items_product` ON `purchase_return_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `purchase_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`return_amount` real DEFAULT 0 NOT NULL,
	`reason` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_returns_tenant` ON `purchase_returns` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_returns_purchase` ON `purchase_returns` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_returns_created_by` ON `purchase_returns` (`created_by`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purchase_number` text NOT NULL,
	`provider_id` text NOT NULL,
	`order_id` text,
	`site_id` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchases_tenant` ON `purchases` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_provider` ON `purchases` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_order` ON `purchases` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_site` ON `purchases` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_purchases_created_by` ON `purchases` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchases_tenant_number` ON `purchases` (`tenant_id`,`purchase_number`);--> statement-breakpoint
CREATE TABLE `quotation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`quotation_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_quotation_items_quotation` ON `quotation_items` (`quotation_id`);--> statement-breakpoint
CREATE INDEX `idx_quotation_items_product` ON `quotation_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `quotations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`quotation_number` text NOT NULL,
	`customer_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`valid_until` text,
	`notes` text,
	`created_by` text NOT NULL,
	`status_changed_at` text,
	`status_changed_by` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_quotations_tenant` ON `quotations` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_site` ON `quotations` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_customer` ON `quotations` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_status` ON `quotations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_quotations_created_by` ON `quotations` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quotations_tenant_number` ON `quotations` (`tenant_id`,`quotation_number`);--> statement-breakpoint
CREATE TABLE `regime_types` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_regime_types_tenant` ON `regime_types` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_regime_types_tenant_code` ON `regime_types` (`tenant_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_regime_types_tenant_name` ON `regime_types` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`unit_id` text,
	`unit_equivalence` real DEFAULT 1 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`cost_at_sale` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sale_items_sale` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_items_product` ON `sale_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `sale_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` real NOT NULL,
	`reference` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sale_payments_tenant` ON `sale_payments` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_payments_sale` ON `sale_payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_payments_method` ON `sale_payments` (`method`);--> statement-breakpoint
CREATE TABLE `sale_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`refund_amount` real DEFAULT 0 NOT NULL,
	`reason` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sale_returns_tenant` ON `sale_returns` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_returns_sale` ON `sale_returns` (`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_sale_returns_created_by` ON `sale_returns` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_returns_sale_unique` ON `sale_returns` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_number` text NOT NULL,
	`customer_id` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`payment_method` text DEFAULT 'cash' NOT NULL,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`cash_session_id` text,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sales_tenant` ON `sales` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_customer` ON `sales` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_cash_session` ON `sales` (`cash_session_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_created_by` ON `sales` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_tenant_number` ON `sales` (`tenant_id`,`sale_number`);--> statement-breakpoint
CREATE TABLE `sequentials` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`document_type` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`current_value` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sequentials_tenant` ON `sequentials` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sequentials_site` ON `sequentials` (`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sequentials_scope` ON `sequentials` (`tenant_id`,`site_id`,`document_type`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`phone` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sites_tenant` ON `sites` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sites_company` ON `sites` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sites_tenant_name` ON `sites` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `sync_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`local_data` text,
	`remote_data` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolution` text,
	`resolved_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sync_conflicts_tenant` ON `sync_conflicts` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sync_conflicts_status` ON `sync_conflicts` (`status`);--> statement-breakpoint
CREATE TABLE `sync_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`data` text,
	`local_version` integer DEFAULT 1 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sync_queue_tenant` ON `sync_queue` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sync_queue_entity` ON `sync_queue` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`settings` text DEFAULT '{}',
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_unique` ON `tenants` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tenants_slug` ON `tenants` (`slug`);--> statement-breakpoint
CREATE TABLE `transfer_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real NOT NULL,
	`received_quantity` real,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`transfer_order_id`) REFERENCES `transfer_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_transfer_order_items_order` ON `transfer_order_items` (`transfer_order_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_order_items_product` ON `transfer_order_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `transfer_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`from_site_id` text NOT NULL,
	`to_site_id` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`received_at` text,
	`received_by` text,
	`discrepancy_notes` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_transfer_orders_tenant` ON `transfer_orders` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_orders_from_site` ON `transfer_orders` (`from_site_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_orders_to_site` ON `transfer_orders` (`to_site_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_orders_status` ON `transfer_orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_transfer_orders_received_by` ON `transfer_orders` (`received_by`);--> statement-breakpoint
CREATE TABLE `unit_x_product` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`equivalence` real DEFAULT 1 NOT NULL,
	`price` real DEFAULT 0 NOT NULL,
	`is_base` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_unit_x_product_product` ON `unit_x_product` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_unit_x_product_unit` ON `unit_x_product` (`unit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_unit_x_product_scope` ON `unit_x_product` (`product_id`,`unit_id`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`abbreviation` text NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_units_tenant` ON `units` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_units_tenant_abbreviation` ON `units` (`tenant_id`,`abbreviation`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`role` text DEFAULT 'cashier' NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_tenant` ON `users` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vat_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`rate` real DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vat_rates_tenant` ON `vat_rates` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vat_rates_tenant_name` ON `vat_rates` (`tenant_id`,`name`);