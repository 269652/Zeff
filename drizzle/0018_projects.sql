CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`customer` text,
	`job_id` integer,
	`start_date` text,
	`end_date` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_title_unique` ON `projects` (`title`);--> statement-breakpoint
ALTER TABLE `time_entries` ADD `project_id` integer REFERENCES projects(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `time_entries_project_idx` ON `time_entries` (`project_id`);