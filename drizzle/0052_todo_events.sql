CREATE TABLE `todo_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`todo_id` integer NOT NULL,
	`event` text NOT NULL,
	`from_status` text,
	`ticket` text NOT NULL,
	`text` text NOT NULL,
	`note` text,
	`actor` text,
	`board_run_id` integer,
	`work_run_id` integer,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `todo_events_todo_idx` ON `todo_events` (`todo_id`);--> statement-breakpoint
CREATE INDEX `todo_events_at_idx` ON `todo_events` (`at`);--> statement-breakpoint
CREATE TRIGGER `todo_events_created` AFTER INSERT ON `todos` BEGIN
  INSERT INTO `todo_events` (`todo_id`, `event`, `ticket`, `text`, `note`, `actor`, `board_run_id`, `work_run_id`, `at`)
  VALUES (
    new.`id`, 'created', new.`ticket`, new.`text`, new.`source`,
    CASE
      WHEN new.`source` LIKE 'Geplant nach%' THEN 'plan'
      WHEN new.`work_run_id` IS NOT NULL THEN 'work:' || new.`work_run_id`
      WHEN new.`run_id` IS NOT NULL THEN 'lage:' || new.`run_id`
    END,
    new.`run_id`, new.`work_run_id`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;--> statement-breakpoint
CREATE TRIGGER `todo_events_status` AFTER UPDATE OF `status` ON `todos` WHEN old.`status` IS NOT new.`status` BEGIN
  INSERT INTO `todo_events` (`todo_id`, `event`, `from_status`, `ticket`, `text`, `note`, `actor`, `board_run_id`, `work_run_id`, `at`)
  VALUES (
    new.`id`, CASE WHEN new.`status` = 'open' THEN 'reopened' ELSE new.`status` END, old.`status`, new.`ticket`, new.`text`,
    CASE WHEN new.`note` IS NOT old.`note` THEN new.`note` END,
    CASE
      WHEN new.`note` IS old.`note` THEN NULL
      WHEN new.`note` LIKE 'Laut Lauf%' THEN 'lage:' || new.`run_id`
      WHEN new.`note` LIKE 'Erledigt von W-%' THEN 'work:' || CAST(substr(new.`note`, 16) AS INTEGER)
      WHEN new.`note` LIKE 'Ticket in Jira erledigt%' THEN 'jira'
      WHEN new.`note` LIKE 'Anderer Weg gewählt%' THEN 'plan'
      WHEN new.`note` LIKE 'Erledigt mit Buchung%' THEN 'agent:MCP'
    END,
    new.`run_id`, new.`work_run_id`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
END;--> statement-breakpoint
INSERT INTO `todo_events` (`todo_id`, `event`, `ticket`, `text`, `note`, `actor`, `board_run_id`, `work_run_id`, `at`)
SELECT `id`, 'created', `ticket`, `text`, `source`,
  CASE
    WHEN `source` LIKE 'Geplant nach%' THEN 'plan'
    WHEN `work_run_id` IS NOT NULL THEN 'work:' || `work_run_id`
    WHEN `run_id` IS NOT NULL THEN 'lage:' || `run_id`
  END,
  `run_id`, `work_run_id`,
  CASE WHEN `created_at` LIKE '%T%' THEN `created_at` ELSE replace(`created_at`, ' ', 'T') || 'Z' END
FROM `todos`;--> statement-breakpoint
INSERT INTO `todo_events` (`todo_id`, `event`, `from_status`, `ticket`, `text`, `note`, `actor`, `board_run_id`, `work_run_id`, `at`)
SELECT `id`, `status`, 'open', `ticket`, `text`, `note`,
  CASE
    WHEN `note` LIKE 'Laut Lauf%' THEN 'lage:' || `run_id`
    WHEN `note` LIKE 'Erledigt von W-%' THEN 'work:' || CAST(substr(`note`, 16) AS INTEGER)
    WHEN `note` LIKE 'Ticket in Jira erledigt%' THEN 'jira'
    WHEN `note` LIKE 'Anderer Weg gewählt%' THEN 'plan'
    WHEN `note` LIKE 'Erledigt mit Buchung%' THEN 'agent:MCP'
  END,
  `run_id`, `work_run_id`, `done_at`
FROM `todos` WHERE `status` <> 'open' AND `done_at` IS NOT NULL;
