ALTER TABLE `app_settings` ADD `backup_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backup_every_hours` integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backup_keep` integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backup_dir` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backup_password` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backup_last_at` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backup_last_ok` integer;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `backup_last_result` text;