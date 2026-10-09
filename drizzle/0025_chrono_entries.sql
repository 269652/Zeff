CREATE TABLE `chrono_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`job_number` text NOT NULL,
	`date` text NOT NULL,
	`hours` real NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`rejection_comment` text,
	`approver` text,
	`approved_by` text,
	`submitted_at` text,
	`approved_at` text,
	`pulled_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chrono_entries_week_idx` ON `chrono_entries` (`week_start`);