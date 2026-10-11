CREATE TABLE `kanban_boards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text DEFAULT 'indigo' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kanban_columns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`board_id` integer NOT NULL REFERENCES `kanban_boards`(`id`) ON DELETE cascade,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`wip_limit` integer,
	`done` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `kanban_columns_board` ON `kanban_columns` (`board_id`);
--> statement-breakpoint
CREATE TABLE `kanban_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`board_id` integer NOT NULL REFERENCES `kanban_boards`(`id`) ON DELETE cascade,
	`column_id` integer NOT NULL REFERENCES `kanban_columns`(`id`) ON DELETE cascade,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`priority` text,
	`due` text,
	`sort` real DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`done_at` text
);
--> statement-breakpoint
CREATE INDEX `kanban_cards_column` ON `kanban_cards` (`column_id`, `sort`);
