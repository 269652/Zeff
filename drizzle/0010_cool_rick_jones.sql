ALTER TABLE `jira_boards` ADD `enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `jira_boards` SET `enabled` = (`job_number` IS NOT NULL);