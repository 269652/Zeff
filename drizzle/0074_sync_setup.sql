ALTER TABLE `sync_state` ADD `every_minutes` integer;
--> statement-breakpoint
ALTER TABLE `app_settings` ADD `setup_done_at` text;
--> statement-breakpoint
UPDATE `app_settings` SET `setup_done_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
