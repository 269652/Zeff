CREATE TABLE `context_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`context_id` integer NOT NULL,
	`name` text NOT NULL,
	`mime` text DEFAULT 'application/octet-stream' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`path` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`jira_synced_at` text,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `context_files_context_idx` ON `context_files` (`context_id`);--> statement-breakpoint
CREATE TABLE `contexts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`title` text,
	`author` text,
	`body` text DEFAULT '' NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`date` text,
	`ticket` text,
	`jira_comment_id` text,
	`jira_synced_at` text,
	`jira_synced_hash` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entry_contexts` (
	`entry_id` integer NOT NULL,
	`context_id` integer NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`entry_id`, `context_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_contexts_context_idx` ON `entry_contexts` (`context_id`);