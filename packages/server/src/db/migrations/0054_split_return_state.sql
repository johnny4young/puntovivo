-- Split return state off payment_status.
--
-- payment_status carried two independent axes at once: how much of the ticket
-- had been COLLECTED (pending / paid / partial) and whether it had been
-- RETURNED (partially_refunded / refunded). Writing the return value destroyed
-- the collection value, so a pending sale that was partially returned stopped
-- reporting the balance still owed and vanished from the pending-payments KPI.
ALTER TABLE `sales` ADD `return_state` text;--> statement-breakpoint
-- Move the return axis to its own column.
UPDATE `sales`
SET `return_state` = `payment_status`
WHERE `payment_status` IN ('partially_refunded', 'refunded');--> statement-breakpoint
-- Recover the collection state that the return value overwrote. It is not
-- recorded anywhere else, so it is derived from the tenders actually taken:
-- fully tendered is paid, nothing tendered is pending, anything between is
-- partial. This is the same derivation the pending-payments KPI uses, so the
-- migrated rows agree with how the KPI will read them from now on.
UPDATE `sales`
SET `payment_status` = CASE
  WHEN (
    SELECT COALESCE(SUM(sp.`amount`), 0)
    FROM `sale_payments` sp
    WHERE sp.`sale_id` = `sales`.`id` AND sp.`tenant_id` = `sales`.`tenant_id`
  ) >= round(`sales`.`total`, 2) THEN 'paid'
  WHEN (
    SELECT COALESCE(SUM(sp.`amount`), 0)
    FROM `sale_payments` sp
    WHERE sp.`sale_id` = `sales`.`id` AND sp.`tenant_id` = `sales`.`tenant_id`
  ) <= 0 THEN 'pending'
  ELSE 'partial'
END
WHERE `return_state` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_sales_tenant_return_state` ON `sales` (`tenant_id`,`return_state`);
