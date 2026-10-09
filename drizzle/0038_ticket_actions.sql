CREATE TABLE `ticket_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`ticket` text NOT NULL,
	`idx` integer NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`detail` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ticket_actions_run_idx` ON `ticket_actions` (`run_id`);