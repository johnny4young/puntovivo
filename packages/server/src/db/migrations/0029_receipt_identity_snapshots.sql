ALTER TABLE `sales` ADD `receipt_identity_snapshot_version` integer;--> statement-breakpoint
ALTER TABLE `sales` ADD `company_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `company_tax_id_snapshot` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `company_address_snapshot` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `company_phone_snapshot` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `company_email_snapshot` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `customer_tax_id_snapshot` text;