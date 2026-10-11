CREATE TABLE `jira_boards` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`type` text,
	`project_key` text,
	`job_number` text,
	`member_count` integer DEFAULT 0 NOT NULL,
	`synced_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `jira_tickets` ADD `board_id` integer;