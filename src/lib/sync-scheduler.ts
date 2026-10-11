import { recapsOf, startRecap } from "./boards/recap";
import { previousWorkday } from "./boards/recap-shared";
import { startBoardRun } from "./boards/run";
import { getBoardSettings, latestRun } from "./boards/store";
import { getGitlabSettings } from "./gitlab/store";
import { syncGitlab } from "./gitlab/sync";
import { getTeamsSettings } from "./teams/store";
import { getMailSettings } from "./mail/store";
import { syncTeams } from "./teams/sync";
import { jiraLastSyncAt, lastSyncOf, quietAt, runStoppable, startSync } from "./sync/registry";
import { stepMinutes } from "./sync/intervals";
import { noteSyncResult } from "./sync/health";
import { ABORTED } from "./abort";

/** The automation Chrome is running (its debug port answers) — the Chrono, Punch and Outlook drivers would start it otherwise. */
async function chromeUp(): Promise<boolean> {
  const cdp = (await import("@/plugins/drivers")).automationCdp();
  try {
    const r = await fetch(`${cdp.replace(/\/+$/, "")}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** A step through the sync menu's registry — only while the automation Chrome runs (nothing is started for it). */
const whileChromeRuns = (key: "calendar" | "chrono" | "punch" | "whatsapp" | "keep" | "gcalendar") => async () =>
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
    // Outlook's calendar, Chrono, Punch, WhatsApp (read only): as set on the Sync settings page — while the automation Chrome runs.
    { name: "calendar", settings: () => ({ syncMinutes: stepMinutes("calendar"), lastSyncAt: lastSyncOf("calendar") }), run: whileChromeRuns("calendar") },
    { name: "chrono", settings: () => ({ syncMinutes: stepMinutes("chrono"), lastSyncAt: lastSyncOf("chrono") }), run: whileChromeRuns("chrono") },
    { name: "punch", settings: () => ({ syncMinutes: stepMinutes("punch"), lastSyncAt: lastSyncOf("punch") }), run: whileChromeRuns("punch") },
    { name: "whatsapp", settings: () => ({ syncMinutes: stepMinutes("whatsapp"), lastSyncAt: lastSyncOf("whatsapp") }), run: whileChromeRuns("whatsapp") },
    // Signal: while Signal Desktop runs — without its debug port the sync fails, so the menu tells you.
    { name: "signal", settings: () => ({ syncMinutes: stepMinutes("signal"), lastSyncAt: lastSyncOf("signal") }), run: whileSignalRuns },
    { name: "keep", settings: () => ({ syncMinutes: stepMinutes("keep"), lastSyncAt: lastSyncOf("keep") }), run: whileChromeRuns("keep") },
    { name: "gcalendar", settings: () => ({ syncMinutes: stepMinutes("gcalendar"), lastSyncAt: lastSyncOf("gcalendar") }), run: whileChromeRuns("gcalendar") },
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
  const tick = async () => {
    const { activeAccountId, listAccounts, withAccount, accountsInstalled } = await import("@/db/accounts");
    // A backup when it's due (Settings → Backups) — at any hour, quiet ones too; each account's
    // by its own settings, the one you're in or not.
    for (const a of accountsInstalled() ? listAccounts() : [{ id: activeAccountId(), name: "" }]) {
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
        // Today's and tomorrow's appointments as todos (calendars set so) — at any hour.
        try {
          await (await import("@/lib/calendar/todos")).calendarTodosWhenDue();
        } catch (e) {
          console.error("[calendar todos]", e);
        }
      });
    }
    // The syncs: the account you're in — for the whole turn, even if you switch meanwhile.
    try {
      await withAccount(activeAccountId(), syncTurn);
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
    for (const job of quietAt() ? [] : jobs.filter((j) => stepAvailable(j.name))) {
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
