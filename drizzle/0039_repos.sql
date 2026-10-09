CREATE TABLE `repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`gitlab_project` text,
	`boards` text DEFAULT '[]' NOT NULL,
	`tickets` text DEFAULT '[]' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
