import { eq, sql, type AnyColumn } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getBoardSettings, latestRun } from "@/lib/boards/store";
import { errorMessage } from "@/lib/errors";
import { getGitlabSettings } from "@/lib/gitlab/store";
import { getTeamsSettings } from "@/lib/teams/store";
import { getMailSettings } from "@/lib/mail/store";
import { SYNC_KEYS, type SyncKey, type SyncOverview, type SyncView } from "./shared";

/** Quiet hours: from 19:00 to 08:00 nothing syncs by itself (by hand it still does). */
export const QUIET = { from: 19, to: 8 };
export const quietAt = (at = new Date()) => at.getHours() >= QUIET.from || at.getHours() < QUIET.to;

const { syncState, jiraTickets, roarEntries, timoDays } = schema;

/** What's running from the menu, and "Sync all" (the step it's on) — across the server's module copies. */
const state = globalThis as { __zeffSyncs?: { running: Set<SyncKey>; all: SyncKey | null | undefined } };
const live = () => (state.__zeffSyncs ??= { running: new Set(), all: undefined });

/** A flag another module keeps on globalThis while its sync runs (the scheduler, a page's button). */
const flag = (name: string) => !!(globalThis as Record<string, unknown>)[name];

/** Stored "YYYY-MM-DD HH:MM:SS" (UTC, SQLite's) or ISO → ISO. */
const iso = (t: string | null | undefined) => (!t ? null : /^\d{4}-\d{2}-\d{2} /.test(t) ? `${t.replace(" ", "T")}Z` : t);

type Last = { lastAt: string | null; lastOk: boolean | null; lastMessage: string | null };

/** How a step without a record of its own last went. */
function recorded(key: SyncKey): Last {
  const r = getDb().select().from(syncState).where(eq(syncState.key, key)).get();
  return { lastAt: r?.lastAt ?? null, lastOk: r?.lastOk ?? null, lastMessage: r?.lastMessage ?? null };
}

function record(key: SyncKey, ok: boolean, message: string): void {
  const row = { lastAt: new Date().toISOString(), lastOk: ok, lastMessage: message.slice(0, 500) };
  getDb().insert(syncState).values({ key, ...row }).onConflictDoUpdate({ target: syncState.key, set: row }).run();
}

/**
 * A step its page runs too (not through here): the later of this menu's record and when its
 * data last came in (`column`: the newest of it).
 */
function recordedOr(key: SyncKey, column: AnyColumn): Last {
  const r = recorded(key);
  const at = iso(getDb().select({ at: sql<string | null>`max(${column})` }).from(column.table).get()?.at);
  return at && (!r.lastAt || at > r.lastAt) ? { lastAt: at, lastOk: true, lastMessage: null } : r;
}

function lastOf(key: "teams" | "gitlab" | "mail"): Last {
  const s = key === "teams" ? getTeamsSettings() : key === "mail" ? getMailSettings() : getGitlabSettings();
  return { lastAt: iso(s.lastSyncAt), lastOk: s.lastOk ?? null, lastMessage: s.lastResult ?? null };
}

type Step = {
  label: string;
  href: string;
  what: string;
  /** Run it to the end. Steps with a record of their own (ownRecord) keep it themselves. */
  run: () => Promise<{ ok: boolean; message: string }>;
  ownRecord?: boolean;
  /** Running by itself right now. */
  busy?: () => boolean;
  last?: () => Last;
  schedule?: () => { everyMinutes: number; lastAt: string | null; window?: string };
};

/** The Monday ISO dates of the last and the current month's weeks. */
async function lastAndCurrentWeeks(): Promise<string[]> {
  const { lastAndCurrentMonth } = await import("@/lib/month");
  const { last, current } = lastAndCurrentMonth();
  return [...last.weeks, ...current.weeks].map((w) => w.startIso);
}

