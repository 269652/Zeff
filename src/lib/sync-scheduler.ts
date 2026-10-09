import { recapsOf, startRecap } from "./boards/recap";
import { previousWorkday } from "./boards/recap-shared";
import { startBoardRun } from "./boards/run";
import { getBoardSettings, latestRun } from "./boards/store";
import { getGitlabSettings } from "./gitlab/store";
import { syncGitlab } from "./gitlab/sync";
import { getTeamsSettings } from "./teams/store";
import { getMailSettings } from "./mail/store";
import { syncTeams } from "./teams/sync";
import { EVERY_MINUTES, JIRA_EVERY_MINUTES, jiraLastSyncAt, lastSyncOf, quietAt, startSync } from "./sync/registry";

/** The automation Chrome is running (its debug port answers) — the Chrono, Punch and Outlook drivers would start it otherwise. */
async function chromeUp(): Promise<boolean> {
  const cdp = process.env.CHRONO_CDP_ENDPOINT || "http://127.0.0.1:9222";
  try {
    const r = await fetch(`${cdp.replace(/\/+$/, "")}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** A step through the sync menu's registry — only while the automation Chrome runs (nothing is started for it). */
const whileChromeRuns = (key: "calendar" | "chrono" | "punch") => async () =>
  (await chromeUp()) ? startSync(key) : { ok: true, message: "the automation Chrome isn't running — later" };

const state = globalThis as { __zeffSyncScheduler?: boolean };


/** Whether a source is due: syncing every N minutes (0 = only by hand), and the last sync (a sync by hand counts) that long ago. */
const due = (s: { syncMinutes: number; lastSyncAt: string | null }) =>
  s.syncMinutes > 0 && (!s.lastSyncAt || Date.now() - new Date(s.lastSyncAt).getTime() >= s.syncMinutes * 60000);

/**
 * The periodic syncs — Jira every 15 minutes, Teams and GitLab every N minutes as set on their pages: once a
 * minute it checks which is due and runs it in the background (only while the automation
 * Chrome runs with that site open) — not in the quiet hours (19:00–08:00). ZEFF_TEAMS_SYNC=off
 * turns them off for this server (test servers on a database copy).
 */
export function startSyncScheduler(): void {
  if (state.__zeffSyncScheduler || process.env.ZEFF_TEAMS_SYNC === "off") return;
  state.__zeffSyncScheduler = true;
  const jobs: { name: string; settings: () => { syncMinutes: number; lastSyncAt: string | null }; run: () => Promise<{ ok: boolean; message: string }> }[] = [
    // Jira: every 15 minutes (through the sync menu's step, so the menu shows it and records how it went).
    { name: "jira", settings: () => ({ syncMinutes: JIRA_EVERY_MINUTES, lastSyncAt: jiraLastSyncAt() }), run: async () => startSync("jira") },
    // Outlook, Chrono, Punch (read only): every 15 minutes, 4 hours, a day — while the automation Chrome runs.
    { name: "calendar", settings: () => ({ syncMinutes: EVERY_MINUTES.calendar, lastSyncAt: lastSyncOf("calendar") }), run: whileChromeRuns("calendar") },
    { name: "chrono", settings: () => ({ syncMinutes: EVERY_MINUTES.chrono, lastSyncAt: lastSyncOf("chrono") }), run: whileChromeRuns("chrono") },
    { name: "punch", settings: () => ({ syncMinutes: EVERY_MINUTES.punch, lastSyncAt: lastSyncOf("punch") }), run: whileChromeRuns("punch") },
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
    // A backup when it's due (Settings → Backups) — at any hour, quiet ones too.
    try {
      const { backupDue, runBackup } = await import("./backup");
      if (backupDue()) {
        const r = await runBackup();
        if (!r.ok) console.warn(`[backup] ${r.message}`);
      }
    } catch (e) {
      console.error("[backup]", e);
    }
    for (const job of quietAt() ? [] : jobs) {
      try {
        if (!due(job.settings())) continue;
        const r = await job.run();
        if (!r.ok) console.warn(`[${job.name} sync] ${r.message}`);
      } catch (e) {
        console.error(`[${job.name} sync]`, e);
      }
    }
    setTimeout(tick, 60000).unref();
  };
  setTimeout(tick, 60000).unref(); // a minute after the server starts
}
