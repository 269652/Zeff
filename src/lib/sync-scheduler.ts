import { recapsOf, startRecap } from "./boards/recap";
import { previousWorkday } from "./boards/recap-shared";
import { startBoardRun } from "./boards/run";
import { getBoardSettings, latestRun } from "./boards/store";
import { getGitlabSettings } from "./gitlab/store";
import { syncGitlab } from "./gitlab/sync";
import { getTeamsSettings } from "./teams/store";
import { getMailSettings } from "./mail/store";
import { syncTeams } from "./teams/sync";
import { integrationServer, integrationServerIds } from "./integrations/server";
import { jiraLastSyncAt, lastSyncOf, quietAt, runStoppable, startSync } from "./sync/registry";
import type { OwnIntervalKey } from "./sync/intervals";
import type { SyncKey } from "./sync/shared";
import { stepMinutes } from "./sync/intervals";
import { noteSyncResult } from "./sync/health";
import { ABORTED } from "./abort";

/** The automation Chrome is running (its debug port answers) — the Chrono, Punch and Outlook drivers would start it otherwise. */
async function chromeUp(): Promise<boolean> {
  return (await import("@/plugins/drivers")).automationUp(undefined, 2000);
}

/** A step through the sync menu's registry — only while the automation Chrome runs (nothing is started for it). */
const whileChromeRuns = (key: SyncKey) => async () =>
  (await chromeUp()) ? startSync(key) : { ok: true, message: "the automation Chrome isn't running — later" };

/** Signal's step — only while Signal Desktop runs (nothing is started for it). */
const whileSignalRuns = async () => {
  const { signalRunning, signalUp } = await import("@/plugins/signal/endpoint");
  return (await signalUp()) || (await signalRunning()) ? startSync("signal") : { ok: true, message: "Signal Desktop isn't running — later" };
};

const state = globalThis as { __zeffSyncScheduler?: boolean };


/** Whether a source is due: syncing every N minutes (0 = only by hand), and the last sync (a sync by hand counts) that long ago. */
const due = (s: { syncMinutes: number; lastSyncAt: string | null }) =>
  s.syncMinutes > 0 && (!s.lastSyncAt || Date.now() - new Date(s.lastSyncAt).getTime() >= s.syncMinutes * 60000);

/**
 * The periodic syncs — each every N minutes as set on the Sync settings page (Menu → Sync-Einstellungen): once a
 * minute it checks which is due and runs it in the background (only while the automation
 * Chrome runs with that site open) — not in the quiet hours (19:00–08:00). ZEFF_TEAMS_SYNC=off
 * turns them off for this server (test servers on a database copy).
 */