/** How often the steps without settings of their own sync by themselves (the scheduler), in minutes. */
export const EVERY_MINUTES = { jira: 15, calendar: 15, roar: 240, timo: 1440 } as const;
/** Kept for the scheduler's Jira job. */
export const JIRA_EVERY_MINUTES = EVERY_MINUTES.jira;

/** When Jira last synced — through the menu, its page, or by itself. */
export const jiraLastSyncAt = () => recordedOr("jira", jiraTickets.syncedAt).lastAt;

/** When a step last ran, however it was started. */
export const lastSyncOf = (key: "calendar" | "roar" | "timo") => (key === "calendar" ? recorded("calendar") : recordedOr(key, key === "roar" ? roarEntries.pulledAt : timoDays.pulledAt)).lastAt;

/** Each step: how it runs, what it last did, when it runs by itself. All only read from elsewhere. */
const STEPS: Record<SyncKey, Step> = {
  jira: {
    label: "Jira",
    href: "/jira",
    what: "Your tickets and the chosen boards' tickets",
    run: async () => {
      const { syncFromJira } = await import("@/lib/jira/sync");
      const { jiraDown } = await import("@/lib/jira/mcp-client");
      const r = await syncFromJira().catch((e) => {
        throw new Error(jiraDown(errorMessage(e)) ?? errorMessage(e));
      });
      return { ok: true, message: `${r.total} tickets — ${r.mine} yours (${r.inserted} new, ${r.updated} updated).` };
    },
    last: () => recordedOr("jira", jiraTickets.syncedAt),
    schedule: () => ({ everyMinutes: JIRA_EVERY_MINUTES, lastAt: recordedOr("jira", jiraTickets.syncedAt).lastAt }),
  },
  teams: {
    label: "Teams",
    href: "/teams",
    what: "Your mentions and 1:1 messages",
    ownRecord: true,
    run: async () => (await import("@/lib/teams/sync")).syncTeams(),
    busy: () => flag("__zeffTeamsSyncing"),
    last: () => lastOf("teams"),
    schedule: () => ({ everyMinutes: getTeamsSettings().syncMinutes, lastAt: iso(getTeamsSettings().lastSyncAt) }),
  },
  mail: {
    label: "Mail",
    href: "/mail",
    what: "Your inbox's latest mails (read in Outlook, none opened)",
    ownRecord: true,
    run: async () => (await import("@/lib/mail/sync")).syncMail(),
    busy: () => flag("__zeffMailSyncing"),
    last: () => lastOf("mail"),
    schedule: () => ({ everyMinutes: getMailSettings().syncMinutes, lastAt: iso(getMailSettings().lastSyncAt) }),
  },
  gitlab: {
    label: "GitLab",
    href: "/gitlab",
    what: "Merge requests, comments and branches",
    ownRecord: true,
    run: async () => (await import("@/lib/gitlab/sync")).syncGitlab(),
    busy: () => flag("__zeffGitlabSyncing"),
    last: () => lastOf("gitlab"),
    schedule: () => ({ everyMinutes: getGitlabSettings().syncMinutes, lastAt: iso(getGitlabSettings().lastSyncAt) }),
  },
  calendar: {
    label: "Calendar",
    href: "/calendar",
    what: "Outlook meetings, last month to next week (read-only)",
    run: async () => {
      const { outlookWeeks, syncOutlookWeekStarts } = await import("./pulls");
      const r = await syncOutlookWeekStarts(await outlookWeeks());
      return { ok: true, message: `${r.weeks} weeks from Outlook — ${r.events} events.` };
    },
    schedule: () => ({ everyMinutes: EVERY_MINUTES.calendar, lastAt: lastSyncOf("calendar"), window: "while the automation Chrome runs" }),
  },
  roar: {
    label: "Roar",
    href: "/month",
    what: "Your Roar entries' approvals, last and this month (read-only)",
    run: async () => (await import("./pulls")).pullRoarWeekStarts(await lastAndCurrentWeeks()),
    last: () => recordedOr("roar", roarEntries.pulledAt),
    schedule: () => ({ everyMinutes: EVERY_MINUTES.roar, lastAt: lastSyncOf("roar"), window: "while the automation Chrome runs" }),
  },
  timo: {
    label: "TimO",
    href: "/",
    what: "What TimO has on this and last week's days (read-only)",
    run: async () => {
      const { currentWeek, shiftWeek, isoDate } = await import("@/lib/week");
      const days = [shiftWeek(currentWeek(), -1), currentWeek()].flatMap((w) => w.days.map(isoDate));
      await (await import("./pulls")).pullTimoIsoDays(days);
      return { ok: true, message: `Read TimO for ${days.length} days.` };
    },
    last: () => recordedOr("timo", timoDays.pulledAt),
    schedule: () => ({ everyMinutes: EVERY_MINUTES.timo, lastAt: lastSyncOf("timo"), window: "while the automation Chrome runs" }),
  },
  boards: {
    label: "Ticket-Lage",
    href: "/boards",
    what: "Your tickets through the AI: what happened, what's to do",
    ownRecord: true,
    run: async () => {
      const { startBoardRun, boardRunState } = await import("@/lib/boards/run");
      const r = startBoardRun();
      if (!r.ok) return r;
      // It runs in the background: wait for it, so "Sync all" ends when it does.
      while (boardRunState()) await new Promise((res) => setTimeout(res, 2000));
      const run = latestRun();
      return run?.status === "ok" ? { ok: true, message: "Ticket-Lage updated." } : { ok: false, message: run?.error ?? "The run failed." };
    },
    // The Lage itself: not while its run syncs first or relates the mails (their own steps show that).
    busy: () => {
      const r = (globalThis as { __zeffBoardRun?: { phase: string } | null }).__zeffBoardRun;
      return !!r && r.phase !== "sync" && r.phase !== "mailtodos" && r.phase !== "mails";
    },
    last: () => {
      const run = latestRun();
      if (!run || run.status === "running") return { lastAt: run ? iso(run.startedAt) : null, lastOk: null, lastMessage: null };
      return {
        lastAt: iso(run.finishedAt ?? run.startedAt),
        lastOk: run.status === "ok",
        lastMessage: run.status === "ok" ? `${run.tickets.filter((t) => t.analyzed).length} tickets` : run.error,
      };
    },
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: iso(latestRun()?.startedAt), window: "workdays" }),
  },
  mailtodos: {
    label: "Mail-Durchsicht",
    href: "/boards",
    what: "Todos from your mails — what they ask of you (trainings, deadlines, forms), by the AI (after each Ticket-Lage)",
    run: async () => {
      const r = await (await import("@/lib/boards/mail-todos")).reviewMailsForTodos(
        (globalThis as { __zeffBoardRun?: { id: number } | null }).__zeffBoardRun?.id ?? null,
      );
      return r.ok
        ? { ok: true, message: `${r.reviewed} Mails durchgesehen, ${r.added} neue Todos${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? "Fehlgeschlagen." };
    },
    busy: () => flag("__zeffMailTodos"),
    // It runs with the Ticket-Lage (after it, before the Mail-Zuordnung).
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("mailtodos").lastAt, window: "workdays, with the Ticket-Lage" }),
  },
  relations: {
    label: "Mail-Zuordnung",
    href: "/boards",
    what: "Which mails each open todo is about — the AI reads them by content (after each Ticket-Lage)",
    run: async () => {
      const r = await (await import("@/lib/boards/mail-relations")).relateMails();
      return r.ok
        ? { ok: true, message: `${r.todos} Todos, ${r.changed} geändert${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? "Fehlgeschlagen." };
    },
    busy: () => flag("__zeffMailRelations"),
    // It runs with the Ticket-Lage (its last step).
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("relations").lastAt, window: "workdays, with the Ticket-Lage" }),
  },
};

