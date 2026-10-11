CREATE TABLE `jira_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket` text NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`at` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jira_comments_ticket_idx` ON `jira_comments` (`ticket`);