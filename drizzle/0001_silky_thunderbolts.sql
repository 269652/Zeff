CREATE TABLE `calendar_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`account_name` text,
	`account_email` text,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer NOT NULL,
	`scope` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_connections_provider_unique` ON `calendar_connections` (`provider`);--> statement-breakpoint
ALTER TABLE `time_entries` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `time_entries_external_id_unique` ON `time_entries` (`external_id`);