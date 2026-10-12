CREATE TABLE `todo_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`todo_id` integer NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`repo` text,
	`source` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `todo_links_unique_idx` ON `todo_links` (`todo_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `todo_links_todo_idx` ON `todo_links` (`todo_id`);
