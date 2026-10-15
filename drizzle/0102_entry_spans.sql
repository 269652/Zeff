CREATE TABLE `entry_spans` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`mode` text NOT NULL,
	`head_id` integer,
	`head_auto` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `entry_spans_date_idx` ON `entry_spans` (`date`);--> statement-breakpoint
INSERT INTO `entry_spans` (`id`, `date`, `mode`, `head_id`, `head_auto`, `created_at`) SELECT 'g' || `id`, `date`, 'collect', `id`, 0, datetime('now') FROM `time_entries` WHERE `is_group` = 1 AND `group_kind` IS NOT 'combine';--> statement-breakpoint
INSERT INTO `entry_spans` (`id`, `date`, `mode`, `head_id`, `head_auto`, `created_at`) SELECT 'g' || `id`, `date`, 'combine', `id`, 1, datetime('now') FROM `time_entries` WHERE `is_group` = 1 AND `group_kind` = 'combine';--> statement-breakpoint
INSERT INTO `entry_spans` (`id`, `date`, `mode`, `head_id`, `head_auto`, `created_at`) SELECT `span_id`, MIN(`date`), 'divide', NULL, 0, datetime('now') FROM `time_entries` WHERE `span_id` IS NOT NULL AND `span_id` NOT IN (SELECT `id` FROM `entry_spans`) GROUP BY `span_id`;
