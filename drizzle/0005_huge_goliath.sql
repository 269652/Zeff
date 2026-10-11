CREATE TABLE `jira_tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`status_category` text DEFAULT 'unknown' NOT NULL,
	`issue_type` text,
	`priority` text,
	`assignee` text,
	`url` text,
	`job_number` text,
	`updated_at` text,
	`resolved_at` text,
	`active` integer DEFAULT true NOT NULL,
	`synced_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jira_tickets_key_unique` ON `jira_tickets` (`key`);--> statement-breakpoint
CREATE INDEX `jira_tickets_status_idx` ON `jira_tickets` (`status_category`);