CREATE TABLE `board_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`jql` text NOT NULL,
	`model` text,
	`tickets` text DEFAULT '[]' NOT NULL,
	`result` text,
	`error` text,
	`cost_usd` real,
	`duration_ms` integer,
	`started_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `board_runs_started_idx` ON `board_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `board_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`jql` text DEFAULT 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`auto_hours` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket` text NOT NULL,
	`text` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`owner` text DEFAULT 'me' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`source` text,
	`note` text,
	`run_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`done_at` text
);
--> statement-breakpoint
CREATE INDEX `todos_ticket_idx` ON `todos` (`ticket`);--> statement-breakpoint
CREATE INDEX `todos_status_idx` ON `todos` (`status`);