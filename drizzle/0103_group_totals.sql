UPDATE `time_entries` SET `worked_hours` = `hours` WHERE `worked_hours` IS NULL AND `id` IN (SELECT `head_id` FROM `entry_spans` WHERE `head_id` IS NOT NULL AND `head_auto` = 0);
