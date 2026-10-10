ALTER TABLE `calendars` ADD `todos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `calendars` SET `todos` = 1 WHERE `source` = 'zeff';
