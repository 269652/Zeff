CREATE TABLE `gitlab_items` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`project` text NOT NULL,
	`project_url` text NOT NULL,
	`ref` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`author` text,
	`state` text,
	`created_at` text,
	`updated_at` text,
	`url` text NOT NULL,
	`branch` text,
	`parent` text,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gitlab_items_updated_idx` ON `gitlab_items` (`updated_at`);--> statement-breakpoint
CREATE TABLE `gitlab_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`base_url` text DEFAULT 'https://gitlab.com' NOT NULL,
	`sync_minutes` integer DEFAULT 10 NOT NULL,
	`last_sync_at` text,
	`last_result` text,
	`last_ok` integer
);
