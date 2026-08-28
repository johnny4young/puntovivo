CREATE TABLE `fiscal_document_item_tax_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`fiscal_document_item_id` text NOT NULL,
	`component_key` text NOT NULL,
	`tax_kind` text NOT NULL,
	`tax_category_code` text NOT NULL,
	`tax_rate` real NOT NULL,
	`taxable_amount` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`position` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fiscal_document_item_id`) REFERENCES `fiscal_document_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_fiscal_item_tax_components_position" CHECK("fiscal_document_item_tax_components"."position" between 0 and 3),
	CONSTRAINT "chk_fiscal_item_tax_components_rate" CHECK("fiscal_document_item_tax_components"."tax_rate" >= 0 and "fiscal_document_item_tax_components"."tax_rate" <= 100),
	CONSTRAINT "chk_fiscal_item_tax_components_base_nonneg" CHECK("fiscal_document_item_tax_components"."taxable_amount" >= 0),
	CONSTRAINT "chk_fiscal_item_tax_components_base_2dec" CHECK(round("fiscal_document_item_tax_components"."taxable_amount", 2) = "fiscal_document_item_tax_components"."taxable_amount"),
	CONSTRAINT "chk_fiscal_item_tax_components_tax_nonneg" CHECK("fiscal_document_item_tax_components"."tax_amount" >= 0),
	CONSTRAINT "chk_fiscal_item_tax_components_tax_2dec" CHECK(round("fiscal_document_item_tax_components"."tax_amount", 2) = "fiscal_document_item_tax_components"."tax_amount")
);
--> statement-breakpoint
CREATE INDEX `idx_fiscal_item_tax_components_tenant_line` ON `fiscal_document_item_tax_components` (`tenant_id`,`fiscal_document_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_item_tax_components_key` ON `fiscal_document_item_tax_components` (`fiscal_document_item_id`,`component_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_item_tax_components_position` ON `fiscal_document_item_tax_components` (`fiscal_document_item_id`,`position`);--> statement-breakpoint
CREATE TABLE `product_tax_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`component_key` text NOT NULL,
	`vat_rate_id` text,
	`tax_kind` text NOT NULL,
	`tax_rate` real NOT NULL,
	`position` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vat_rate_id`) REFERENCES `vat_rates`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_product_tax_components_position" CHECK("product_tax_components"."position" between 0 and 3),
	CONSTRAINT "chk_product_tax_components_rate" CHECK("product_tax_components"."tax_rate" >= 0 and "product_tax_components"."tax_rate" <= 100)
);
--> statement-breakpoint
CREATE INDEX `idx_product_tax_components_tenant_product` ON `product_tax_components` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_tax_components_key` ON `product_tax_components` (`product_id`,`component_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_tax_components_position` ON `product_tax_components` (`product_id`,`position`);--> statement-breakpoint
CREATE TABLE `quotation_item_tax_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`quotation_item_id` text NOT NULL,
	`component_key` text NOT NULL,
	`vat_rate_id` text,
	`tax_kind` text NOT NULL,
	`tax_rate` real NOT NULL,
	`position` integer NOT NULL,
	`taxable_amount` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quotation_item_id`) REFERENCES `quotation_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_quotation_item_tax_components_position" CHECK("quotation_item_tax_components"."position" between 0 and 3),
	CONSTRAINT "chk_quotation_item_tax_components_rate" CHECK("quotation_item_tax_components"."tax_rate" >= 0 and "quotation_item_tax_components"."tax_rate" <= 100),
	CONSTRAINT "chk_quotation_item_tax_components_base_nonneg" CHECK("quotation_item_tax_components"."taxable_amount" >= 0),
	CONSTRAINT "chk_quotation_item_tax_components_base_2dec" CHECK(round("quotation_item_tax_components"."taxable_amount", 2) = "quotation_item_tax_components"."taxable_amount"),
	CONSTRAINT "chk_quotation_item_tax_components_tax_nonneg" CHECK("quotation_item_tax_components"."tax_amount" >= 0),
	CONSTRAINT "chk_quotation_item_tax_components_tax_2dec" CHECK(round("quotation_item_tax_components"."tax_amount", 2) = "quotation_item_tax_components"."tax_amount")
);
--> statement-breakpoint
CREATE INDEX `idx_quotation_item_tax_components_tenant_line` ON `quotation_item_tax_components` (`tenant_id`,`quotation_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quotation_item_tax_components_key` ON `quotation_item_tax_components` (`quotation_item_id`,`component_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quotation_item_tax_components_position` ON `quotation_item_tax_components` (`quotation_item_id`,`position`);--> statement-breakpoint
CREATE TABLE `sale_item_tax_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`component_key` text NOT NULL,
	`vat_rate_id` text,
	`tax_kind` text NOT NULL,
	`tax_rate` real NOT NULL,
	`position` integer NOT NULL,
	`taxable_amount` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_sale_item_tax_components_position" CHECK("sale_item_tax_components"."position" between 0 and 3),
	CONSTRAINT "chk_sale_item_tax_components_rate" CHECK("sale_item_tax_components"."tax_rate" >= 0 and "sale_item_tax_components"."tax_rate" <= 100),
	CONSTRAINT "chk_sale_item_tax_components_base_nonneg" CHECK("sale_item_tax_components"."taxable_amount" >= 0),
	CONSTRAINT "chk_sale_item_tax_components_base_2dec" CHECK(round("sale_item_tax_components"."taxable_amount", 2) = "sale_item_tax_components"."taxable_amount"),
	CONSTRAINT "chk_sale_item_tax_components_tax_nonneg" CHECK("sale_item_tax_components"."tax_amount" >= 0),
	CONSTRAINT "chk_sale_item_tax_components_tax_2dec" CHECK(round("sale_item_tax_components"."tax_amount", 2) = "sale_item_tax_components"."tax_amount")
);
--> statement-breakpoint
CREATE INDEX `idx_sale_item_tax_components_tenant_line` ON `sale_item_tax_components` (`tenant_id`,`sale_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_item_tax_components_key` ON `sale_item_tax_components` (`sale_item_id`,`component_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_item_tax_components_position` ON `sale_item_tax_components` (`sale_item_id`,`position`);
--> statement-breakpoint
INSERT INTO `product_tax_components` (
	`id`, `tenant_id`, `product_id`, `component_key`, `vat_rate_id`, `tax_kind`, `tax_rate`, `position`, `created_at`, `updated_at`
)
SELECT
	'ptc:' || p.`id`,
	p.`tenant_id`,
	p.`id`,
	CASE
		WHEN p.`vat_rate_id` IS NOT NULL THEN 'vat:' || p.`vat_rate_id`
		ELSE 'legacy:' || p.`tax_kind` || ':' || printf('%.6f', p.`tax_rate`)
	END,
	p.`vat_rate_id`,
	p.`tax_kind`,
	p.`tax_rate`,
	0,
	p.`created_at`,
	p.`updated_at`
FROM `products` p
WHERE NOT EXISTS (
	SELECT 1 FROM `product_tax_components` c WHERE c.`product_id` = p.`id`
);
--> statement-breakpoint
INSERT INTO `sale_item_tax_components` (
	`id`, `tenant_id`, `sale_item_id`, `component_key`, `vat_rate_id`, `tax_kind`, `tax_rate`, `position`, `taxable_amount`, `tax_amount`, `created_at`
)
SELECT
	'stc:' || i.`id`,
	s.`tenant_id`,
	i.`id`,
	'legacy:' || i.`tax_kind` || ':' || printf('%.6f', i.`tax_rate`),
	NULL,
	i.`tax_kind`,
	i.`tax_rate`,
	0,
	round(i.`total` - i.`tax_amount`, 2),
	i.`tax_amount`,
	s.`created_at`
FROM `sale_items` i
INNER JOIN `sales` s ON s.`id` = i.`sale_id`
WHERE NOT EXISTS (
	SELECT 1 FROM `sale_item_tax_components` c WHERE c.`sale_item_id` = i.`id`
);
--> statement-breakpoint
INSERT INTO `quotation_item_tax_components` (
	`id`, `tenant_id`, `quotation_item_id`, `component_key`, `vat_rate_id`, `tax_kind`, `tax_rate`, `position`, `taxable_amount`, `tax_amount`, `created_at`
)
SELECT
	'qtc:' || i.`id`,
	q.`tenant_id`,
	i.`id`,
	'legacy:' || i.`tax_kind` || ':' || printf('%.6f', i.`tax_rate`),
	NULL,
	i.`tax_kind`,
	i.`tax_rate`,
	0,
	round(i.`total` - i.`tax_amount`, 2),
	i.`tax_amount`,
	i.`created_at`
FROM `quotation_items` i
INNER JOIN `quotations` q ON q.`id` = i.`quotation_id`
WHERE NOT EXISTS (
	SELECT 1 FROM `quotation_item_tax_components` c WHERE c.`quotation_item_id` = i.`id`
);
--> statement-breakpoint
INSERT INTO `fiscal_document_item_tax_components` (
	`id`, `tenant_id`, `fiscal_document_item_id`, `component_key`, `tax_kind`, `tax_category_code`, `tax_rate`, `position`, `taxable_amount`, `tax_amount`, `created_at`
)
SELECT
	'ftc:' || i.`id`,
	d.`tenant_id`,
	i.`id`,
	'legacy:' || CASE WHEN i.`tax_category_code` = '04' THEN 'inc' ELSE 'iva' END || ':' || printf('%.6f', i.`tax_rate`),
	CASE WHEN i.`tax_category_code` = '04' THEN 'inc' ELSE 'iva' END,
	i.`tax_category_code`,
	i.`tax_rate`,
	0,
	round(i.`line_total` - i.`tax_amount`, 2),
	i.`tax_amount`,
	d.`emitted_at`
FROM `fiscal_document_items` i
INNER JOIN `fiscal_documents` d ON d.`id` = i.`fiscal_document_id`
WHERE NOT EXISTS (
	SELECT 1 FROM `fiscal_document_item_tax_components` c WHERE c.`fiscal_document_item_id` = i.`id`
);
