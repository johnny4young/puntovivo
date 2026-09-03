CREATE TABLE `inventory_lot_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`event_type` text NOT NULL,
	`previous_status` text,
	`next_status` text NOT NULL,
	`quantity_snapshot` real NOT NULL,
	`reason` text NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`actor_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_inventory_lot_event_quantity_nonnegative" CHECK("inventory_lot_events"."quantity_snapshot" >= 0),
	CONSTRAINT "chk_inventory_lot_event_type" CHECK("inventory_lot_events"."event_type" in ('activation', 'quarantine', 'release', 'expiration', 'recall', 'destruction', 'supplier_return', 'cold_chain_incident')),
	CONSTRAINT "chk_inventory_lot_event_status" CHECK("inventory_lot_events"."next_status" in ('active', 'depleted', 'expired', 'quarantined', 'recalled') and ("inventory_lot_events"."previous_status" is null or "inventory_lot_events"."previous_status" in ('active', 'depleted', 'expired', 'quarantined', 'recalled')))
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_lot_events_tenant_lot` ON `inventory_lot_events` (`tenant_id`,`lot_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_lot_events_tenant_type` ON `inventory_lot_events` (`tenant_id`,`event_type`);--> statement-breakpoint
CREATE TABLE `pharmacy_dispensations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`product_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`classification` text NOT NULL,
	`policy_version` text NOT NULL,
	`quantity` real NOT NULL,
	`business_date` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `pharmacy_prescription_evidence`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`authorization_id`) REFERENCES `pharmacy_professional_authorizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_dispensation_quantity_positive" CHECK("pharmacy_dispensations"."quantity" > 0),
	CONSTRAINT "chk_pharmacy_dispensation_classification" CHECK("pharmacy_dispensations"."classification" in ('otc', 'prescription', 'controlled')),
	CONSTRAINT "chk_pharmacy_dispensation_business_date" CHECK(length("pharmacy_dispensations"."business_date") = 10 and date("pharmacy_dispensations"."business_date") = "pharmacy_dispensations"."business_date")
);
--> statement-breakpoint
CREATE INDEX `idx_pharmacy_dispensations_tenant_sale` ON `pharmacy_dispensations` (`tenant_id`,`sale_id`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_dispensations_tenant_product` ON `pharmacy_dispensations` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pharmacy_dispensations_line_evidence` ON `pharmacy_dispensations` (`tenant_id`,`sale_item_id`,`evidence_id`);--> statement-breakpoint
CREATE TABLE `pharmacy_evidence_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_material` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "chk_pharmacy_evidence_key_id" CHECK("pharmacy_evidence_keys"."id" = 'evidence-v1'),
	CONSTRAINT "chk_pharmacy_evidence_key_strength" CHECK(length(cast("pharmacy_evidence_keys"."secret_material" as blob)) >= 32)
);
--> statement-breakpoint
CREATE TABLE `pharmacy_prescription_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`country_code` text NOT NULL,
	`policy_version` text NOT NULL,
	`reference_digest` text NOT NULL,
	`sealed_evidence` text NOT NULL,
	`authorized_quantity` real NOT NULL,
	`dispensed_quantity` real DEFAULT 0 NOT NULL,
	`valid_from` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`approved_by` text,
	`approval_authorization_id` text,
	`created_by` text NOT NULL,
	`revoked_by` text,
	`revoked_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_authorization_id`) REFERENCES `pharmacy_professional_authorizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_evidence_authorized_positive" CHECK("pharmacy_prescription_evidence"."authorized_quantity" > 0),
	CONSTRAINT "chk_pharmacy_evidence_dispensed_nonnegative" CHECK("pharmacy_prescription_evidence"."dispensed_quantity" >= 0),
	CONSTRAINT "chk_pharmacy_evidence_dispensed_within_authorized" CHECK("pharmacy_prescription_evidence"."dispensed_quantity" <= "pharmacy_prescription_evidence"."authorized_quantity"),
	CONSTRAINT "chk_pharmacy_evidence_date_order" CHECK("pharmacy_prescription_evidence"."expires_at" >= "pharmacy_prescription_evidence"."valid_from"),
	CONSTRAINT "chk_pharmacy_evidence_dates" CHECK(length("pharmacy_prescription_evidence"."valid_from") = 10 and date("pharmacy_prescription_evidence"."valid_from") = "pharmacy_prescription_evidence"."valid_from" and length("pharmacy_prescription_evidence"."expires_at") = 10 and date("pharmacy_prescription_evidence"."expires_at") = "pharmacy_prescription_evidence"."expires_at"),
	CONSTRAINT "chk_pharmacy_evidence_country" CHECK(length("pharmacy_prescription_evidence"."country_code") = 2 and "pharmacy_prescription_evidence"."country_code" = upper("pharmacy_prescription_evidence"."country_code") and "pharmacy_prescription_evidence"."country_code" glob '[A-Z][A-Z]'),
	CONSTRAINT "chk_pharmacy_evidence_state" CHECK(("pharmacy_prescription_evidence"."status" = 'pending' and "pharmacy_prescription_evidence"."approved_by" is null and "pharmacy_prescription_evidence"."approval_authorization_id" is null and "pharmacy_prescription_evidence"."revoked_by" is null and "pharmacy_prescription_evidence"."revoked_at" is null) or ("pharmacy_prescription_evidence"."status" = 'approved' and "pharmacy_prescription_evidence"."approved_by" is not null and "pharmacy_prescription_evidence"."approval_authorization_id" is not null and "pharmacy_prescription_evidence"."revoked_by" is null and "pharmacy_prescription_evidence"."revoked_at" is null) or ("pharmacy_prescription_evidence"."status" = 'consumed' and "pharmacy_prescription_evidence"."approved_by" is not null and "pharmacy_prescription_evidence"."approval_authorization_id" is not null and "pharmacy_prescription_evidence"."revoked_by" is null and "pharmacy_prescription_evidence"."revoked_at" is null and "pharmacy_prescription_evidence"."dispensed_quantity" = "pharmacy_prescription_evidence"."authorized_quantity") or ("pharmacy_prescription_evidence"."status" = 'revoked' and "pharmacy_prescription_evidence"."revoked_by" is not null and "pharmacy_prescription_evidence"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `idx_pharmacy_evidence_tenant_product` ON `pharmacy_prescription_evidence` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_evidence_customer_status` ON `pharmacy_prescription_evidence` (`tenant_id`,`customer_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_evidence_checkout` ON `pharmacy_prescription_evidence` (`tenant_id`,`customer_id`,`product_id`,`country_code`,`policy_version`,`status`,`expires_at`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pharmacy_evidence_reference` ON `pharmacy_prescription_evidence` (`tenant_id`,`product_id`,`reference_digest`);--> statement-breakpoint
CREATE TABLE `pharmacy_product_profiles` (
	`product_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`active_ingredient` text,
	`generic_name` text,
	`concentration` text,
	`dosage_form` text,
	`administration_route` text,
	`presentation` text,
	`manufacturer` text,
	`authorization_holder` text,
	`sanitary_registration` text,
	`sanitary_registration_normalized` text,
	`registration_expires_at` text,
	`classification` text DEFAULT 'otc' NOT NULL,
	`storage_conditions` text,
	`requires_cold_chain` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_profile_classification" CHECK("pharmacy_product_profiles"."classification" in ('otc', 'prescription', 'controlled')),
	CONSTRAINT "chk_pharmacy_profile_registration_date" CHECK("pharmacy_product_profiles"."registration_expires_at" is null or (length("pharmacy_product_profiles"."registration_expires_at") = 10 and date("pharmacy_product_profiles"."registration_expires_at") = "pharmacy_product_profiles"."registration_expires_at"))
);
--> statement-breakpoint
CREATE INDEX `idx_pharmacy_profiles_tenant` ON `pharmacy_product_profiles` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_profiles_ingredient` ON `pharmacy_product_profiles` (`tenant_id`,`active_ingredient`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_profiles_generic` ON `pharmacy_product_profiles` (`tenant_id`,`generic_name`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_profiles_registration` ON `pharmacy_product_profiles` (`tenant_id`,`sanitary_registration_normalized`);--> statement-breakpoint
CREATE TABLE `pharmacy_professional_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text,
	`country_code` text NOT NULL,
	`credential_type` text NOT NULL,
	`credential_digest` text NOT NULL,
	`sealed_credential` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_until` text,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`revoked_by` text,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_authorization_date_order" CHECK("pharmacy_professional_authorizations"."valid_until" is null or "pharmacy_professional_authorizations"."valid_until" >= "pharmacy_professional_authorizations"."valid_from"),
	CONSTRAINT "chk_pharmacy_authorization_dates" CHECK(length("pharmacy_professional_authorizations"."valid_from") = 10 and date("pharmacy_professional_authorizations"."valid_from") = "pharmacy_professional_authorizations"."valid_from" and ("pharmacy_professional_authorizations"."valid_until" is null or (length("pharmacy_professional_authorizations"."valid_until") = 10 and date("pharmacy_professional_authorizations"."valid_until") = "pharmacy_professional_authorizations"."valid_until"))),
	CONSTRAINT "chk_pharmacy_authorization_country" CHECK(length("pharmacy_professional_authorizations"."country_code") = 2 and "pharmacy_professional_authorizations"."country_code" = upper("pharmacy_professional_authorizations"."country_code") and "pharmacy_professional_authorizations"."country_code" glob '[A-Z][A-Z]'),
	CONSTRAINT "chk_pharmacy_authorization_state" CHECK(("pharmacy_professional_authorizations"."status" = 'active' and "pharmacy_professional_authorizations"."revoked_by" is null and "pharmacy_professional_authorizations"."revoked_at" is null) or ("pharmacy_professional_authorizations"."status" = 'revoked' and "pharmacy_professional_authorizations"."revoked_by" is not null and "pharmacy_professional_authorizations"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `idx_pharmacy_auth_tenant_user` ON `pharmacy_professional_authorizations` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_auth_tenant_effective` ON `pharmacy_professional_authorizations` (`tenant_id`,`country_code`,`status`,`valid_from`,`valid_until`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_auth_credential` ON `pharmacy_professional_authorizations` (`tenant_id`,`country_code`,`credential_digest`);--> statement-breakpoint
CREATE TABLE `pharmacy_recall_lots` (
	`recall_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`previous_status` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`recall_id`, `lot_id`),
	FOREIGN KEY (`recall_id`) REFERENCES `pharmacy_recalls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pharmacy_recall_lots_tenant_lot` ON `pharmacy_recall_lots` (`tenant_id`,`lot_id`);--> statement-breakpoint
CREATE TABLE `pharmacy_recalls` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`product_id` text,
	`lot_id` text,
	`provider_id` text,
	`sanitary_registration` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`initiated_by` text NOT NULL,
	`initiated_at` text NOT NULL,
	`closed_by` text,
	`closed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`initiated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_pharmacy_recall_exact_scope" CHECK((case when "pharmacy_recalls"."product_id" is null then 0 else 1 end + case when "pharmacy_recalls"."lot_id" is null then 0 else 1 end + case when "pharmacy_recalls"."provider_id" is null then 0 else 1 end + case when "pharmacy_recalls"."sanitary_registration" is null then 0 else 1 end) = 1),
	CONSTRAINT "chk_pharmacy_recall_scope_matches" CHECK(("pharmacy_recalls"."scope_type" = 'product' and "pharmacy_recalls"."product_id" is not null) or ("pharmacy_recalls"."scope_type" = 'lot' and "pharmacy_recalls"."lot_id" is not null) or ("pharmacy_recalls"."scope_type" = 'provider' and "pharmacy_recalls"."provider_id" is not null) or ("pharmacy_recalls"."scope_type" = 'sanitary_registration' and "pharmacy_recalls"."sanitary_registration" is not null)),
	CONSTRAINT "chk_pharmacy_recall_state" CHECK(("pharmacy_recalls"."status" = 'active' and "pharmacy_recalls"."closed_by" is null and "pharmacy_recalls"."closed_at" is null) or ("pharmacy_recalls"."status" = 'closed' and "pharmacy_recalls"."closed_by" is not null and "pharmacy_recalls"."closed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `idx_pharmacy_recalls_tenant_status` ON `pharmacy_recalls` (`tenant_id`,`status`);
--> statement-breakpoint

-- Frozen regulated records are append-only. Recall-lot membership may gain a
-- destination when an already recalled in-transit batch completes custody,
-- but existing membership is never rewritten. Any future correction or key
-- rotation must ship an explicit migration that replaces these guards inside
-- the same transaction as its verified rewrite.
CREATE TRIGGER `inventory_lot_events_immutable_update`
BEFORE UPDATE ON `inventory_lot_events`
BEGIN
  SELECT RAISE(ABORT, 'inventory_lot_events is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_lot_events_immutable_delete`
BEFORE DELETE ON `inventory_lot_events`
BEGIN
  SELECT RAISE(ABORT, 'inventory_lot_events is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pharmacy_dispensations_immutable_update`
BEFORE UPDATE ON `pharmacy_dispensations`
BEGIN
  SELECT RAISE(ABORT, 'pharmacy_dispensations is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pharmacy_dispensations_immutable_delete`
BEFORE DELETE ON `pharmacy_dispensations`
BEGIN
  SELECT RAISE(ABORT, 'pharmacy_dispensations is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pharmacy_recall_lots_immutable_update`
BEFORE UPDATE ON `pharmacy_recall_lots`
BEGIN
  SELECT RAISE(ABORT, 'pharmacy_recall_lots is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pharmacy_recall_lots_immutable_delete`
BEFORE DELETE ON `pharmacy_recall_lots`
BEGIN
  SELECT RAISE(ABORT, 'pharmacy_recall_lots is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `pharmacy_evidence_keys_immutable_update`
BEFORE UPDATE ON `pharmacy_evidence_keys`
BEGIN
  SELECT RAISE(ABORT, 'pharmacy_evidence_keys requires an explicit re-encryption migration');
END;
--> statement-breakpoint
CREATE TRIGGER `pharmacy_evidence_keys_immutable_delete`
BEFORE DELETE ON `pharmacy_evidence_keys`
BEGIN
  SELECT RAISE(ABORT, 'pharmacy_evidence_keys requires an explicit re-encryption migration');
END;
--> statement-breakpoint

-- Rebuild the tenant-scoped FTS table so medicine lookups cover generic
-- name, active ingredient, manufacturer and sanitary registration. Product
-- and 1:1 profile triggers keep the single FTS row coherent regardless of
-- which half of the aggregate changes first.
DROP TRIGGER IF EXISTS `products_search_fts_ai`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `products_search_fts_ad`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `products_search_fts_au`;
--> statement-breakpoint
DROP TABLE IF EXISTS `product_search_fts`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `product_search_fts` USING fts5(
  `product_id` UNINDEXED,
  `tenant_id` UNINDEXED,
  `tenant_scope`,
  `name`,
  `sku`,
  `barcode`,
  `description`,
  `active_ingredient`,
  `generic_name`,
  `manufacturer`,
  `sanitary_registration`,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);
--> statement-breakpoint
INSERT INTO `product_search_fts`(
  rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
  active_ingredient, generic_name, manufacturer, sanitary_registration
)
SELECT
  p.rowid,
  p.id,
  p.tenant_id,
  't' || lower(hex(cast(p.tenant_id AS blob))),
  p.name,
  p.sku,
  coalesce(p.barcode, ''),
  coalesce(p.description, ''),
  coalesce(pp.active_ingredient, ''),
  coalesce(pp.generic_name, ''),
  coalesce(pp.manufacturer, ''),
  coalesce(pp.sanitary_registration, '')
FROM products p
LEFT JOIN pharmacy_product_profiles pp
  ON pp.product_id = p.id AND pp.tenant_id = p.tenant_id
WHERE p.catalog_type <> 'variant_parent';
--> statement-breakpoint
CREATE TRIGGER `products_search_fts_ai`
AFTER INSERT ON products
WHEN new.catalog_type <> 'variant_parent'
BEGIN
  INSERT INTO `product_search_fts`(
    rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
    active_ingredient, generic_name, manufacturer, sanitary_registration
  ) VALUES (
    new.rowid, new.id, new.tenant_id,
    't' || lower(hex(cast(new.tenant_id AS blob))),
    new.name, new.sku, coalesce(new.barcode, ''), coalesce(new.description, ''),
    '', '', '', ''
  );
END;
--> statement-breakpoint
CREATE TRIGGER `products_search_fts_ad`
AFTER DELETE ON products
WHEN old.catalog_type <> 'variant_parent'
BEGIN
  DELETE FROM `product_search_fts` WHERE rowid = old.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `products_search_fts_au`
AFTER UPDATE OF id, tenant_id, name, sku, barcode, description, catalog_type ON products
BEGIN
  DELETE FROM `product_search_fts` WHERE rowid = old.rowid;
  INSERT INTO `product_search_fts`(
    rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
    active_ingredient, generic_name, manufacturer, sanitary_registration
  )
  SELECT
    new.rowid, new.id, new.tenant_id,
    't' || lower(hex(cast(new.tenant_id AS blob))),
    new.name, new.sku, coalesce(new.barcode, ''), coalesce(new.description, ''),
    coalesce(pp.active_ingredient, ''), coalesce(pp.generic_name, ''),
    coalesce(pp.manufacturer, ''), coalesce(pp.sanitary_registration, '')
  FROM (SELECT 1) seed
  LEFT JOIN pharmacy_product_profiles pp
    ON pp.product_id = new.id AND pp.tenant_id = new.tenant_id
  WHERE new.catalog_type <> 'variant_parent';
END;
--> statement-breakpoint
CREATE TRIGGER `pharmacy_profiles_search_fts_ai`
AFTER INSERT ON pharmacy_product_profiles
BEGIN
  DELETE FROM `product_search_fts`
  WHERE rowid = (SELECT rowid FROM products WHERE id = new.product_id AND tenant_id = new.tenant_id);
  INSERT INTO `product_search_fts`(
    rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
    active_ingredient, generic_name, manufacturer, sanitary_registration
  )
  SELECT
    p.rowid, p.id, p.tenant_id,
    't' || lower(hex(cast(p.tenant_id AS blob))),
    p.name, p.sku, coalesce(p.barcode, ''), coalesce(p.description, ''),
    coalesce(new.active_ingredient, ''), coalesce(new.generic_name, ''),
    coalesce(new.manufacturer, ''), coalesce(new.sanitary_registration, '')
  FROM products p
  WHERE p.id = new.product_id AND p.tenant_id = new.tenant_id
    AND p.catalog_type <> 'variant_parent';
END;
--> statement-breakpoint
CREATE TRIGGER `pharmacy_profiles_search_fts_au`
AFTER UPDATE OF product_id, tenant_id, active_ingredient, generic_name, manufacturer, sanitary_registration
ON pharmacy_product_profiles
BEGIN
  DELETE FROM `product_search_fts`
  WHERE rowid IN (
    SELECT rowid FROM products
    WHERE (id = old.product_id AND tenant_id = old.tenant_id)
       OR (id = new.product_id AND tenant_id = new.tenant_id)
  );
  INSERT INTO `product_search_fts`(
    rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
    active_ingredient, generic_name, manufacturer, sanitary_registration
  )
  SELECT
    p.rowid, p.id, p.tenant_id,
    't' || lower(hex(cast(p.tenant_id AS blob))),
    p.name, p.sku, coalesce(p.barcode, ''), coalesce(p.description, ''),
    coalesce(new.active_ingredient, ''), coalesce(new.generic_name, ''),
    coalesce(new.manufacturer, ''), coalesce(new.sanitary_registration, '')
  FROM products p
  WHERE p.id = new.product_id AND p.tenant_id = new.tenant_id
    AND p.catalog_type <> 'variant_parent';
END;
--> statement-breakpoint
CREATE TRIGGER `pharmacy_profiles_search_fts_ad`
AFTER DELETE ON pharmacy_product_profiles
BEGIN
  DELETE FROM `product_search_fts`
  WHERE rowid = (SELECT rowid FROM products WHERE id = old.product_id AND tenant_id = old.tenant_id);
  INSERT INTO `product_search_fts`(
    rowid, product_id, tenant_id, tenant_scope, name, sku, barcode, description,
    active_ingredient, generic_name, manufacturer, sanitary_registration
  )
  SELECT
    p.rowid, p.id, p.tenant_id,
    't' || lower(hex(cast(p.tenant_id AS blob))),
    p.name, p.sku, coalesce(p.barcode, ''), coalesce(p.description, ''),
    '', '', '', ''
  FROM products p
  WHERE p.id = old.product_id AND p.tenant_id = old.tenant_id
    AND p.catalog_type <> 'variant_parent';
END;
