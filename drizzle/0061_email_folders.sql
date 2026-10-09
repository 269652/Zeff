ALTER TABLE `app_settings` ADD `mail_folders` text DEFAULT 'Posteingang, Notifications' NOT NULL;--> statement-breakpoint
ALTER TABLE `emails` ADD `folder` text DEFAULT 'Posteingang' NOT NULL;