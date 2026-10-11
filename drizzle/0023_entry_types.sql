CREATE TABLE `entry_types` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`color` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
INSERT INTO `entry_types` (`key`, `label`, `color`, `sort`) VALUES ('ticket', 'Ticket', '#6366f1', 0), ('meeting', 'Meeting', '#8b5cf6', 1), ('internal', 'Internal', '#10b981', 2), ('training', 'Training', '#0ea5e9', 3), ('other', 'Other', '#71717a', 4), ('absence', 'Absence', '#f59e0b', 5);
