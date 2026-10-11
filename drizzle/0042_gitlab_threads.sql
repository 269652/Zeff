ALTER TABLE `gitlab_items` ADD `thread` text;--> statement-breakpoint
UPDATE `gitlab_settings` SET `last_ok` = 0;