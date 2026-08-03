ALTER TABLE `ai_audit_log` ADD `cost_state` text DEFAULT 'estimated' NOT NULL;
--> statement-breakpoint
UPDATE `ai_audit_log`
SET `cost_state` = 'local_zero'
WHERE `provider_id` = 'ollama';
--> statement-breakpoint
UPDATE `ai_audit_log`
SET `cost_state` = 'unknown'
WHERE `provider_id` <> 'ollama'
  AND `error_code` IS NOT NULL
  AND `error_code` NOT IN ('AI_DISABLED', 'AI_BUDGET_EXCEEDED', 'AI_EMBEDDING_UNAVAILABLE');
--> statement-breakpoint
UPDATE `ai_audit_log`
SET `cost_state` = 'not_incurred'
WHERE `error_code` IN ('AI_DISABLED', 'AI_BUDGET_EXCEEDED', 'AI_EMBEDDING_UNAVAILABLE');
