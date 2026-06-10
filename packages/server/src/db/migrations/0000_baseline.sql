CREATE TABLE `ai_anomaly_snoozes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`cashier_id` text,
	`evidence_ref` text,
	`snoozed_until` text NOT NULL,
	`snoozed_by` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cashier_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`snoozed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ai_anomaly_snoozes_tenant_until` ON `ai_anomaly_snoozes` (`tenant_id`,`snoozed_until`);--> statement-breakpoint
CREATE INDEX `idx_ai_anomaly_snoozes_lookup` ON `ai_anomaly_snoozes` (`tenant_id`,`kind`,`cashier_id`,`evidence_ref`,`snoozed_until`);--> statement-breakpoint
CREATE TABLE `ai_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text,
	`user_id` text,
	`feature` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real NOT NULL,
	`duration_ms` integer NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ai_audit_log_tenant_created` ON `ai_audit_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_audit_log_tenant_site_created` ON `ai_audit_log` (`tenant_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_audit_log_tenant_feature` ON `ai_audit_log` (`tenant_id`,`feature`);--> statement-breakpoint
CREATE INDEX `idx_ai_audit_log_tenant_provider` ON `ai_audit_log` (`tenant_id`,`provider_id`);--> statement-breakpoint
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
	`operation_id` text,
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
CREATE INDEX `idx_audit_logs_operation_id` ON `audit_logs` (`operation_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_tenant_created` ON `audit_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_tenant_action_created` ON `audit_logs` (`tenant_id`,`action`,`created_at`);--> statement-breakpoint
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
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_cash_movements_amount_2dec" CHECK(round("cash_movements"."amount", 2) = "cash_movements"."amount")
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
	FOREIGN KEY (`cashier_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_cash_sessions_opening_nonneg" CHECK("cash_sessions"."opening_float" >= 0),
	CONSTRAINT "chk_cash_sessions_opening_2dec" CHECK(round("cash_sessions"."opening_float", 2) = "cash_sessions"."opening_float"),
	CONSTRAINT "chk_cash_sessions_expected_nonneg" CHECK("cash_sessions"."expected_balance" >= 0),
	CONSTRAINT "chk_cash_sessions_expected_2dec" CHECK(round("cash_sessions"."expected_balance", 2) = "cash_sessions"."expected_balance"),
	CONSTRAINT "chk_cash_sessions_over_short_2dec" CHECK(round("cash_sessions"."over_short", 2) = "cash_sessions"."over_short")
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
	`version` integer DEFAULT 0 NOT NULL,
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
CREATE TABLE `country_catalog` (
	`code` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_es` text NOT NULL,
	`default_locale` text NOT NULL,
	`general_locale` text NOT NULL,
	`default_currency_code` text NOT NULL,
	`additional_currency_codes` text DEFAULT '[]',
	`default_timezone` text NOT NULL,
	`first_day_of_week` integer NOT NULL,
	`date_format_short` text NOT NULL,
	`date_format_long` text NOT NULL,
	`tax_id_types_hint` text DEFAULT '[]',
	`ui_locale_ready` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`default_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `currency_catalog` (
	`code` text PRIMARY KEY NOT NULL,
	`name_en` text NOT NULL,
	`name_es` text NOT NULL,
	`symbol` text NOT NULL,
	`decimals` integer NOT NULL,
	`display_decimals` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customer_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`occurred_at` text DEFAULT (datetime('now')) NOT NULL,
	`kind` text NOT NULL,
	`amount` real NOT NULL,
	`reference_sale_id` text,
	`note` text,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reference_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_customer_ledger_tenant_customer_occurred` ON `customer_ledger_entries` (`tenant_id`,`customer_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_customer_ledger_tenant_kind` ON `customer_ledger_entries` (`tenant_id`,`kind`);--> statement-breakpoint
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
	`credit_limit` real DEFAULT 0 NOT NULL,
	`credit_limit_currency_code` text,
	`is_active` integer DEFAULT true,
	`version` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credit_limit_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_customers_credit_limit_nonneg" CHECK("customers"."credit_limit" >= 0),
	CONSTRAINT "chk_customers_credit_limit_2dec" CHECK(round("customers"."credit_limit", 2) = "customers"."credit_limit")
);
--> statement-breakpoint
CREATE INDEX `idx_customers_tenant` ON `customers` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_customers_email` ON `customers` (`email`);--> statement-breakpoint
CREATE TABLE `delivery_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`customer_id` text,
	`customer_name` text NOT NULL,
	`customer_phone` text,
	`address` text NOT NULL,
	`address_notes` text,
	`courier_name` text,
	`status` text DEFAULT 'accepted' NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`items_snapshot` text,
	`sale_id` text,
	`accepted_at` text DEFAULT (datetime('now')) NOT NULL,
	`preparing_at` text,
	`dispatched_at` text,
	`delivered_at` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_delivery_orders_tenant_site_status` ON `delivery_orders` (`tenant_id`,`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_delivery_orders_tenant_accepted` ON `delivery_orders` (`tenant_id`,`accepted_at`);--> statement-breakpoint
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
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_denomination_templates_opening_nonneg" CHECK("denomination_templates"."opening_float" >= 0),
	CONSTRAINT "chk_denomination_templates_opening_2dec" CHECK(round("denomination_templates"."opening_float", 2) = "denomination_templates"."opening_float")
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
CREATE TABLE `device_pairing_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`device_name` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`claimed_by_device_id` text,
	`expires_at` text NOT NULL,
	`claimed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claimed_by_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_device_pairing_codes_hash` ON `device_pairing_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `idx_device_pairing_codes_tenant_status` ON `device_pairing_codes` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_device_pairing_codes_tenant_site` ON `device_pairing_codes` (`tenant_id`,`site_id`);--> statement-breakpoint
CREATE INDEX `idx_device_pairing_codes_claimed_device` ON `device_pairing_codes` (`claimed_by_device_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`registered_by_user_id` text NOT NULL,
	`last_seen_at` text,
	`authority_role` text,
	`paired_site_id` text,
	`app_version` text,
	`db_schema_version` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`registered_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paired_site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_devices_tenant_active` ON `devices` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_devices_tenant_last_seen` ON `devices` (`tenant_id`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `idx_devices_tenant_authority_role` ON `devices` (`tenant_id`,`authority_role`);--> statement-breakpoint
CREATE INDEX `idx_devices_tenant_paired_site` ON `devices` (`tenant_id`,`paired_site_id`);--> statement-breakpoint
CREATE TABLE `fiscal_cafs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tipo_dte` text NOT NULL,
	`rut_emisor` text NOT NULL,
	`folio_desde` integer NOT NULL,
	`folio_hasta` integer NOT NULL,
	`current_folio` integer NOT NULL,
	`fecha_autorizacion` text NOT NULL,
	`raw_xml` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_cafs_active` ON `fiscal_cafs` (`tenant_id`,`tipo_dte`) WHERE "fiscal_cafs"."status" = 'active';--> statement-breakpoint
CREATE INDEX `idx_fiscal_cafs_tenant` ON `fiscal_cafs` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `fiscal_certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`alias` text NOT NULL,
	`p12_ref` text NOT NULL,
	`passphrase_ref` text NOT NULL,
	`subject_dn` text,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_fiscal_certificates_tenant` ON `fiscal_certificates` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `fiscal_document_items` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_document_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`product_id` text,
	`product_name` text NOT NULL,
	`product_sku` text,
	`unit_measure_code` text DEFAULT 'EA' NOT NULL,
	`quantity` real NOT NULL,
	`unit_price` real NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`tax_category_code` text DEFAULT '01' NOT NULL,
	`line_total` real NOT NULL,
	FOREIGN KEY (`fiscal_document_id`) REFERENCES `fiscal_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_fiscal_document_items_unit_price_nonneg" CHECK("fiscal_document_items"."unit_price" >= 0),
	CONSTRAINT "chk_fiscal_document_items_unit_price_2dec" CHECK(round("fiscal_document_items"."unit_price", 2) = "fiscal_document_items"."unit_price"),
	CONSTRAINT "chk_fiscal_document_items_discount_nonneg" CHECK("fiscal_document_items"."discount_amount" >= 0),
	CONSTRAINT "chk_fiscal_document_items_discount_2dec" CHECK(round("fiscal_document_items"."discount_amount", 2) = "fiscal_document_items"."discount_amount"),
	CONSTRAINT "chk_fiscal_document_items_tax_nonneg" CHECK("fiscal_document_items"."tax_amount" >= 0),
	CONSTRAINT "chk_fiscal_document_items_tax_2dec" CHECK(round("fiscal_document_items"."tax_amount", 2) = "fiscal_document_items"."tax_amount"),
	CONSTRAINT "chk_fiscal_document_items_total_nonneg" CHECK("fiscal_document_items"."line_total" >= 0),
	CONSTRAINT "chk_fiscal_document_items_total_2dec" CHECK(round("fiscal_document_items"."line_total", 2) = "fiscal_document_items"."line_total")
);
--> statement-breakpoint
CREATE INDEX `idx_fiscal_document_items_doc` ON `fiscal_document_items` (`fiscal_document_id`);--> statement-breakpoint
CREATE TABLE `fiscal_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`resolution_id` text NOT NULL,
	`consecutive` integer NOT NULL,
	`document_number` text NOT NULL,
	`cufe` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`customer_id` text,
	`buyer_tax_id` text NOT NULL,
	`buyer_country_code` text DEFAULT 'CO' NOT NULL,
	`buyer_tax_id_type_code` text NOT NULL,
	`buyer_name` text NOT NULL,
	`buyer_email` text,
	`buyer_address` text,
	`buyer_city` text,
	`buyer_department` text,
	`buyer_country` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`currency_code` text NOT NULL,
	`locale_code` text NOT NULL,
	`original_cufe` text,
	`reason_code` text,
	`provider_id` text NOT NULL,
	`provider_response` text,
	`xml_ref` text,
	`retries` integer DEFAULT 0 NOT NULL,
	`emitted_by_user_id` text NOT NULL,
	`emitted_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolution_id`) REFERENCES `fiscal_numbering_resolutions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_country_code`) REFERENCES `country_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`emitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_country_code`,`buyer_tax_id_type_code`) REFERENCES `fiscal_identification_types`(`country_code`,`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fiscal_documents_subtotal_nonneg" CHECK("fiscal_documents"."subtotal" >= 0),
	CONSTRAINT "chk_fiscal_documents_subtotal_2dec" CHECK(round("fiscal_documents"."subtotal", 2) = "fiscal_documents"."subtotal"),
	CONSTRAINT "chk_fiscal_documents_tax_nonneg" CHECK("fiscal_documents"."tax_amount" >= 0),
	CONSTRAINT "chk_fiscal_documents_tax_2dec" CHECK(round("fiscal_documents"."tax_amount", 2) = "fiscal_documents"."tax_amount"),
	CONSTRAINT "chk_fiscal_documents_discount_nonneg" CHECK("fiscal_documents"."discount_amount" >= 0),
	CONSTRAINT "chk_fiscal_documents_discount_2dec" CHECK(round("fiscal_documents"."discount_amount", 2) = "fiscal_documents"."discount_amount"),
	CONSTRAINT "chk_fiscal_documents_total_nonneg" CHECK("fiscal_documents"."total_amount" >= 0),
	CONSTRAINT "chk_fiscal_documents_total_2dec" CHECK(round("fiscal_documents"."total_amount", 2) = "fiscal_documents"."total_amount")
);
--> statement-breakpoint
CREATE INDEX `idx_fiscal_documents_tenant` ON `fiscal_documents` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_documents_source` ON `fiscal_documents` (`source`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_documents_cufe` ON `fiscal_documents` (`cufe`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_documents_tenant_doc` ON `fiscal_documents` (`tenant_id`,`document_number`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_documents_status` ON `fiscal_documents` (`status`);--> statement-breakpoint
CREATE TABLE `fiscal_identification_types` (
	`country_code` text NOT NULL,
	`code` text NOT NULL,
	`abbr` text NOT NULL,
	`name_es` text NOT NULL,
	`name_en` text NOT NULL,
	`natural_person` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`country_code`, `code`),
	FOREIGN KEY (`country_code`) REFERENCES `country_catalog`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fiscal_numbering_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`resolution_number` text NOT NULL,
	`prefix` text NOT NULL,
	`from_number` integer NOT NULL,
	`to_number` integer NOT NULL,
	`current_number` integer NOT NULL,
	`technical_key` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_fiscal_resolutions_tenant` ON `fiscal_numbering_resolutions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_resolutions_site_kind` ON `fiscal_numbering_resolutions` (`site_id`,`kind`,`is_active`);--> statement-breakpoint
CREATE TABLE `fiscal_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`kind` text DEFAULT 'emit' NOT NULL,
	`fiscal_document_id` text,
	`provider_id` text,
	`cufe` text,
	`payload` text NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`priority` real DEFAULT 0 NOT NULL,
	`claim_token` text,
	`locked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fiscal_document_id`) REFERENCES `fiscal_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_fiscal_outbox_tenant_status_retry` ON `fiscal_outbox` (`tenant_id`,`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_outbox_fiscal_document` ON `fiscal_outbox` (`fiscal_document_id`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_outbox_tenant_created` ON `fiscal_outbox` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `hardware_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`kind` text NOT NULL,
	`peripheral_id` text,
	`payload` text NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`priority` real DEFAULT 0 NOT NULL,
	`claim_token` text,
	`locked_at` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`peripheral_id`) REFERENCES `site_peripherals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_hardware_outbox_tenant_status_retry` ON `hardware_outbox` (`tenant_id`,`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_hardware_outbox_peripheral` ON `hardware_outbox` (`peripheral_id`);--> statement-breakpoint
CREATE INDEX `idx_hardware_outbox_tenant_created` ON `hardware_outbox` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_hardware_outbox_idempotent` ON `hardware_outbox` (`tenant_id`,`kind`,`idempotency_key`) WHERE "hardware_outbox"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`device_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`operation_kind` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`result_ref` text,
	`locked_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_idempotency_keys_unique` ON `idempotency_keys` (`tenant_id`,`device_id`,`idempotency_key`,`operation_kind`);--> statement-breakpoint
CREATE INDEX `idx_idempotency_keys_expires_at` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_idempotency_keys_status_expires_at` ON `idempotency_keys` (`status`,`expires_at`);--> statement-breakpoint
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
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_initial_inventory_cost_nonneg" CHECK("initial_inventory"."cost" >= 0),
	CONSTRAINT "chk_initial_inventory_cost_2dec" CHECK(round("initial_inventory"."cost", 2) = "initial_inventory"."cost")
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
CREATE INDEX `idx_inventory_movements_tenant_created` ON `inventory_movements` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `invoice_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text,
	`user_id` text,
	`file_name` text,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`payload_base64` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_invoice_uploads_tenant_created` ON `invoice_uploads` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_invoice_uploads_tenant_site_created` ON `invoice_uploads` (`tenant_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_invoice_uploads_payload_hash` ON `invoice_uploads` (`payload_hash`);--> statement-breakpoint
CREATE TABLE `kds_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`table_id` text,
	`table_label` text,
	`sale_number` text NOT NULL,
	`station` text DEFAULT 'main' NOT NULL,
	`items_json` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`ready_at` text,
	`ready_by_user_id` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ready_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kds_orders_unique_sale_station` ON `kds_orders` (`tenant_id`,`sale_id`,`station`);--> statement-breakpoint
CREATE INDEX `idx_kds_orders_tenant_site_status` ON `kds_orders` (`tenant_id`,`site_id`,`status`);--> statement-breakpoint
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
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`first_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_login_attempts_kind_key` ON `login_attempts` (`kind`,`key`);--> statement-breakpoint
CREATE INDEX `idx_login_attempts_expires_at` ON `login_attempts` (`expires_at`);--> statement-breakpoint
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
CREATE TABLE `operation_effects` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_event_id` text NOT NULL,
	`kind` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`effect_data` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`operation_event_id`) REFERENCES `operation_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_operation_effects_event` ON `operation_effects` (`operation_event_id`);--> statement-breakpoint
CREATE INDEX `idx_operation_effects_event_kind` ON `operation_effects` (`operation_event_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_operation_effects_resource` ON `operation_effects` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `operation_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_event_id` text NOT NULL,
	`error_code` text NOT NULL,
	`message` text NOT NULL,
	`recoverable` integer DEFAULT false NOT NULL,
	`error_data` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`operation_event_id`) REFERENCES `operation_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_operation_errors_event` ON `operation_errors` (`operation_event_id`);--> statement-breakpoint
CREATE INDEX `idx_operation_errors_code` ON `operation_errors` (`error_code`);--> statement-breakpoint
CREATE TABLE `operation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`operation_kind` text NOT NULL,
	`device_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'started' NOT NULL,
	`request_hash` text NOT NULL,
	`summary` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_operation_events_tenant_operation` ON `operation_events` (`tenant_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `idx_operation_events_status` ON `operation_events` (`status`);--> statement-breakpoint
CREATE INDEX `idx_operation_events_kind_status` ON `operation_events` (`operation_kind`,`status`);--> statement-breakpoint
CREATE INDEX `idx_operation_events_device` ON `operation_events` (`device_id`);--> statement-breakpoint
CREATE INDEX `idx_operation_events_user` ON `operation_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_operation_events_status_created` ON `operation_events` (`status`,`created_at`);--> statement-breakpoint
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
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_order_items_cost_per_unit_nonneg" CHECK("order_items"."cost_per_unit" >= 0),
	CONSTRAINT "chk_order_items_cost_per_unit_2dec" CHECK(round("order_items"."cost_per_unit", 2) = "order_items"."cost_per_unit"),
	CONSTRAINT "chk_order_items_base_cost_nonneg" CHECK("order_items"."base_unit_cost" >= 0),
	CONSTRAINT "chk_order_items_base_cost_2dec" CHECK(round("order_items"."base_unit_cost", 2) = "order_items"."base_unit_cost"),
	CONSTRAINT "chk_order_items_total_nonneg" CHECK("order_items"."total" >= 0),
	CONSTRAINT "chk_order_items_total_2dec" CHECK(round("order_items"."total", 2) = "order_items"."total")
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
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_orders_subtotal_nonneg" CHECK("orders"."subtotal" >= 0),
	CONSTRAINT "chk_orders_subtotal_2dec" CHECK(round("orders"."subtotal", 2) = "orders"."subtotal"),
	CONSTRAINT "chk_orders_total_nonneg" CHECK("orders"."total" >= 0),
	CONSTRAINT "chk_orders_total_2dec" CHECK(round("orders"."total", 2) = "orders"."total")
);
--> statement-breakpoint
CREATE INDEX `idx_orders_tenant` ON `orders` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_provider` ON `orders` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_site` ON `orders` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_created_by` ON `orders` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_tenant_number` ON `orders` (`tenant_id`,`order_number`);--> statement-breakpoint
CREATE TABLE `outbox_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`outbox_kind` text NOT NULL,
	`pending_count` integer DEFAULT 0 NOT NULL,
	`last_success_at` text,
	`last_failure_at` text,
	`oldest_pending_at` text,
	`refreshed_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_outbox_metadata_tenant_kind` ON `outbox_metadata` (`tenant_id`,`outbox_kind`);--> statement-breakpoint
CREATE INDEX `idx_outbox_metadata_kind_pending` ON `outbox_metadata` (`outbox_kind`,`pending_count`);--> statement-breakpoint
CREATE TABLE `payment_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_payment_id` text,
	`rail_id` text NOT NULL,
	`kind` text DEFAULT 'charge' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`amount` real NOT NULL,
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`reference` text NOT NULL,
	`provider_transaction_id` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`priority` real DEFAULT 0 NOT NULL,
	`claim_token` text,
	`locked_at` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_payment_id`) REFERENCES `sale_payments`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_payment_outbox_amount_nonneg" CHECK("payment_outbox"."amount" >= 0),
	CONSTRAINT "chk_payment_outbox_amount_2dec" CHECK(round("payment_outbox"."amount", 2) = "payment_outbox"."amount")
);
--> statement-breakpoint
CREATE INDEX `idx_payment_outbox_tenant_status_retry` ON `payment_outbox` (`tenant_id`,`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_payment_outbox_tenant_created` ON `payment_outbox` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_payment_outbox_sale_payment` ON `payment_outbox` (`sale_payment_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_outbox_rail_status` ON `payment_outbox` (`tenant_id`,`rail_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_outbox_idempotent` ON `payment_outbox` (`tenant_id`,`rail_id`,`kind`,`idempotency_key`) WHERE "payment_outbox"."idempotency_key" IS NOT NULL;--> statement-breakpoint
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
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`stock` real DEFAULT 0 NOT NULL,
	`min_stock` real DEFAULT 0 NOT NULL,
	`sell_by_fraction` integer DEFAULT false NOT NULL,
	`fraction_step` real,
	`fraction_minimum` real,
	`is_active` integer DEFAULT true,
	`barcode` text,
	`image_url` text,
	`embedding` text,
	`embedding_model` text,
	`embedded_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vat_rate_id`) REFERENCES `vat_rates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_products_price_nonneg" CHECK("products"."price" >= 0),
	CONSTRAINT "chk_products_price_2dec" CHECK(round("products"."price", 2) = "products"."price"),
	CONSTRAINT "chk_products_price2_nonneg" CHECK("products"."price2" >= 0),
	CONSTRAINT "chk_products_price2_2dec" CHECK(round("products"."price2", 2) = "products"."price2"),
	CONSTRAINT "chk_products_price3_nonneg" CHECK("products"."price3" >= 0),
	CONSTRAINT "chk_products_price3_2dec" CHECK(round("products"."price3", 2) = "products"."price3"),
	CONSTRAINT "chk_products_cost_nonneg" CHECK("products"."cost" >= 0),
	CONSTRAINT "chk_products_cost_2dec" CHECK(round("products"."cost", 2) = "products"."cost"),
	CONSTRAINT "chk_products_margin1_nonneg" CHECK("products"."margin_amount1" >= 0),
	CONSTRAINT "chk_products_margin1_2dec" CHECK(round("products"."margin_amount1", 2) = "products"."margin_amount1"),
	CONSTRAINT "chk_products_margin2_nonneg" CHECK("products"."margin_amount2" >= 0),
	CONSTRAINT "chk_products_margin2_2dec" CHECK(round("products"."margin_amount2", 2) = "products"."margin_amount2"),
	CONSTRAINT "chk_products_margin3_nonneg" CHECK("products"."margin_amount3" >= 0),
	CONSTRAINT "chk_products_margin3_2dec" CHECK(round("products"."margin_amount3", 2) = "products"."margin_amount3"),
	CONSTRAINT "chk_products_init_cost_nonneg" CHECK("products"."initial_cost" >= 0),
	CONSTRAINT "chk_products_init_cost_2dec" CHECK(round("products"."initial_cost", 2) = "products"."initial_cost")
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
	`version` integer DEFAULT 0 NOT NULL,
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
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchase_items_cost_per_unit_nonneg" CHECK("purchase_items"."cost_per_unit" >= 0),
	CONSTRAINT "chk_purchase_items_cost_per_unit_2dec" CHECK(round("purchase_items"."cost_per_unit", 2) = "purchase_items"."cost_per_unit"),
	CONSTRAINT "chk_purchase_items_base_cost_nonneg" CHECK("purchase_items"."base_unit_cost" >= 0),
	CONSTRAINT "chk_purchase_items_base_cost_2dec" CHECK(round("purchase_items"."base_unit_cost", 2) = "purchase_items"."base_unit_cost"),
	CONSTRAINT "chk_purchase_items_total_nonneg" CHECK("purchase_items"."total" >= 0),
	CONSTRAINT "chk_purchase_items_total_2dec" CHECK(round("purchase_items"."total", 2) = "purchase_items"."total")
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
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchase_returns_amount_nonneg" CHECK("purchase_returns"."return_amount" >= 0),
	CONSTRAINT "chk_purchase_returns_amount_2dec" CHECK(round("purchase_returns"."return_amount", 2) = "purchase_returns"."return_amount")
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
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_purchases_subtotal_nonneg" CHECK("purchases"."subtotal" >= 0),
	CONSTRAINT "chk_purchases_subtotal_2dec" CHECK(round("purchases"."subtotal", 2) = "purchases"."subtotal"),
	CONSTRAINT "chk_purchases_total_nonneg" CHECK("purchases"."total" >= 0),
	CONSTRAINT "chk_purchases_total_2dec" CHECK(round("purchases"."total", 2) = "purchases"."total")
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
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`exchange_rate_at_sale` real DEFAULT 1 NOT NULL,
	`settle_currency_code` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settle_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_quotation_items_unit_price_nonneg" CHECK("quotation_items"."unit_price" >= 0),
	CONSTRAINT "chk_quotation_items_unit_price_2dec" CHECK(round("quotation_items"."unit_price", 2) = "quotation_items"."unit_price"),
	CONSTRAINT "chk_quotation_items_tax_nonneg" CHECK("quotation_items"."tax_amount" >= 0),
	CONSTRAINT "chk_quotation_items_tax_2dec" CHECK(round("quotation_items"."tax_amount", 2) = "quotation_items"."tax_amount"),
	CONSTRAINT "chk_quotation_items_total_nonneg" CHECK("quotation_items"."total" >= 0),
	CONSTRAINT "chk_quotation_items_total_2dec" CHECK(round("quotation_items"."total", 2) = "quotation_items"."total"),
	CONSTRAINT "chk_quotation_items_discount_2dec" CHECK(round("quotation_items"."discount", 2) = "quotation_items"."discount"),
	CONSTRAINT "chk_quotation_items_exchange_rate_positive" CHECK("quotation_items"."exchange_rate_at_sale" > 0)
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
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`exchange_rate_at_sale` real DEFAULT 1 NOT NULL,
	`settle_currency_code` text,
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
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settle_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_quotations_subtotal_nonneg" CHECK("quotations"."subtotal" >= 0),
	CONSTRAINT "chk_quotations_subtotal_2dec" CHECK(round("quotations"."subtotal", 2) = "quotations"."subtotal"),
	CONSTRAINT "chk_quotations_tax_nonneg" CHECK("quotations"."tax_amount" >= 0),
	CONSTRAINT "chk_quotations_tax_2dec" CHECK(round("quotations"."tax_amount", 2) = "quotations"."tax_amount"),
	CONSTRAINT "chk_quotations_total_nonneg" CHECK("quotations"."total" >= 0),
	CONSTRAINT "chk_quotations_total_2dec" CHECK(round("quotations"."total", 2) = "quotations"."total"),
	CONSTRAINT "chk_quotations_discount_2dec" CHECK(round("quotations"."discount_amount", 2) = "quotations"."discount_amount"),
	CONSTRAINT "chk_quotations_exchange_rate_positive" CHECK("quotations"."exchange_rate_at_sale" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_quotations_tenant` ON `quotations` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_site` ON `quotations` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_customer` ON `quotations` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_quotations_status` ON `quotations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_quotations_created_by` ON `quotations` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quotations_tenant_number` ON `quotations` (`tenant_id`,`quotation_number`);--> statement-breakpoint
CREATE INDEX `idx_quotations_tenant_status_valid_until` ON `quotations` (`tenant_id`,`status`,`valid_until`);--> statement-breakpoint
CREATE TABLE `receipt_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`paper_width` text DEFAULT '80mm' NOT NULL,
	`layout` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_receipt_templates_tenant` ON `receipt_templates` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_receipt_templates_tenant_kind` ON `receipt_templates` (`tenant_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_receipt_templates_tenant_active` ON `receipt_templates` (`tenant_id`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_receipt_templates_tenant_kind_default` ON `receipt_templates` (`tenant_id`,`kind`) WHERE "receipt_templates"."is_default" = 1;--> statement-breakpoint
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
CREATE TABLE `restaurant_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`seat_count` integer,
	`area` text,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_restaurant_tables_tenant_site` ON `restaurant_tables` (`tenant_id`,`site_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_restaurant_tables_unique_active_name` ON `restaurant_tables` (`tenant_id`,`site_id`,`name`) WHERE "restaurant_tables"."is_active" = 1;--> statement-breakpoint
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
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`exchange_rate_at_sale` real DEFAULT 1 NOT NULL,
	`settle_currency_code` text,
	`notes` text,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settle_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_items_unit_price_nonneg" CHECK("sale_items"."unit_price" >= 0),
	CONSTRAINT "chk_sale_items_unit_price_2dec" CHECK(round("sale_items"."unit_price", 2) = "sale_items"."unit_price"),
	CONSTRAINT "chk_sale_items_tax_nonneg" CHECK("sale_items"."tax_amount" >= 0),
	CONSTRAINT "chk_sale_items_tax_2dec" CHECK(round("sale_items"."tax_amount", 2) = "sale_items"."tax_amount"),
	CONSTRAINT "chk_sale_items_cost_nonneg" CHECK("sale_items"."cost_at_sale" >= 0),
	CONSTRAINT "chk_sale_items_cost_2dec" CHECK(round("sale_items"."cost_at_sale", 2) = "sale_items"."cost_at_sale"),
	CONSTRAINT "chk_sale_items_total_nonneg" CHECK("sale_items"."total" >= 0),
	CONSTRAINT "chk_sale_items_total_2dec" CHECK(round("sale_items"."total", 2) = "sale_items"."total"),
	CONSTRAINT "chk_sale_items_discount_2dec" CHECK(round("sale_items"."discount", 2) = "sale_items"."discount"),
	CONSTRAINT "chk_sale_items_exchange_rate_positive" CHECK("sale_items"."exchange_rate_at_sale" > 0)
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
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_sale_payments_amount_2dec" CHECK(round("sale_payments"."amount", 2) = "sale_payments"."amount")
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
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sale_returns_refund_nonneg" CHECK("sale_returns"."refund_amount" >= 0),
	CONSTRAINT "chk_sale_returns_refund_2dec" CHECK(round("sale_returns"."refund_amount", 2) = "sale_returns"."refund_amount")
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
	`table_id` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`discount_amount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`currency_code` text DEFAULT 'COP' NOT NULL,
	`exchange_rate_at_sale` real DEFAULT 1 NOT NULL,
	`settle_currency_code` text,
	`tip_amount` real DEFAULT 0 NOT NULL,
	`tip_method` text,
	`service_charge_amount` real DEFAULT 0 NOT NULL,
	`service_charge_rate` real,
	`payment_method` text DEFAULT 'cash' NOT NULL,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`cash_session_id` text,
	`notes` text,
	`created_by` text NOT NULL,
	`suspended_at` text,
	`suspended_by` text,
	`suspended_label` text,
	`reprint_count` integer DEFAULT 0 NOT NULL,
	`last_reprinted_at` text,
	`last_reprinted_by` text,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settle_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suspended_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_reprinted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_sales_subtotal_nonneg" CHECK("sales"."subtotal" >= 0),
	CONSTRAINT "chk_sales_subtotal_2dec" CHECK(round("sales"."subtotal", 2) = "sales"."subtotal"),
	CONSTRAINT "chk_sales_tax_nonneg" CHECK("sales"."tax_amount" >= 0),
	CONSTRAINT "chk_sales_tax_2dec" CHECK(round("sales"."tax_amount", 2) = "sales"."tax_amount"),
	CONSTRAINT "chk_sales_total_nonneg" CHECK("sales"."total" >= 0),
	CONSTRAINT "chk_sales_total_2dec" CHECK(round("sales"."total", 2) = "sales"."total"),
	CONSTRAINT "chk_sales_tip_nonneg" CHECK("sales"."tip_amount" >= 0),
	CONSTRAINT "chk_sales_tip_2dec" CHECK(round("sales"."tip_amount", 2) = "sales"."tip_amount"),
	CONSTRAINT "chk_sales_service_nonneg" CHECK("sales"."service_charge_amount" >= 0),
	CONSTRAINT "chk_sales_service_2dec" CHECK(round("sales"."service_charge_amount", 2) = "sales"."service_charge_amount"),
	CONSTRAINT "chk_sales_discount_2dec" CHECK(round("sales"."discount_amount", 2) = "sales"."discount_amount"),
	CONSTRAINT "chk_sales_exchange_rate_positive" CHECK("sales"."exchange_rate_at_sale" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_sales_tenant` ON `sales` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_tenant_created` ON `sales` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sales_customer` ON `sales` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_cash_session` ON `sales` (`cash_session_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_created_by` ON `sales` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_sales_suspended_by` ON `sales` (`suspended_by`);--> statement-breakpoint
CREATE INDEX `idx_sales_tenant_table` ON `sales` (`tenant_id`,`table_id`);--> statement-breakpoint
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
CREATE TABLE `site_peripherals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`driver` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`display_name` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_tested_at` text,
	`last_test_result` text,
	`last_test_details` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_site_peripherals_tenant_site_kind` ON `site_peripherals` (`tenant_id`,`site_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_site_peripherals_tenant_kind` ON `site_peripherals` (`tenant_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_peripherals_active_per_kind` ON `site_peripherals` (`tenant_id`,`site_id`,`kind`) WHERE "site_peripherals"."is_active" = 1;--> statement-breakpoint
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
CREATE TABLE `sync_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`conflict_policy` text DEFAULT 'auto_lww' NOT NULL,
	`payload` text NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text,
	`device_id` text,
	`depends_on_operation_id` text,
	`operation_event_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`priority` real DEFAULT 0 NOT NULL,
	`claim_token` text,
	`locked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`operation_event_id`) REFERENCES `operation_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sync_outbox_tenant_status_retry` ON `sync_outbox` (`tenant_id`,`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_sync_outbox_entity` ON `sync_outbox` (`entity_type`,`entity_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_sync_outbox_tenant_created` ON `sync_outbox` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_outbox_idempotent` ON `sync_outbox` (`tenant_id`,`entity_type`,`entity_id`,`operation`,`idempotency_key`) WHERE "sync_outbox"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `system_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`status` text NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_system_audit_logs_action_created` ON `system_audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_system_audit_logs_resource_created` ON `system_audit_logs` (`resource_type`,`resource_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_system_audit_logs_status_created` ON `system_audit_logs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `tenant_locale_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`country_code` text NOT NULL,
	`locale_override` text,
	`currency_override` text,
	`timezone_override` text,
	`first_day_of_week_override` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`country_code`) REFERENCES `country_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency_override`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`settings` text DEFAULT '{}',
	`default_currency_code` text DEFAULT 'COP' NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`default_currency_code`) REFERENCES `currency_catalog`(`code`) ON UPDATE no action ON DELETE no action
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
CREATE UNIQUE INDEX `idx_vat_rates_tenant_name` ON `vat_rates` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `web_vital_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`tenant_plan` text DEFAULT 'unknown' NOT NULL,
	`route` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`rating` text NOT NULL,
	`device_class` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_web_vital_samples_tenant_metric_created` ON `web_vital_samples` (`tenant_id`,`metric`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_web_vital_samples_metric_created` ON `web_vital_samples` (`metric`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_web_vital_samples_route` ON `web_vital_samples` (`route`);--> statement-breakpoint
CREATE TABLE `webhook_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_version` integer DEFAULT 1 NOT NULL,
	`operation_event_id` text,
	`payload` text NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`priority` real DEFAULT 0 NOT NULL,
	`claim_token` text,
	`locked_at` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_event_id`) REFERENCES `operation_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_outbox_tenant_status_retry` ON `webhook_outbox` (`tenant_id`,`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_webhook_outbox_tenant_created` ON `webhook_outbox` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webhook_outbox_idempotent` ON `webhook_outbox` (`tenant_id`,`event_type`,`idempotency_key`) WHERE "webhook_outbox"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `whats_new_acks` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`acknowledged_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `whats_new_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_whats_new_acks_unique` ON `whats_new_acks` (`entry_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `whats_new_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`version` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`published_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_whats_new_entries_tenant_published` ON `whats_new_entries` (`tenant_id`,`published_at`);