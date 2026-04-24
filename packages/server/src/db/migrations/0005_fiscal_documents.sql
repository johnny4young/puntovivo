-- ENG-020 Phase B — fiscal documents domain (Colombia DIAN MVP).
--
-- Four tenant-scoped tables that together model the fiscal-document
-- lifecycle without committing to any specific Proveedor Tecnológico.
-- ENG-021 (Fase B) swaps the `MockAdapter` implementation behind the
-- `FiscalAdapter` interface for a real PT integration — the tables
-- themselves do not change shape.
--
-- Immutability contract: once a `fiscal_documents` row is inserted,
-- only the orchestrator's narrow set of status transitions may touch
-- it. Buyer and line snapshots are FROZEN at issuance time so later
-- mutations of the `customers` / `products` rows cannot alter the
-- emitted fiscal record. This is a legal requirement under DIAN
-- Resolución 165/2023.
CREATE TABLE IF NOT EXISTS `fiscal_numbering_resolutions` (
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
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fiscal_resolutions_tenant` ON `fiscal_numbering_resolutions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fiscal_resolutions_site_kind` ON `fiscal_numbering_resolutions` (`site_id`,`kind`,`is_active`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fiscal_certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`alias` text NOT NULL,
	`p12_ref` text NOT NULL,
	`passphrase_ref` text NOT NULL,
	`subject_dn` text,
	`valid_from` text NOT NULL,
	`valid_until` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fiscal_certificates_tenant` ON `fiscal_certificates` (`tenant_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fiscal_documents` (
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
	FOREIGN KEY (`buyer_tax_id_type_code`) REFERENCES `dian_identification_types`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`emitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fiscal_documents_tenant` ON `fiscal_documents` (`tenant_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fiscal_documents_source` ON `fiscal_documents` (`source`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_fiscal_documents_cufe` ON `fiscal_documents` (`cufe`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_fiscal_documents_tenant_doc` ON `fiscal_documents` (`tenant_id`,`document_number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fiscal_documents_status` ON `fiscal_documents` (`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fiscal_document_items` (
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
	FOREIGN KEY (`fiscal_document_id`) REFERENCES `fiscal_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_fiscal_document_items_doc` ON `fiscal_document_items` (`fiscal_document_id`);
