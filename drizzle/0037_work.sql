CREATE TABLE `work_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket` text NOT NULL,
	`todo_id` integer NOT NULL,
	`mode` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`permission_mode` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`repo` text,
	`cwd` text,
	`branch` text,
	`base` text,
	`base_sha` text,
	`session_id` text,
	`pid` integer,
	`prompt` text NOT NULL,
	`result` text,
	`outcome` text,
	`summary` text,
	`entry_line` text,
	`git_summary` text,
	`error` text,
	`cost_usd` real,
	`duration_ms` integer,
	`turns` integer,
	`denials` integer,
	`entry_id` integer,
	`queued_at` text NOT NULL,
	`started_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `work_runs_todo_idx` ON `work_runs` (`todo_id`);--> statement-breakpoint
CREATE INDEX `work_runs_status_idx` ON `work_runs` (`status`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `work_parallel` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `work_permission_mode` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `work_isolation` text DEFAULT 'worktree' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `work_repos` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `work_model` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `work_max_budget_usd` real DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `work_instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `todos` ADD `draft` text;--> statement-breakpoint
ALTER TABLE `todos` ADD `channel` text;--> statement-breakpoint
ALTER TABLE `todos` ADD `target` text;--> statement-breakpoint
ALTER TABLE `todos` ADD `parent_id` integer;--> statement-breakpoint
ALTER TABLE `todos` ADD `work_run_id` integer;