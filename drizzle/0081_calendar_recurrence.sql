ALTER TABLE `calendar_events` ADD `recurrence` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `exdates` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `series_id` integer;
