CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` text NOT NULL,
	`name` text NOT NULL,
	`customer` text,
	`description` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_number_unique` ON `jobs` (`number`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`date` text NOT NULL,
	`hours` real NOT NULL,
	`description` text NOT NULL,
	`ticket` text,
	`reported_by` text DEFAULT 'unknown' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `time_entries_date_idx` ON `time_entries` (`date`);--> statement-breakpoint
CREATE INDEX `time_entries_job_idx` ON `time_entries` (`job_id`);