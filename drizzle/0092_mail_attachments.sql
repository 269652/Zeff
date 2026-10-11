ALTER TABLE `emails` ADD `has_attachments` integer;--> statement-breakpoint
ALTER TABLE `emails` ADD `attach_ref` text;--> statement-breakpoint
CREATE TABLE `mail_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`mail_key` text NOT NULL,
	`att_key` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`mime` text DEFAULT '' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`doc_id` integer,
	`status` text NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`tries` integer DEFAULT 0 NOT NULL,
	`fetched_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `mail_attachments_key` ON `mail_attachments` (`source`,`mail_key`,`att_key`);--> statement-breakpoint
CREATE INDEX `mail_attachments_doc` ON `mail_attachments` (`doc_id`);
