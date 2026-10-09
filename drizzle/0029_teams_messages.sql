CREATE TABLE `teams_messages` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`mention_type` text,
	`conversation_id` text NOT NULL,
	`reply_chain_id` text,
	`message_id` text NOT NULL,
	`place` text,
	`sender_name` text,
	`sender_id` text,
	`sent_at` text NOT NULL,
	`subject` text,
	`html` text NOT NULL,
	`text` text NOT NULL,
	`link` text NOT NULL,
	`is_read` integer,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `teams_messages_sent_idx` ON `teams_messages` (`sent_at`);--> statement-breakpoint
CREATE TABLE `teams_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`sync_minutes` integer DEFAULT 10 NOT NULL,
	`last_sync_at` text,
	`last_result` text,
	`last_ok` integer
);