/** The next time a step runs by itself — within its window (workdays 7–20 h) when it has one. */
function nextRun(everyMinutes: number, lastAt: string | null, workdaysOnly = false): string | null {
  if (!everyMinutes) return null;
  let next = new Date(lastAt ? new Date(lastAt).getTime() + everyMinutes * 60000 : Date.now());
  if (next.getTime() < Date.now()) next = new Date(Date.now() + 60000); // due: the scheduler's next minute
  // Not in the quiet hours (and, for the workday ones, not at the weekend): the next morning then.
  for (let i = 0; i < 8; i++) {
    const day = !workdaysOnly || (next.getDay() >= 1 && next.getDay() <= 5);
    const h = next.getHours();
    if (day && !quietAt(next)) break;
    const n = new Date(next);
    if (day && h < QUIET.to) n.setHours(QUIET.to, 0, 0, 0);
    else {
      n.setDate(n.getDate() + 1);
      n.setHours(QUIET.to, 0, 0, 0);
    }
    next = n;
  }
  return next.toISOString();
}

/** All steps as the menu shows them. */
export function syncOverview(): SyncOverview {
  const l = live();
  const steps: SyncView[] = SYNC_KEYS.map((key) => {
    const s = STEPS[key];
    const sched = s.schedule?.();
    return {
      key,
      label: s.label,
      href: s.href,
      what: s.what,
      running: l.running.has(key) || !!s.busy?.(),
      ...(s.last ? s.last() : recorded(key)),
      everyMinutes: sched?.everyMinutes ?? 0,
      nextAt: sched ? nextRun(sched.everyMinutes, sched.lastAt, !!sched.window?.startsWith("workdays")) : null,
      window: sched?.window ?? null,
    };
  });
  return { all: { running: l.all !== undefined, step: l.all ?? null }, steps };
}

