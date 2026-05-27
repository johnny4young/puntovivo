-- ENG-176c — Fiscal identification catalog rename + status enum expansion.
--
-- Two coupled changes that the audit (docs/AUDIT-2026-05-24.md §ENG-176
-- bullets 3 + 4) flagged as the last gaps blocking multi-country fiscal
-- emission:
--
--   1. Rename `dian_identification_types` → `fiscal_identification_types`
--      and reshape with a composite PK (country_code, code). DIAN
--      (Colombia) '13' = CC, SUNAT (Perú) '1' = DNI, SAT (México) 'RFC' —
--      pre-rename they would collide in the single-column PK space.
--      All 10 existing DIAN rows back-fill to `country_code = 'CO'`.
--      The `fiscal_documents.buyer_tax_id_type_code` FK shifts to a
--      composite reference; a new `buyer_country_code TEXT NOT NULL
--      DEFAULT 'CO'` column joins it. Legacy fiscal_documents rows
--      back-fill to `buyer_country_code = 'CO'` (single-country MVP
--      until today).
--
--   2. Expand `fiscalDocumentStatusEnum` from 5 DIAN-native states to 8
--      (adds `voided`, `notified_correction`, `partial_send`) so SAT
--      cancelaciones, SUNAT envíos parciales, and SII/NFe void
--      lifecycles can be expressed without per-country surrogate
--      columns. SQLite text columns accept any value at the storage
--      layer; the Drizzle enum is enforced at the application boundary
--      (Zod + tRPC inputs), so no migration-level constraint change is
--      required here. The recreated fiscal_documents table picks up the
--      new enum simply by being rebuilt.
--
-- The recreate order is rigid because of the composite FK:
--   a. Recreate `fiscal_identification_types` first (the target).
--   b. Recreate `fiscal_documents` second (the referring table).
-- Both wrapped in PRAGMA foreign_keys = OFF/ON so the FK swap does not
-- trip while the schema is shuffling. The seedFiscalIdentificationTypes
-- step (db/index.ts) populates MX/PE/CL rows after migrations finish on
-- the next boot.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_fiscal_identification_types` (
	`country_code` text NOT NULL,
	`code` text NOT NULL,
	`abbr` text NOT NULL,
	`name_es` text NOT NULL,
	`name_en` text NOT NULL,
	`natural_person` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`country_code`) REFERENCES `country_catalog`(`code`) ON UPDATE no action ON DELETE no action,
	PRIMARY KEY (`country_code`, `code`)
);
--> statement-breakpoint
INSERT INTO `__new_fiscal_identification_types`("country_code", "code", "abbr", "name_es", "name_en", "natural_person") SELECT 'CO', "code", "abbr", "name_es", "name_en", "natural_person" FROM `dian_identification_types`;--> statement-breakpoint
DROP TABLE `dian_identification_types`;--> statement-breakpoint
ALTER TABLE `__new_fiscal_identification_types` RENAME TO `fiscal_identification_types`;--> statement-breakpoint
CREATE TABLE `__new_fiscal_documents` (
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
	FOREIGN KEY (`buyer_country_code`,`buyer_tax_id_type_code`) REFERENCES `fiscal_identification_types`(`country_code`,`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`emitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fiscal_documents_subtotal_nonneg" CHECK("__new_fiscal_documents"."subtotal" >= 0),
	CONSTRAINT "chk_fiscal_documents_subtotal_2dec" CHECK(round("__new_fiscal_documents"."subtotal", 2) = "__new_fiscal_documents"."subtotal"),
	CONSTRAINT "chk_fiscal_documents_tax_nonneg" CHECK("__new_fiscal_documents"."tax_amount" >= 0),
	CONSTRAINT "chk_fiscal_documents_tax_2dec" CHECK(round("__new_fiscal_documents"."tax_amount", 2) = "__new_fiscal_documents"."tax_amount"),
	CONSTRAINT "chk_fiscal_documents_discount_nonneg" CHECK("__new_fiscal_documents"."discount_amount" >= 0),
	CONSTRAINT "chk_fiscal_documents_discount_2dec" CHECK(round("__new_fiscal_documents"."discount_amount", 2) = "__new_fiscal_documents"."discount_amount"),
	CONSTRAINT "chk_fiscal_documents_total_nonneg" CHECK("__new_fiscal_documents"."total_amount" >= 0),
	CONSTRAINT "chk_fiscal_documents_total_2dec" CHECK(round("__new_fiscal_documents"."total_amount", 2) = "__new_fiscal_documents"."total_amount")
);
--> statement-breakpoint
INSERT INTO `__new_fiscal_documents`("id", "tenant_id", "source", "source_id", "kind", "resolution_id", "consecutive", "document_number", "cufe", "status", "customer_id", "buyer_tax_id", "buyer_country_code", "buyer_tax_id_type_code", "buyer_name", "buyer_email", "buyer_address", "buyer_city", "buyer_department", "buyer_country", "subtotal", "tax_amount", "discount_amount", "total_amount", "currency_code", "locale_code", "original_cufe", "reason_code", "provider_id", "provider_response", "xml_ref", "retries", "emitted_by_user_id", "emitted_at", "updated_at") SELECT "id", "tenant_id", "source", "source_id", "kind", "resolution_id", "consecutive", "document_number", "cufe", "status", "customer_id", "buyer_tax_id", 'CO', "buyer_tax_id_type_code", "buyer_name", "buyer_email", "buyer_address", "buyer_city", "buyer_department", "buyer_country", "subtotal", "tax_amount", "discount_amount", "total_amount", "currency_code", "locale_code", "original_cufe", "reason_code", "provider_id", "provider_response", "xml_ref", "retries", "emitted_by_user_id", "emitted_at", "updated_at" FROM `fiscal_documents`;--> statement-breakpoint
DROP TABLE `fiscal_documents`;--> statement-breakpoint
ALTER TABLE `__new_fiscal_documents` RENAME TO `fiscal_documents`;--> statement-breakpoint
CREATE INDEX `idx_fiscal_documents_tenant` ON `fiscal_documents` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_documents_source` ON `fiscal_documents` (`source`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_documents_cufe` ON `fiscal_documents` (`cufe`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fiscal_documents_tenant_doc` ON `fiscal_documents` (`tenant_id`,`document_number`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_documents_status` ON `fiscal_documents` (`status`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
