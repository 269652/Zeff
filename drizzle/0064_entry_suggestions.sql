CREATE TABLE `entry_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`hours` real NOT NULL,
	`description` text NOT NULL,
	`ticket` text,
	`job_number` text,
	`project_id` integer,
	`type` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`reported_by` text DEFAULT 'agent' NOT NULL,
	`todo_ids` text DEFAULT '[]' NOT NULL,
	`run_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`entry_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entry_suggestions_status_idx` ON `entry_suggestions` (`status`);