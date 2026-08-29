ALTER TABLE `sales` ADD `price_tier` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Existing drafts were priced from their attached customer's tier under the
-- legacy contract. Preserve that completion reference during upgrade; settled
-- historical sales keep the conservative retail default because a customer's
-- current tier is not trustworthy historical evidence.
UPDATE `sales`
SET `price_tier` = COALESCE(
  (
    SELECT CASE
      WHEN `customers`.`price_tier` IN (1, 2, 3) THEN `customers`.`price_tier`
      ELSE 1
    END
    FROM `customers`
    WHERE `customers`.`id` = `sales`.`customer_id`
      AND `customers`.`tenant_id` = `sales`.`tenant_id`
  ),
  1
)
WHERE `sales`.`status` = 'draft';
