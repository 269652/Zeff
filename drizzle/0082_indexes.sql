-- Indexes for the queries pages and syncs run all the time (found by an audit, 2026-10-11):
-- Teams chats waiting (per conversation), the WhatsApp/mail folders, a todo's alternatives and
-- bookings, the review's "dropped by you", GitLab threads, Roar/TimO pulls, Jira's last sync,
-- and the case-insensitive ticket lookups (lower(key), lower(ticket)) that otherwise scan.
CREATE INDEX IF NOT EXISTS `teams_messages_conv_idx` ON `teams_messages` (`conversation_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `teams_messages_kind_idx` ON `teams_messages` (`kind`,`sent_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `emails_folder_idx` ON `emails` (`folder`,`received_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `todos_parent_idx` ON `todos` (`parent_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `todos_done_idx` ON `todos` (`done_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `todos_entry_idx` ON `todos` (`entry_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `todo_events_todo_event_idx` ON `todo_events` (`todo_id`,`event`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `gitlab_items_parent_idx` ON `gitlab_items` (`parent`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `roar_entries_date_idx` ON `roar_entries` (`date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `roar_entries_pulled_idx` ON `roar_entries` (`pulled_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `timo_days_pulled_idx` ON `timo_days` (`pulled_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jira_tickets_synced_idx` ON `jira_tickets` (`synced_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `work_runs_entry_idx` ON `work_runs` (`entry_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jira_tickets_key_lc_idx` ON `jira_tickets` (lower(`key`));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `time_entries_ticket_lc_idx` ON `time_entries` (lower(`ticket`),`date`);
