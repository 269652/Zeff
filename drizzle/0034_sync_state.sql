CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`last_at` text,
	`last_ok` integer,
	`last_message` text
);
