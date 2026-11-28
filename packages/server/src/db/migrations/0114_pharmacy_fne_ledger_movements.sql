PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pharmacy_fne_ledger` (
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
	CONSTRAINT "chk_pharmacy_fne_ledger_quantity_delta_finite_quantity" CHECK("__new_pharmacy_fne_ledger"."quantity_delta" IS NULL OR (typeof("__new_pharmacy_fne_ledger"."quantity_delta") IN ('integer', 'real') AND "__new_pharmacy_fne_ledger"."quantity_delta" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_pharmacy_fne_ledger_balance_after_finite_quantity" CHECK("__new_pharmacy_fne_ledger"."balance_after" IS NULL OR (typeof("__new_pharmacy_fne_ledger"."balance_after") IN ('integer', 'real') AND "__new_pharmacy_fne_ledger"."balance_after" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)),
	CONSTRAINT "chk_pharmacy_fne_ledger_date" CHECK(length("__new_pharmacy_fne_ledger"."business_date") = 10 and date("__new_pharmacy_fne_ledger"."business_date") = "__new_pharmacy_fne_ledger"."business_date"),
	CONSTRAINT "chk_pharmacy_fne_ledger_type" CHECK("__new_pharmacy_fne_ledger"."movement_type" in ('receipt', 'supplier_return', 'dispensation', 'return', 'destruction', 'fractionation_out', 'fractionation_in', 'transfer_out', 'transfer_in', 'count_adjustment', 'opening_balance', 'reconciliation')),
	CONSTRAINT "chk_pharmacy_fne_ledger_sign" CHECK(("__new_pharmacy_fne_ledger"."movement_type" in ('receipt', 'return', 'fractionation_in', 'transfer_in', 'opening_balance') and "__new_pharmacy_fne_ledger"."quantity_delta" > 0) or ("__new_pharmacy_fne_ledger"."movement_type" in ('dispensation', 'supplier_return', 'destruction', 'fractionation_out', 'transfer_out') and "__new_pharmacy_fne_ledger"."quantity_delta" < 0) or ("__new_pharmacy_fne_ledger"."movement_type" in ('count_adjustment', 'reconciliation') and "__new_pharmacy_fne_ledger"."quantity_delta" <> 0)),
	CONSTRAINT "chk_pharmacy_fne_ledger_balance" CHECK("__new_pharmacy_fne_ledger"."balance_after" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_pharmacy_fne_ledger`("id", "tenant_id", "site_id", "product_id", "lot_id", "lot_number", "business_date", "movement_type", "quantity_delta", "balance_after", "fne_authorization_id", "sale_id", "evidence_id", "retained_formula_digest", "actor_id", "notes", "occurred_at", "created_at") SELECT "id", "tenant_id", "site_id", "product_id", "lot_id", "lot_number", "business_date", "movement_type", "quantity_delta", "balance_after", "fne_authorization_id", "sale_id", "evidence_id", "retained_formula_digest", "actor_id", "notes", "occurred_at", "created_at" FROM `pharmacy_fne_ledger`;--> statement-breakpoint
DROP TABLE `pharmacy_fne_ledger`;--> statement-breakpoint
ALTER TABLE `__new_pharmacy_fne_ledger` RENAME TO `pharmacy_fne_ledger`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_pharmacy_fne_ledger_tenant_date` ON `pharmacy_fne_ledger` (`tenant_id`,`site_id`,`business_date`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_pharmacy_fne_ledger_tenant_product` ON `pharmacy_fne_ledger` (`tenant_id`,`product_id`,`occurred_at`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_pharmacy_fne_ledger_no_update`
BEFORE UPDATE ON `pharmacy_fne_ledger`
BEGIN
	SELECT RAISE(ABORT, 'pharmacy_fne_ledger rows are immutable');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_pharmacy_fne_ledger_no_delete`
BEFORE DELETE ON `pharmacy_fne_ledger`
BEGIN
	SELECT RAISE(ABORT, 'pharmacy_fne_ledger rows are immutable');
END;
