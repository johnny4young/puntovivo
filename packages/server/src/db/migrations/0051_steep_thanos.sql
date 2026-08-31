CREATE TABLE `provider_payable_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`source_type` text NOT NULL,
	`payment_id` text,
	`credit_id` text,
	`amount` real NOT NULL,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `provider_payable_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `provider_payable_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credit_id`) REFERENCES `provider_payable_credits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_provider_payable_allocations_amount_positive" CHECK("provider_payable_allocations"."amount" > 0),
	CONSTRAINT "chk_provider_payable_allocations_amount_2dec" CHECK(round("provider_payable_allocations"."amount", 2) = "provider_payable_allocations"."amount"),
	CONSTRAINT "chk_provider_payable_allocations_source" CHECK(("provider_payable_allocations"."source_type" = 'payment' AND "provider_payable_allocations"."payment_id" IS NOT NULL AND "provider_payable_allocations"."credit_id" IS NULL) OR ("provider_payable_allocations"."source_type" = 'credit' AND "provider_payable_allocations"."credit_id" IS NOT NULL AND "provider_payable_allocations"."payment_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_provider_payable_allocations_invoice` ON `provider_payable_allocations` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `idx_provider_payable_allocations_payment` ON `provider_payable_allocations` (`payment_id`);--> statement-breakpoint
CREATE INDEX `idx_provider_payable_allocations_credit` ON `provider_payable_allocations` (`credit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_payable_allocations_payment_invoice` ON `provider_payable_allocations` (`payment_id`,`invoice_id`) WHERE "provider_payable_allocations"."payment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_payable_allocations_credit_invoice` ON `provider_payable_allocations` (`credit_id`,`invoice_id`) WHERE "provider_payable_allocations"."credit_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `provider_payable_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`site_id` text NOT NULL,
	`amount` real NOT NULL,
	`document_number` text NOT NULL,
	`credited_at` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_provider_payable_credits_amount_positive" CHECK("provider_payable_credits"."amount" > 0),
	CONSTRAINT "chk_provider_payable_credits_amount_2dec" CHECK(round("provider_payable_credits"."amount", 2) = "provider_payable_credits"."amount")
);
--> statement-breakpoint
CREATE INDEX `idx_provider_payable_credits_tenant_provider_credited` ON `provider_payable_credits` (`tenant_id`,`provider_id`,`credited_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_payable_credits_provider_document` ON `provider_payable_credits` (`tenant_id`,`provider_id`,`document_number`);--> statement-breakpoint
CREATE TABLE `provider_payable_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`site_id` text NOT NULL,
	`purchase_id` text,
	`kind` text NOT NULL,
	`document_number` text NOT NULL,
	`issued_at` text NOT NULL,
	`due_at` text NOT NULL,
	`amount` real NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_provider_payable_invoices_amount_positive" CHECK("provider_payable_invoices"."amount" > 0),
	CONSTRAINT "chk_provider_payable_invoices_amount_2dec" CHECK(round("provider_payable_invoices"."amount", 2) = "provider_payable_invoices"."amount")
);
--> statement-breakpoint
CREATE INDEX `idx_provider_payable_invoices_tenant_provider_due` ON `provider_payable_invoices` (`tenant_id`,`provider_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_provider_payable_invoices_purchase` ON `provider_payable_invoices` (`purchase_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_payable_invoices_provider_document` ON `provider_payable_invoices` (`tenant_id`,`provider_id`,`document_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_payable_invoices_purchase_unique` ON `provider_payable_invoices` (`tenant_id`,`purchase_id`) WHERE "provider_payable_invoices"."purchase_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `provider_payable_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`site_id` text NOT NULL,
	`amount` real NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`paid_at` text NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`sync_status` text DEFAULT 'pending',
	`sync_version` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_provider_payable_payments_amount_positive" CHECK("provider_payable_payments"."amount" > 0),
	CONSTRAINT "chk_provider_payable_payments_amount_2dec" CHECK(round("provider_payable_payments"."amount", 2) = "provider_payable_payments"."amount")
);
--> statement-breakpoint
CREATE INDEX `idx_provider_payable_payments_tenant_provider_paid` ON `provider_payable_payments` (`tenant_id`,`provider_id`,`paid_at`);--> statement-breakpoint
CREATE TABLE `quotation_sale_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`quotation_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`converted_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`converted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_quotation_sale_links_tenant` ON `quotation_sale_links` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quotation_sale_links_quotation` ON `quotation_sale_links` (`quotation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quotation_sale_links_sale` ON `quotation_sale_links` (`sale_id`);--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `unit_id` text REFERENCES units(id);--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `unit_equivalence` real;--> statement-breakpoint
UPDATE `quotation_items`
SET
	`unit_id` = (
		SELECT `unit_x_product`.`unit_id`
		FROM `unit_x_product`
		WHERE `unit_x_product`.`product_id` = `quotation_items`.`product_id`
			AND `unit_x_product`.`is_base` = 1
		LIMIT 1
	),
	`unit_equivalence` = (
		SELECT `unit_x_product`.`equivalence`
		FROM `unit_x_product`
		WHERE `unit_x_product`.`product_id` = `quotation_items`.`product_id`
			AND `unit_x_product`.`is_base` = 1
		LIMIT 1
	)
WHERE (
	SELECT count(*)
	FROM `unit_x_product`
	WHERE `unit_x_product`.`product_id` = `quotation_items`.`product_id`
		AND `unit_x_product`.`is_base` = 1
) = 1;--> statement-breakpoint
CREATE INDEX `idx_quotation_items_unit` ON `quotation_items` (`unit_id`);
