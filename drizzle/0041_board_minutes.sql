ALTER TABLE `board_settings` ADD `auto_minutes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `board_settings` SET `auto_minutes` = `auto_hours` * 60;