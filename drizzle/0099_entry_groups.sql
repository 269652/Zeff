ALTER TABLE `time_entries` ADD `is_group` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `entry_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`date` text NOT NULL,
	`hours` real NOT NULL,
	`start` text,
	`parallel` integer DEFAULT 0 NOT NULL,
	`description` text NOT NULL,
	`ticket` text,
	`type` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`reported_by` text DEFAULT 'agent' NOT NULL,
	`todo_ids` text DEFAULT '[]' NOT NULL,
	`run_ids` text DEFAULT '[]' NOT NULL,
	`time_ids` text DEFAULT '[]' NOT NULL,
	`suggestion_id` integer,
	`source` text DEFAULT 'hand' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `entry_items_entry_idx` ON `entry_items` (`entry_id`);
