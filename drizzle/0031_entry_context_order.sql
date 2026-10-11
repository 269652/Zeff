ALTER TABLE `entry_contexts` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Each entry's context keeps the order it was added in: 0, 1, 2…
UPDATE `entry_contexts` SET `position` = (
	SELECT count(*) FROM `entry_contexts` AS e2
	WHERE e2.`entry_id` = `entry_contexts`.`entry_id`
		AND (e2.`created_at` < `entry_contexts`.`created_at`
			OR (e2.`created_at` = `entry_contexts`.`created_at` AND e2.`context_id` < `entry_contexts`.`context_id`))
);
