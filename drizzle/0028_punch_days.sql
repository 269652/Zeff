CREATE TABLE `punch_days` (
	`date` text PRIMARY KEY NOT NULL,
	`work` text DEFAULT '[]' NOT NULL,
	`absence` text DEFAULT '[]' NOT NULL,
	`pulled_at` text NOT NULL
);
