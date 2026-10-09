CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`ai_provider` text DEFAULT 'claude' NOT NULL,
	`claude_model` text DEFAULT '' NOT NULL,
	`copilot_model` text DEFAULT '' NOT NULL
);
