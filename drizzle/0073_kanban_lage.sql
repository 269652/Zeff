ALTER TABLE `kanban_boards` ADD `in_lage` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `kanban_cards` ADD `assignee` text;