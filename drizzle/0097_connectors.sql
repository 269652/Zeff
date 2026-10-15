CREATE TABLE `connectors` (
	`service` text PRIMARY KEY NOT NULL,
	`driver` text DEFAULT 'cdp' NOT NULL,
	`auth_kind` text DEFAULT 'token' NOT NULL,
	`token` text DEFAULT '' NOT NULL,
	`client_id` text DEFAULT '' NOT NULL,
	`client_secret` text DEFAULT '' NOT NULL,
	`access_token` text DEFAULT '' NOT NULL,
	`refresh_token` text DEFAULT '' NOT NULL,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`account` text DEFAULT '' NOT NULL,
	`connected_at` text
);
