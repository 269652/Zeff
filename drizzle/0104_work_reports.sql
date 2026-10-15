CREATE TABLE `work_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`todo_id` integer NOT NULL,
	`ticket` text NOT NULL,
	`outcome` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`body` text NOT NULL,
	`changes` text,
	`checks` text,
	`open_items` text,
	`completed_todos` text,
	`repo` text,
	`branch` text,
	`by_who` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `work_reports_run_idx` ON `work_reports` (`run_id`);--> statement-breakpoint
CREATE INDEX `work_reports_todo_idx` ON `work_reports` (`todo_id`);
