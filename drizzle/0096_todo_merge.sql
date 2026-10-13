ALTER TABLE `todos` ADD `merged_into` integer;--> statement-breakpoint
ALTER TABLE `todos` ADD `merged_at` text;--> statement-breakpoint
CREATE INDEX `todos_merged_into_idx` ON `todos` (`merged_into`);
