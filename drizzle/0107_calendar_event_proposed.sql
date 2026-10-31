ALTER TABLE `calendar_events` ADD `proposed` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `calendar_events` SET `proposed` = 1 WHERE `calendar_id` IN (SELECT `id` FROM `calendars` WHERE `key` LIKE 'zeff:shadow-%');
