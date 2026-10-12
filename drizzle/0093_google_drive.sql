CREATE TABLE `google_drive` (
	`id` integer PRIMARY KEY NOT NULL,
	`client_id` text DEFAULT '' NOT NULL,
	`client_secret` text DEFAULT '' NOT NULL,
	`refresh_token` text DEFAULT '' NOT NULL,
	`access_token` text DEFAULT '' NOT NULL,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`connected_at` text,
	`folder_name` text DEFAULT '' NOT NULL,
	`root_folder_id` text DEFAULT '' NOT NULL,
	`backups_folder_id` text DEFAULT '' NOT NULL,
	`documents_folder_id` text DEFAULT '' NOT NULL,
	`mirror_backup_retention` integer DEFAULT true NOT NULL,
	`upload_unencrypted` integer DEFAULT false NOT NULL,
	`pull_documents` integer DEFAULT false NOT NULL
);--> statement-breakpoint
CREATE TABLE `google_drive_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`drive_id` text NOT NULL,
	`version` text DEFAULT '' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`origin` text DEFAULT 'push' NOT NULL,
	`synced_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `google_drive_files_drive` ON `google_drive_files` (`drive_id`);--> statement-breakpoint
CREATE INDEX `google_drive_files_key` ON `google_drive_files` (`kind`,`key`);
