-- ENG-091 — delivery_orders: per-site delivery queue. Status flows
-- accepted → preparing → dispatched → delivered with cancelled
-- reachable from any state. Phase 5 extension promoted to active
-- backlog. Module-gated `delivery` (default OFF) is wired through
-- client_module_settings; UI lands as a follow-up on `/delivery`.
--
-- IF NOT EXISTS keeps the statement idempotent against the ENG-002
-- adoption shim.

CREATE TABLE IF NOT EXISTS `delivery_orders` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `site_id` text NOT NULL REFERENCES `sites`(`id`),
  `customer_id` text REFERENCES `customers`(`id`),
  `customer_name` text NOT NULL,
  `customer_phone` text,
  `address` text NOT NULL,
  `address_notes` text,
  `courier_name` text,
  `status` text NOT NULL DEFAULT 'accepted',
  `total_amount` real NOT NULL DEFAULT 0,
  `items_snapshot` text,
  `sale_id` text REFERENCES `sales`(`id`),
  `accepted_at` text NOT NULL DEFAULT (datetime('now')),
  `preparing_at` text,
  `dispatched_at` text,
  `delivered_at` text,
  `cancelled_at` text,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_delivery_orders_tenant_site_status`
  ON `delivery_orders` (`tenant_id`, `site_id`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_delivery_orders_tenant_accepted`
  ON `delivery_orders` (`tenant_id`, `accepted_at`);
