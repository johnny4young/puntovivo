ALTER TABLE `cash_sessions` ADD `pace_items_per_minute` real;--> statement-breakpoint
ALTER TABLE `sales` ADD `checkout_started_at` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `checkout_completed_at` text;--> statement-breakpoint
-- ENG-209 — one-time materialization for historical closed shifts. Future
-- closes write the same aggregate transactionally in closeCashSession.
UPDATE `cash_sessions`
SET `pace_items_per_minute` = round(
  coalesce(
    (
      SELECT sum(`sale_items`.`quantity`)
      FROM `sales`
      LEFT JOIN `sale_items` ON `sale_items`.`sale_id` = `sales`.`id`
      WHERE `sales`.`tenant_id` = `cash_sessions`.`tenant_id`
        AND `sales`.`cash_session_id` = `cash_sessions`.`id`
        AND `sales`.`status` = 'completed'
    ),
    0
  ) / max(
    (julianday(`cash_sessions`.`closed_at`) - julianday(`cash_sessions`.`opened_at`)) * 1440.0,
    1.0
  ),
  2
)
WHERE `cash_sessions`.`status` = 'closed'
  AND `cash_sessions`.`closed_at` IS NOT NULL;
