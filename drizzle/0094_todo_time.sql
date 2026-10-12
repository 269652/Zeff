CREATE TABLE `todo_time` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`todo_id` integer NOT NULL,
	`minutes` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`reported_by` text DEFAULT 'agent' NOT NULL,
	`run_id` integer,
	`source` text DEFAULT 'agent' NOT NULL,
	`at` text NOT NULL,
	`created_at` text NOT NULL,
	`suggestion_id` integer,
	`entry_id` integer
);--> statement-breakpoint
CREATE INDEX `todo_time_todo_idx` ON `todo_time` (`todo_id`);--> statement-breakpoint
ALTER TABLE `entry_suggestions` ADD `time_ids` text DEFAULT '[]' NOT NULL;
