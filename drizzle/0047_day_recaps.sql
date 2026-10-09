CREATE TABLE `day_recaps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`model` text,
	`facts` text DEFAULT '{}' NOT NULL,
	`result` text,
	`error` text,
	`cost_usd` real,
	`duration_ms` integer,
	`started_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `day_recaps_day_idx` ON `day_recaps` (`day`);