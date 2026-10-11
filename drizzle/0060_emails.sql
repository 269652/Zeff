CREATE TABLE `emails` (
	`key` text PRIMARY KEY NOT NULL,
	`conv_id` text NOT NULL,
	`from_name` text,
	`from_email` text,
	`subject` text NOT NULL,
	`preview` text NOT NULL,
	`received_at` text NOT NULL,
	`unread` integer DEFAULT false NOT NULL,
	`synced_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `emails_received_idx` ON `emails` (`received_at`);--> statement-breakpoint
CREATE INDEX `emails_conv_idx` ON `emails` (`conv_id`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `mail_sync_minutes` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `mail_last_sync_at` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `mail_last_result` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `mail_last_ok` integer;