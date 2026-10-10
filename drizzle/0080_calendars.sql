CREATE TABLE `calendars` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`source` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`visible` integer DEFAULT 1 NOT NULL,
	`busy` integer DEFAULT 1 NOT NULL,
	`book` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `calendars_key` ON `calendars` (`key`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`calendar_id` integer NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`all_day` integer DEFAULT 0 NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`show_as` text DEFAULT 'busy' NOT NULL,
	`cancelled` integer DEFAULT 0 NOT NULL,
	`response` text,
	`private` integer DEFAULT 0 NOT NULL,
	`online` integer DEFAULT 0 NOT NULL,
	`organizer` text DEFAULT '' NOT NULL,
	`attendees` text DEFAULT '[]' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`raw` text,
	`todo_id` integer,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_key` ON `calendar_events` (`calendar_id`,`key`);--> statement-breakpoint
CREATE INDEX `calendar_events_start` ON `calendar_events` (`start`);
