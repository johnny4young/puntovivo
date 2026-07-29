CREATE TABLE `task_measurement_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`task` text NOT NULL,
	`route` text NOT NULL,
	`task_version` integer DEFAULT 1 NOT NULL,
	`outcome` text NOT NULL,
	`recovery_outcome` text DEFAULT 'not_needed' NOT NULL,
	`device_class` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`time_to_first_usable_control_ms` integer,
	`time_to_first_progress_ms` integer,
	`interactions_to_first_progress` integer,
	`interaction_count` integer DEFAULT 0 NOT NULL,
	`backtrack_count` integer DEFAULT 0 NOT NULL,
	`validation_error_count` integer DEFAULT 0 NOT NULL,
	`recovery_attempt_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_task_measurement_samples_task_version" CHECK("task_measurement_samples"."task_version" >= 1 AND "task_measurement_samples"."task_version" <= 1000),
	CONSTRAINT "chk_task_measurement_samples_task" CHECK("task_measurement_samples"."task" IN ('complete_sale', 'create_product', 'close_day', 'receive_stock', 'recover_operation')),
	CONSTRAINT "chk_task_measurement_samples_route" CHECK("task_measurement_samples"."route" IN ('/sales', '/products', '/day-close', '/purchases', '/operations')),
	CONSTRAINT "chk_task_measurement_samples_task_route" CHECK(("task_measurement_samples"."task" = 'complete_sale' AND "task_measurement_samples"."route" = '/sales')
        OR ("task_measurement_samples"."task" = 'create_product' AND "task_measurement_samples"."route" = '/products')
        OR ("task_measurement_samples"."task" = 'close_day' AND "task_measurement_samples"."route" = '/day-close')
        OR ("task_measurement_samples"."task" = 'receive_stock' AND "task_measurement_samples"."route" = '/purchases')
        OR ("task_measurement_samples"."task" = 'recover_operation' AND "task_measurement_samples"."route" = '/operations')),
	CONSTRAINT "chk_task_measurement_samples_outcome" CHECK("task_measurement_samples"."outcome" IN ('success', 'abandoned', 'failed')),
	CONSTRAINT "chk_task_measurement_samples_recovery_outcome" CHECK("task_measurement_samples"."recovery_outcome" IN ('not_needed', 'succeeded', 'failed', 'abandoned')),
	CONSTRAINT "chk_task_measurement_samples_device_class" CHECK("task_measurement_samples"."device_class" IN ('low', 'mid', 'high', 'unknown')),
	CONSTRAINT "chk_task_measurement_samples_recovery_consistency" CHECK(("task_measurement_samples"."recovery_attempt_count" = 0 AND "task_measurement_samples"."recovery_outcome" = 'not_needed')
        OR ("task_measurement_samples"."recovery_attempt_count" > 0 AND "task_measurement_samples"."recovery_outcome" <> 'not_needed')),
	CONSTRAINT "chk_task_measurement_samples_duration" CHECK("task_measurement_samples"."duration_ms" >= 0 AND "task_measurement_samples"."duration_ms" <= 86400000),
	CONSTRAINT "chk_task_measurement_samples_usable_timing" CHECK("task_measurement_samples"."time_to_first_usable_control_ms" IS NULL OR ("task_measurement_samples"."time_to_first_usable_control_ms" >= 0 AND "task_measurement_samples"."time_to_first_usable_control_ms" <= "task_measurement_samples"."duration_ms")),
	CONSTRAINT "chk_task_measurement_samples_progress_timing" CHECK("task_measurement_samples"."time_to_first_progress_ms" IS NULL OR ("task_measurement_samples"."time_to_first_progress_ms" >= 0 AND "task_measurement_samples"."time_to_first_progress_ms" <= "task_measurement_samples"."duration_ms")),
	CONSTRAINT "chk_task_measurement_samples_first_progress_consistency" CHECK(("task_measurement_samples"."time_to_first_progress_ms" IS NULL AND "task_measurement_samples"."interactions_to_first_progress" IS NULL)
        OR ("task_measurement_samples"."time_to_first_progress_ms" IS NOT NULL
          AND "task_measurement_samples"."interactions_to_first_progress" IS NOT NULL
          AND "task_measurement_samples"."interactions_to_first_progress" >= 0
          AND "task_measurement_samples"."interactions_to_first_progress" <= "task_measurement_samples"."interaction_count")),
	CONSTRAINT "chk_task_measurement_samples_counts" CHECK("task_measurement_samples"."interaction_count" >= 0 AND "task_measurement_samples"."interaction_count" <= 100000
        AND "task_measurement_samples"."backtrack_count" >= 0 AND "task_measurement_samples"."backtrack_count" <= 100000
        AND "task_measurement_samples"."validation_error_count" >= 0 AND "task_measurement_samples"."validation_error_count" <= 100000
        AND "task_measurement_samples"."recovery_attempt_count" >= 0 AND "task_measurement_samples"."recovery_attempt_count" <= 100000)
);
--> statement-breakpoint
CREATE INDEX `idx_task_measurement_samples_tenant_task_created` ON `task_measurement_samples` (`tenant_id`,`task`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_task_measurement_samples_tenant_route_created` ON `task_measurement_samples` (`tenant_id`,`route`,`created_at`);