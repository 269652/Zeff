CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`mime` text DEFAULT '' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`sha256` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`file` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`concepts` text DEFAULT '' NOT NULL,
	`compiled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_sha256` ON `documents` (`sha256`);