/** Run one step to the end, keeping how it went. */
async function runStep(key: SyncKey): Promise<void> {
  const l = live();
  if (l.running.has(key) || STEPS[key].busy?.()) return;
  l.running.add(key);
  try {
    const r = await STEPS[key].run();
    if (!STEPS[key].ownRecord) record(key, r.ok, r.message);
  } catch (e) {
    if (!STEPS[key].ownRecord) record(key, false, errorMessage(e));
  } finally {
    l.running.delete(key);
  }
}

/** Run one step and wait for it (one already going: wait for that one). How it went. */
export async function syncAndWait(key: SyncKey): Promise<Last> {
  const l = live();
  if (l.running.has(key) || STEPS[key].busy?.()) {
    while (live().running.has(key) || STEPS[key].busy?.()) await new Promise((r) => setTimeout(r, 1000));
  } else await runStep(key);
  return STEPS[key].last ? STEPS[key].last!() : recorded(key);
}

/** Start one step in the background. */
export function startSync(key: SyncKey): { ok: boolean; message: string } {
  if (live().running.has(key) || STEPS[key].busy?.()) return { ok: false, message: `${STEPS[key].label} is already syncing.` };
  void runStep(key);
  return { ok: true, message: `${STEPS[key].label} is syncing.` };
}

/**
 * "Sync all": every step, one after the other (the drivers share one Chrome) — the Ticket-Lage
 * last, as it reads what the others brought.
 */
export function startSyncAll(): { ok: boolean; message: string } {
  const l = live();
  if (l.all !== undefined) return { ok: false, message: "Already syncing all." };
  l.all = null;
  void (async () => {
    try {
      // The Mail-Durchsicht and -Zuordnung come with the Ticket-Lage (its last steps) — not twice.
      for (const key of SYNC_KEYS.filter((k) => k !== "relations" && k !== "mailtodos")) {
        l.all = key;
        await runStep(key);
      }
    } finally {
      l.all = undefined;
    }
  })();
  return { ok: true, message: "Syncing all." };
}
