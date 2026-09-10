ALTER TABLE `inventory_movements` ADD `site_id` text REFERENCES sites(id);--> statement-breakpoint
-- Backfill only when an immutable domain aggregate identifies the site.
-- Literal/manual references and historical transfers stay NULL rather than
-- inventing attribution that the old ledger did not preserve.
UPDATE `inventory_movements` AS `movement`
SET `site_id` = (
  SELECT `cash_session`.`site_id`
  FROM `sales` AS `sale`
  INNER JOIN `cash_sessions` AS `cash_session` ON `cash_session`.`id` = `sale`.`cash_session_id`
  WHERE `sale`.`tenant_id` = `movement`.`tenant_id`
    AND `cash_session`.`tenant_id` = `movement`.`tenant_id`
    AND (`sale`.`id` = `movement`.`reference` OR `sale`.`sale_number` = `movement`.`reference`)
  LIMIT 1
)
WHERE `movement`.`site_id` IS NULL
  AND `movement`.`type` IN ('sale', 'return', 'adjustment')
  AND EXISTS (
    SELECT 1
    FROM `sales` AS `sale`
    INNER JOIN `cash_sessions` AS `cash_session` ON `cash_session`.`id` = `sale`.`cash_session_id`
    WHERE `sale`.`tenant_id` = `movement`.`tenant_id`
      AND `cash_session`.`tenant_id` = `movement`.`tenant_id`
      AND (`sale`.`id` = `movement`.`reference` OR `sale`.`sale_number` = `movement`.`reference`)
  );--> statement-breakpoint
UPDATE `inventory_movements` AS `movement`
SET `site_id` = (
  SELECT `purchase`.`site_id`
  FROM `purchases` AS `purchase`
  WHERE `purchase`.`tenant_id` = `movement`.`tenant_id`
    AND (`purchase`.`id` = `movement`.`reference` OR `purchase`.`purchase_number` = `movement`.`reference`)
  LIMIT 1
)
WHERE `movement`.`site_id` IS NULL
  AND `movement`.`type` IN ('purchase', 'return', 'adjustment')
  AND EXISTS (
    SELECT 1
    FROM `purchases` AS `purchase`
    WHERE `purchase`.`tenant_id` = `movement`.`tenant_id`
      AND (`purchase`.`id` = `movement`.`reference` OR `purchase`.`purchase_number` = `movement`.`reference`)
  );--> statement-breakpoint
UPDATE `inventory_movements` AS `movement`
SET `site_id` = (
  SELECT `purchase`.`site_id`
  FROM `purchase_returns` AS `purchase_return`
  INNER JOIN `purchases` AS `purchase` ON `purchase`.`id` = `purchase_return`.`purchase_id`
  WHERE `purchase_return`.`tenant_id` = `movement`.`tenant_id`
    AND `purchase_return`.`id` = `movement`.`reference`
  LIMIT 1
)
WHERE `movement`.`site_id` IS NULL
  AND `movement`.`type` = 'return'
  AND EXISTS (
    SELECT 1
    FROM `purchase_returns` AS `purchase_return`
    INNER JOIN `purchases` AS `purchase` ON `purchase`.`id` = `purchase_return`.`purchase_id`
    WHERE `purchase_return`.`tenant_id` = `movement`.`tenant_id`
      AND `purchase_return`.`id` = `movement`.`reference`
  );--> statement-breakpoint
UPDATE `inventory_movements` AS `movement`
SET `site_id` = (
  SELECT `entry`.`site_id`
  FROM `initial_inventory` AS `entry`
  WHERE `entry`.`tenant_id` = `movement`.`tenant_id`
    AND `entry`.`id` = `movement`.`reference`
  LIMIT 1
)
WHERE `movement`.`site_id` IS NULL
  AND `movement`.`type` = 'adjustment'
  AND EXISTS (
    SELECT 1
    FROM `initial_inventory` AS `entry`
    WHERE `entry`.`tenant_id` = `movement`.`tenant_id`
      AND `entry`.`id` = `movement`.`reference`
  );--> statement-breakpoint
CREATE INDEX `idx_inventory_movements_tenant_site_created` ON `inventory_movements` (`tenant_id`,`site_id`,`created_at`);
