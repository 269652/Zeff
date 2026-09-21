CREATE TABLE `absences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`type` text DEFAULT 'vacation' NOT NULL,
	`hours` real,
	`note` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `absences_range_idx` ON `absences` (`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `work_schedule` (
	`id` integer PRIMARY KEY NOT NULL,
	`mon` real DEFAULT 8 NOT NULL,
	`tue` real DEFAULT 8 NOT NULL,
	`wed` real DEFAULT 8 NOT NULL,
	`thu` real DEFAULT 8 NOT NULL,
	`fri` real DEFAULT 8 NOT NULL,
	`sat` real DEFAULT 0 NOT NULL,
	`sun` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