export function startSyncScheduler(): void {
  if (state.__zeffSyncScheduler || process.env.ZEFF_TEAMS_SYNC === "off") return;
  state.__zeffSyncScheduler = true;
  const jobs: { name: string; settings: () => { syncMinutes: number; lastSyncAt: string | null }; run: () => Promise<{ ok: boolean; message: string }> }[] = [
    // Jira: every 15 minutes (through the sync menu's step, so the menu shows it and records how it went).
    { name: "jira", settings: () => ({ syncMinutes: stepMinutes("jira"), lastSyncAt: jiraLastSyncAt() }), run: async () => startSync("jira") },
    // Outlook's calendar, WhatsApp (read only): as set on the Sync settings page — while the automation Chrome runs.
    { name: "calendar", settings: () => ({ syncMinutes: stepMinutes("calendar"), lastSyncAt: lastSyncOf("calendar") }), run: async () => ((await import("@/lib/connectors/store")).driverOf("outlook-calendar") === "api" ? startSync("calendar") : whileChromeRuns("calendar")()) },
    { name: "whatsapp", settings: () => ({ syncMinutes: stepMinutes("whatsapp"), lastSyncAt: lastSyncOf("whatsapp") }), run: whileChromeRuns("whatsapp") },
    // Signal: while Signal Desktop runs — without its debug port the sync fails, so the menu tells you.
    { name: "signal", settings: () => ({ syncMinutes: stepMinutes("signal"), lastSyncAt: lastSyncOf("signal") }), run: whileSignalRuns },
    { name: "keep", settings: () => ({ syncMinutes: stepMinutes("keep"), lastSyncAt: lastSyncOf("keep") }), run: whileChromeRuns("keep") },
    // News: public feeds — no Chrome needed.
    { name: "news", settings: () => ({ syncMinutes: stepMinutes("news"), lastSyncAt: lastSyncOf("news") }), run: async () => startSync("news") },
    { name: "gcalendar", settings: () => ({ syncMinutes: stepMinutes("gcalendar"), lastSyncAt: lastSyncOf("gcalendar") }), run: async () => ((await import("@/lib/connectors/store")).driverOf("gcalendar") === "api" ? startSync("gcalendar") : whileChromeRuns("gcalendar")()) },
    // Google Drive (the extensions for Backups and Documents): through the sync menu's step — no Chrome needed.
    { name: "drivebackup", settings: () => ({ syncMinutes: stepMinutes("drivebackup"), lastSyncAt: lastSyncOf("drivebackup") }), run: async () => startSync("drivebackup") },
    { name: "drivedocs", settings: () => ({ syncMinutes: stepMinutes("drivedocs"), lastSyncAt: lastSyncOf("drivedocs") }), run: async () => startSync("drivedocs") },
    { name: "teams", settings: getTeamsSettings, run: () => syncTeams({ background: true }) },
    { name: "mail", settings: getMailSettings, run: async () => (await import("@/lib/mail/sync")).syncMail({ background: true }) },
    { name: "gitlab", settings: getGitlabSettings, run: () => syncGitlab({ background: true }) },
    // The Ticket-Lage run (through the AI provider): every N minutes, on workdays only.
    {
      name: "boards",
      settings: () => {
        const now = new Date();
        const workday = now.getDay() >= 1 && now.getDay() <= 5;
        const last = latestRun();
        return { syncMinutes: workday ? getBoardSettings().autoMinutes : 0, lastSyncAt: last ? `${last.startedAt.replace(" ", "T")}Z` : null };
      },
      run: async () => startBoardRun(),
    },
    // The Recap of the last workday, once each workday morning (tried again an hour later if it failed).
    {
      name: "recap",
      settings: () => {
        const now = new Date();
        if (now.getDay() === 0 || now.getDay() === 6) return { syncMinutes: 0, lastSyncAt: null };
        const { latest, good } = recapsOf(previousWorkday(now));
        if (good || latest?.status === "running") return { syncMinutes: 0, lastSyncAt: null };
        return { syncMinutes: 60, lastSyncAt: latest ? `${latest.startedAt.replace(" ", "T")}Z` : null };
      },
      run: async () => startRecap(previousWorkday()),
    },
  ];
  // The mounted integrations' steps (Chrono, Punch): as set on the Sync settings page — while the automation Chrome runs.
  for (const id of integrationServerIds()) {
    const key = integrationServer(id)?.syncStep?.key as SyncKey | undefined;
    if (key) jobs.push({ name: key, settings: () => ({ syncMinutes: stepMinutes(key as OwnIntervalKey), lastSyncAt: lastSyncOf(key) }), run: whileChromeRuns(key) });
  }
  let lastHealthCheck = 0;
  // The accounts synced since this server started (the first turn of each notes it: its steps weren't due before — the stale check).
  const syncing = new Set<string>();
  const tick = async () => {
    const { activeAccountId, listAccounts, withAccount, accountsInstalled, reloadAccounts } = await import("@/db/accounts");
    reloadAccounts(); // an account made or changed by the web server
    const accounts = accountsInstalled() ? listAccounts() : [{ id: activeAccountId(), name: "" }];
    // A backup when it's due (Settings → Backups) — at any hour, quiet ones too; each account's
    // by its own settings, the one you're in or not.
    for (const a of accounts) {
      await withAccount(a.id, async () => {
        try {
          const { backupDue, runBackup } = await import("@/plugins/backup/backup");
          if ((await import("@/plugins/state")).isInstalled("backup") && backupDue()) {
            const r = await runBackup();
            if (!r.ok) console.warn(`[backup${a.name ? ` ${a.name}` : ""}] ${r.message}`);
          }
        } catch (e) {
          console.error("[backup]", e);
        }
        // The Workspace's pipelines with a clock that are due (their AI outside the quiet hours).
        try {
          if ((await import("@/plugins/state")).isInstalled("workspace")) (await import("@/plugins/workspace/pipeline")).runDuePipelines({ ai: !quietAt() });
        } catch (e) {
          console.error("[pipelines]", e);
        }
        // The routines (automations and agents) with a clock that are due; agents' runs follow their workers.
        try {
          if ((await import("@/plugins/state")).isInstalled("workspace")) {
            await (await import("@/plugins/workspace/routine-triggers")).runDueRoutines();
            (await import("@/plugins/workspace/routine-agent")).syncAgentRuns();
          }
        } catch (e) {
          console.error("[routines]", e);
        }
        // The Workspace's todo lists that feed the Todo engine (rows and list items), brought together with their todos.
        try {
          if ((await import("@/plugins/state")).isInstalled("workspace")) {
            (await import("@/plugins/workspace/todo-engine")).syncTodoEngine();
            (await import("@/plugins/workspace/task-lists")).syncTaskListsEngine();
          }
        } catch (e) {
          console.error("[todo engine]", e);
        }
        // Rows that come back by themselves (the Workspace's repeating rules) that are due.
        try {
          if ((await import("@/plugins/state")).isInstalled("workspace")) (await import("@/plugins/workspace/recurring")).runDueRecurrences();
        } catch (e) {
          console.error("[repeating rows]", e);
        }
        // The agents of the jobs databases that take their Ready column by themselves (when switched on): ended jobs settled, the next taken.
        try {
          if ((await import("@/plugins/state")).isInstalled("workspace")) await (await import("@/plugins/workspace/jobs")).runAutoJobs();
        } catch (e) {
          console.error("[agent jobs]", e);
        }
        // The timeline: what came in since the last minute (todos, rows, entries made in Zeff itself too), and the backfill a bit further — by rule, no AI.
        try {
          if ((await import("@/plugins/state")).isInstalled("timeline")) {
            const r = await (await import("@/plugins/timeline/indexer")).indexTimeline();
            if (!r.ok && r.error !== "already running") console.warn(`[timeline] ${r.error}`);
          }
        } catch (e) {
          console.error("[timeline]", e);
        }
        // Today's and tomorrow's appointments as todos (calendars set so) — at any hour.
        try {
          await (await import("@/lib/calendar/todos")).calendarTodosWhenDue();
        } catch (e) {
          console.error("[calendar todos]", e);
        }
      });
    }
    // The syncs: every account's, one after the other (each in its own database and its own automation Chrome) —
    // the one you're in or not: two accounts run side by side.
    try {
      const health = Date.now() - lastHealthCheck >= 5 * 60000;
      if (health) lastHealthCheck = Date.now();
      for (const a of accounts) {
        await withAccount(a.id, async () => {
          if (!syncing.has(a.id)) {
            syncing.add(a.id);
            (await import("./sync/source-health")).noteSyncingSince();
          }
          await syncTurn();
          // How the sources hold up (failing, not running, silent, their app changed) — every 5 minutes: a new incident
          // is kept, and told once (the attention list: a notification, a toast).
          if (!health) return;
          try {
            await (await import("./sync/source-health")).sourceHealth({ fresh: true });
          } catch (e) {
            console.error(`[source health${a.name ? ` ${a.name}` : ""}]`, e);
          }
        });
      }
    } finally {
      setTimeout(tick, 60000).unref();
    }
  };
  // Run here, not through the registry's step (which keeps how they go itself): how they go over
  // time is kept for Heute's "syncs that keep failing" too.
  const DIRECT = new Set(["teams", "mail", "gitlab"]);
  const note = (name: string, ok: boolean, message: string) => {
    if (DIRECT.has(name) && !message.includes(ABORTED)) noteSyncResult(name as "teams" | "mail" | "gitlab", ok, message);
  };
  const syncTurn = async () => {
    // A plugin's job only while the plugin is installed.
    const { stepAvailable } = await import("@/plugins/state");
    // In the quiet hours (19:00–08:00) only the news goes on: public feeds, no load on anything, and it should be fresh in the morning.
    for (const job of jobs.filter((j) => stepAvailable(j.name) && (!quietAt() || j.name === "news"))) {
      try {
        if (!due(job.settings())) continue;
        const r = await runStoppable(job.name, job.run);
        note(job.name, r.ok, r.message);
        if (!r.ok) console.warn(`[${job.name} sync] ${r.message}`);
      } catch (e) {
        note(job.name, false, e instanceof Error ? e.message : String(e));
        console.error(`[${job.name} sync]`, e);
      }
    }
  };
  setTimeout(tick, 60000).unref(); // a minute after the server starts
}
