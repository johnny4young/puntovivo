-- ENG-039d — restaurant tip / propina columns on sales.
--
-- First slice of the originally-bundled ENG-039d (tip + modifiers +
-- service charge math). This migration ships ONLY tip support so the
-- modifiers and service-charge concerns can move under ENG-039d2 / d3.
--
-- `tip_amount` is the resolved currency amount the customer added on
-- top of the line totals. `tip_method` records how the operator picked
-- it (`percentage` vs `fixed`) for reporting and audit; NULL means no
-- tip was captured (default behavior for retail tenants that ignore the
-- input). Existing rows backfill to (0, NULL) so non-restaurant tenants
-- pass through unchanged.
--
-- Both columns are nullable in SQLite terms because we use explicit
-- DEFAULTs; existing receipt rendering already accounts for `sale.tip`
-- via the receipt-renderer's RenderSale shape, so the only persistence
-- gap was on the write side.

ALTER TABLE `sales` ADD COLUMN `tip_amount` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `sales` ADD COLUMN `tip_method` text;
