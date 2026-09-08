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
-- fully tendered is paid, and anything short of the total is partial. This is
-- the same derivation the pending-payments KPI uses, so the migrated rows
-- agree with how the KPI will read them from now on.
--
-- The derivation only runs for rows that HAVE tender rows. A sale written
-- before `sale_payments` existed has none, and an unguarded SUM over zero
-- rows is 0 - which would have labelled every such ticket `pending`, that is,
-- still owed, on no evidence at all. Inventing a receivable against a legacy
-- ticket that was very likely collected in cash is worse than admitting the
-- state is unknown, so those rows keep their legacy sentinel: the
-- `payment_status` enum deliberately still carries `partially_refunded` and
-- `refunded` for exactly these historical rows.
UPDATE `sales`
SET `payment_status` = CASE
  WHEN (
    SELECT COALESCE(SUM(sp.`amount`), 0)
    FROM `sale_payments` sp
    WHERE sp.`sale_id` = `sales`.`id` AND sp.`tenant_id` = `sales`.`tenant_id`
  ) >= round(`sales`.`total`, 2) THEN 'paid'
  -- Reachable only when tender rows exist and net to nothing (a tender fully
  -- reversed), which IS evidence the ticket is uncollected.
  WHEN (
    SELECT COALESCE(SUM(sp.`amount`), 0)
    FROM `sale_payments` sp
    WHERE sp.`sale_id` = `sales`.`id` AND sp.`tenant_id` = `sales`.`tenant_id`
  ) <= 0 THEN 'pending'
  ELSE 'partial'
END
WHERE `return_state` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `sale_payments` sp
    WHERE sp.`sale_id` = `sales`.`id` AND sp.`tenant_id` = `sales`.`tenant_id`
  );--> statement-breakpoint
CREATE INDEX `idx_sales_tenant_return_state` ON `sales` (`tenant_id`,`return_state`);
