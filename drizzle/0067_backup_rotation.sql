ALTER TABLE `app_settings` ADD `backup_keep_daily` integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backup_keep_weekly` integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backup_keep_monthly` integer DEFAULT 24 NOT NULL;