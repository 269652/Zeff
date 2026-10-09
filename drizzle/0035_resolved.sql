CREATE TABLE `resolved_jira_comments` (
	`comment_id` text PRIMARY KEY NOT NULL,
	`ticket` text NOT NULL,
	`resolved_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `teams_messages` ADD `resolved_at` text;--> statement-breakpoint
ALTER TABLE `todos` ADD `refs` text DEFAULT '[]' NOT NULL;