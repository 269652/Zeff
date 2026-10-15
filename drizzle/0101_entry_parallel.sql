ALTER TABLE `time_entries` ADD `group_kind` text;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `span_id` text;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `worked_hours` real;--> statement-breakpoint
CREATE INDEX `time_entries_span_idx` ON `time_entries` (`span_id`);
