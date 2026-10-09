ALTER TABLE `work_schedule` ADD `default_pauses` text;--> statement-breakpoint
ALTER TABLE `work_schedule` ADD `timo_default_pauses` integer DEFAULT true NOT NULL;