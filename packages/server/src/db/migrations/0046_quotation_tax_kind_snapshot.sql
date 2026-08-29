ALTER TABLE `quotation_items` ADD `tax_kind` text DEFAULT 'iva' NOT NULL;--> statement-breakpoint
UPDATE `quotation_items`
SET `tax_kind` = COALESCE(
  (SELECT `products`.`tax_kind`
   FROM `products`
   WHERE `products`.`id` = `quotation_items`.`product_id`),
  'iva'
);
