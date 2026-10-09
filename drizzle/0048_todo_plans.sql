ALTER TABLE `todos` ADD `planned` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `todos` ADD `path` text;