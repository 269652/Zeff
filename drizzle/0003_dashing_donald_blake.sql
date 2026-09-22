CREATE TABLE `entry_tags` (
	`entry_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `tag_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `time_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_tags_tag_idx` ON `entry_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `report_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`group_meetings_by_day` integer DEFAULT true NOT NULL,
	`meetings_label` text DEFAULT 'Meetings' NOT NULL,
	`group_tickets_by_day` integer DEFAULT true NOT NULL,
	`ticket_template` text DEFAULT '{ticket}: {description}' NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
ALTER TABLE `time_entries` ADD `type` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
UPDATE `time_entries` SET `type` = 'meeting' WHERE `source` = 'calendar';--> statement-breakpoint
UPDATE `time_entries` SET `type` = 'ticket' WHERE `ticket` IS NOT NULL AND `ticket` <> '' AND `source` <> 'calendar';
