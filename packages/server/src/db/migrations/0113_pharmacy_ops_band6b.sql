CREATE TABLE `pharmacy_customer_allergies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`active_ingredient` text NOT NULL,
	`active_ingredient_normalized` text NOT NULL,
	`severity` text DEFAULT 'moderate' NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_allergy_severity" CHECK("pharmacy_customer_allergies"."severity" in ('mild', 'moderate', 'severe'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pharmacy_customer_allergies_unique` ON `pharmacy_customer_allergies` (`tenant_id`,`customer_id`,`active_ingredient_normalized`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_customer_allergies_tenant_customer` ON `pharmacy_customer_allergies` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `pharmacy_environmental_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`business_date` text NOT NULL,
	`period` text NOT NULL,
	`zone` text NOT NULL,
	`temperature_c` real NOT NULL,
	`humidity_percent` real,
	`min_temp_c` real NOT NULL,
	`max_temp_c` real NOT NULL,
	`max_humidity_percent` real,
	`is_out_of_range` integer DEFAULT false NOT NULL,
	`corrective_action` text,
	`instrument_code` text,
	`notes` text,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_env_date" CHECK(length("pharmacy_environmental_logs"."business_date") = 10 and date("pharmacy_environmental_logs"."business_date") = "pharmacy_environmental_logs"."business_date"),
	CONSTRAINT "chk_pharmacy_env_period" CHECK("pharmacy_environmental_logs"."period" in ('morning', 'afternoon')),
	CONSTRAINT "chk_pharmacy_env_zone" CHECK("pharmacy_environmental_logs"."zone" in ('ambient', 'refrigerator')),
	CONSTRAINT "chk_pharmacy_env_temp_bounds" CHECK("pharmacy_environmental_logs"."min_temp_c" < "pharmacy_environmental_logs"."max_temp_c" and "pharmacy_environmental_logs"."temperature_c" >= -40 and "pharmacy_environmental_logs"."temperature_c" <= 80),
	CONSTRAINT "chk_pharmacy_env_humidity_bounds" CHECK("pharmacy_environmental_logs"."humidity_percent" is null or ("pharmacy_environmental_logs"."humidity_percent" >= 0 and "pharmacy_environmental_logs"."humidity_percent" <= 100))
);
--> statement-breakpoint
CREATE INDEX `idx_pharmacy_env_logs_site_date` ON `pharmacy_environmental_logs` (`tenant_id`,`site_id`,`business_date`,`zone`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_env_logs_out_of_range` ON `pharmacy_environmental_logs` (`tenant_id`,`site_id`,`is_out_of_range`,`business_date`);--> statement-breakpoint
CREATE TABLE `pharmacy_fne_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text,
	`country_code` text NOT NULL,
	`resolution_number` text NOT NULL,
	`issuing_authority` text NOT NULL,
	`responsible_user_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`revoked_by` text,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsible_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_fne_auth_date_order" CHECK("pharmacy_fne_authorizations"."valid_until" is null or "pharmacy_fne_authorizations"."valid_until" >= "pharmacy_fne_authorizations"."valid_from"),
	CONSTRAINT "chk_pharmacy_fne_auth_dates" CHECK(length("pharmacy_fne_authorizations"."valid_from") = 10 and date("pharmacy_fne_authorizations"."valid_from") = "pharmacy_fne_authorizations"."valid_from" and ("pharmacy_fne_authorizations"."valid_until" is null or (length("pharmacy_fne_authorizations"."valid_until") = 10 and date("pharmacy_fne_authorizations"."valid_until") = "pharmacy_fne_authorizations"."valid_until"))),
	CONSTRAINT "chk_pharmacy_fne_auth_country" CHECK(length("pharmacy_fne_authorizations"."country_code") = 2 and "pharmacy_fne_authorizations"."country_code" = upper("pharmacy_fne_authorizations"."country_code") and "pharmacy_fne_authorizations"."country_code" glob '[A-Z][A-Z]'),
	CONSTRAINT "chk_pharmacy_fne_auth_state" CHECK(("pharmacy_fne_authorizations"."status" = 'active' and "pharmacy_fne_authorizations"."revoked_by" is null and "pharmacy_fne_authorizations"."revoked_at" is null) or ("pharmacy_fne_authorizations"."status" = 'revoked' and "pharmacy_fne_authorizations"."revoked_by" is not null and "pharmacy_fne_authorizations"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `idx_pharmacy_fne_auth_tenant_effective` ON `pharmacy_fne_authorizations` (`tenant_id`,`country_code`,`status`,`valid_from`,`valid_until`);--> statement-breakpoint
CREATE TABLE `pharmacy_fne_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lot_id` text,
	`lot_number` text,
	`business_date` text NOT NULL,
	`movement_type` text NOT NULL,
	`quantity_delta` real NOT NULL,
	`balance_after` real NOT NULL,
	`fne_authorization_id` text,
	`sale_id` text,
	`evidence_id` text,
	`retained_formula_digest` text,
	`actor_id` text NOT NULL,
	`notes` text,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fne_authorization_id`) REFERENCES `pharmacy_fne_authorizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `pharmacy_prescription_evidence`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_fne_ledger_quantity_delta_finite_quantity" CHECK("pharmacy_fne_ledger"."quantity_delta" IS NULL OR (typeof("pharmacy_fne_ledger"."quantity_delta") IN ('integer', 'real') AND "pharmacy_fne_ledger"."quantity_delta" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_pharmacy_fne_ledger_balance_after_finite_quantity" CHECK("pharmacy_fne_ledger"."balance_after" IS NULL OR (typeof("pharmacy_fne_ledger"."balance_after") IN ('integer', 'real') AND "pharmacy_fne_ledger"."balance_after" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_pharmacy_fne_ledger_date" CHECK(length("pharmacy_fne_ledger"."business_date") = 10 and date("pharmacy_fne_ledger"."business_date") = "pharmacy_fne_ledger"."business_date"),
	CONSTRAINT "chk_pharmacy_fne_ledger_type" CHECK("pharmacy_fne_ledger"."movement_type" in ('receipt', 'supplier_return', 'dispensation', 'return', 'destruction', 'fractionation_out', 'fractionation_in')),
	CONSTRAINT "chk_pharmacy_fne_ledger_sign" CHECK(("pharmacy_fne_ledger"."movement_type" in ('receipt', 'return', 'fractionation_in') and "pharmacy_fne_ledger"."quantity_delta" > 0) or ("pharmacy_fne_ledger"."movement_type" in ('dispensation', 'supplier_return', 'destruction', 'fractionation_out') and "pharmacy_fne_ledger"."quantity_delta" < 0)),
	CONSTRAINT "chk_pharmacy_fne_ledger_balance" CHECK("pharmacy_fne_ledger"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_pharmacy_fne_ledger_tenant_date` ON `pharmacy_fne_ledger` (`tenant_id`,`site_id`,`business_date`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_fne_ledger_tenant_product` ON `pharmacy_fne_ledger` (`tenant_id`,`product_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `pharmacy_invima_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`cum_code` text NOT NULL,
	`cum_normalized` text NOT NULL,
	`product_name` text NOT NULL,
	`active_ingredient` text NOT NULL,
	`concentration` text,
	`dosage_form` text,
	`administration_route` text,
	`presentation` text,
	`doses_per_pack` integer,
	`manufacturer` text,
	`authorization_holder` text,
	`sanitary_registration` text NOT NULL,
	`sanitary_registration_normalized` text NOT NULL,
	`registration_status` text DEFAULT 'vigente' NOT NULL,
	`registration_expires_at` text,
	`classification` text DEFAULT 'otc' NOT NULL,
	`imported_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_invima_status" CHECK("pharmacy_invima_catalog"."registration_status" in ('vigente', 'en_tramite_renovacion', 'vencido', 'cancelado', 'suspendido')),
	CONSTRAINT "chk_pharmacy_invima_classification" CHECK("pharmacy_invima_catalog"."classification" in ('otc', 'prescription', 'controlled')),
	CONSTRAINT "chk_pharmacy_invima_doses" CHECK("pharmacy_invima_catalog"."doses_per_pack" is null or "pharmacy_invima_catalog"."doses_per_pack" > 0),
	CONSTRAINT "chk_pharmacy_invima_expiry" CHECK("pharmacy_invima_catalog"."registration_expires_at" is null or (length("pharmacy_invima_catalog"."registration_expires_at") = 10 and date("pharmacy_invima_catalog"."registration_expires_at") = "pharmacy_invima_catalog"."registration_expires_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pharmacy_invima_tenant_cum` ON `pharmacy_invima_catalog` (`tenant_id`,`cum_normalized`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_invima_tenant_reg` ON `pharmacy_invima_catalog` (`tenant_id`,`sanitary_registration_normalized`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_invima_tenant_ingredient` ON `pharmacy_invima_catalog` (`tenant_id`,`active_ingredient`);--> statement-breakpoint
CREATE TABLE `pharmacy_lot_fractionations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`source_product_id` text NOT NULL,
	`source_lot_id` text NOT NULL,
	`target_product_id` text NOT NULL,
	`target_lot_id` text NOT NULL,
	`source_quantity` real NOT NULL,
	`target_quantity` real NOT NULL,
	`units_per_source` real NOT NULL,
	`source_lot_number` text NOT NULL,
	`target_lot_number` text NOT NULL,
	`expires_at` text,
	`sanitary_registration` text,
	`transferred_value_cents` integer NOT NULL,
	`source_movement_id` text NOT NULL,
	`target_movement_id` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_movement_id`) REFERENCES `inventory_movements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_movement_id`) REFERENCES `inventory_movements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_lot_fractionations_transferred_value_cents_safe_integer" CHECK("pharmacy_lot_fractionations"."transferred_value_cents" IS NULL OR (typeof("pharmacy_lot_fractionations"."transferred_value_cents") = 'integer' AND "pharmacy_lot_fractionations"."transferred_value_cents" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "chk_pharmacy_lot_fractionations_source_quantity_finite_quantity" CHECK("pharmacy_lot_fractionations"."source_quantity" IS NULL OR (typeof("pharmacy_lot_fractionations"."source_quantity") IN ('integer', 'real') AND "pharmacy_lot_fractionations"."source_quantity" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_pharmacy_lot_fractionations_target_quantity_finite_quantity" CHECK("pharmacy_lot_fractionations"."target_quantity" IS NULL OR (typeof("pharmacy_lot_fractionations"."target_quantity") IN ('integer', 'real') AND "pharmacy_lot_fractionations"."target_quantity" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_pharmacy_lot_fractionations_units_per_source_finite_quantity" CHECK("pharmacy_lot_fractionations"."units_per_source" IS NULL OR (typeof("pharmacy_lot_fractionations"."units_per_source") IN ('integer', 'real') AND "pharmacy_lot_fractionations"."units_per_source" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_pharmacy_fractionation_qty_pos" CHECK("pharmacy_lot_fractionations"."source_quantity" > 0 and "pharmacy_lot_fractionations"."target_quantity" > 0 and "pharmacy_lot_fractionations"."units_per_source" > 0),
	CONSTRAINT "chk_pharmacy_fractionation_distinct_products" CHECK("pharmacy_lot_fractionations"."source_product_id" <> "pharmacy_lot_fractionations"."target_product_id")
);
--> statement-breakpoint
CREATE INDEX `idx_pharmacy_fractionations_tenant_site` ON `pharmacy_lot_fractionations` (`tenant_id`,`site_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_fractionations_source_lot` ON `pharmacy_lot_fractionations` (`tenant_id`,`source_lot_id`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_fractionations_target_lot` ON `pharmacy_lot_fractionations` (`tenant_id`,`target_lot_id`);--> statement-breakpoint
ALTER TABLE `pharmacy_product_profiles` ADD `doses_per_pack` integer CHECK (`doses_per_pack` IS NULL OR (typeof(`doses_per_pack`) = 'integer' AND `doses_per_pack` > 0 AND `doses_per_pack` <= 10000));--> statement-breakpoint
ALTER TABLE `pharmacy_product_profiles` ADD `cum_code` text;--> statement-breakpoint
CREATE INDEX `idx_pharmacy_profiles_cum` ON `pharmacy_product_profiles` (`tenant_id`,`cum_code`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_pharmacy_fne_ledger_no_update`
BEFORE UPDATE ON `pharmacy_fne_ledger`
BEGIN
	SELECT RAISE(ABORT, 'pharmacy_fne_ledger rows are immutable');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_pharmacy_fne_ledger_no_delete`
BEFORE DELETE ON `pharmacy_fne_ledger`
BEGIN
	SELECT RAISE(ABORT, 'pharmacy_fne_ledger rows are immutable');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_pharmacy_environmental_logs_no_update`
BEFORE UPDATE ON `pharmacy_environmental_logs`
BEGIN
	SELECT RAISE(ABORT, 'pharmacy_environmental_logs rows are immutable');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_pharmacy_environmental_logs_no_delete`
BEFORE DELETE ON `pharmacy_environmental_logs`
BEGIN
	SELECT RAISE(ABORT, 'pharmacy_environmental_logs rows are immutable');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_pharmacy_lot_fractionations_no_update`
BEFORE UPDATE ON `pharmacy_lot_fractionations`
BEGIN
	SELECT RAISE(ABORT, 'pharmacy_lot_fractionations rows are immutable');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_pharmacy_lot_fractionations_no_delete`
BEFORE DELETE ON `pharmacy_lot_fractionations`
BEGIN
	SELECT RAISE(ABORT, 'pharmacy_lot_fractionations rows are immutable');
END;