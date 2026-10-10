import { eq, sql, type AnyColumn } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getBoardSettings, latestRun } from "@/lib/boards/store";
import { errorMessage } from "@/lib/errors";
import { getGitlabSettings } from "@/lib/gitlab/store";
import { getTeamsSettings } from "@/lib/teams/store";
import { getMailSettings } from "@/lib/mail/store";
import { SYNC_KEYS, type SyncKey, type SyncOverview, type SyncView } from "./shared";
import { stepAvailable } from "@/plugins/state";
import { ABORTED, withAbort } from "@/lib/abort";
import { noteSyncResult } from "./health";
import { stepMinutes } from "./intervals";

/** Quiet hours: from 19:00 to 08:00 nothing syncs by itself (by hand it still does). */
export const QUIET = { from: 19, to: 8 };
export const quietAt = (at = new Date()) => at.getHours() >= QUIET.from || at.getHours() < QUIET.to;

const { syncState, jiraTickets, roarEntries, timoDays } = schema;

/** What's running from the menu, and "Sync all" (the step it's on) — across the server's module copies. */
const state = globalThis as {
  __zeffSyncs?: { running: Set<SyncKey>; all: SyncKey | null | undefined; stops?: Map<string, AbortController>; allStopped?: boolean };
};
const live = () => (state.__zeffSyncs ??= { running: new Set(), all: undefined });
/** The running syncs' stop handles, by step (the menu's, the scheduler's, a page's button). */
const stops = () => (live().stops ??= new Map());

/**
 * Run something as a step that can be stopped (Sync menu → Stopp): whatever it starts — a driver,
 * an AI CLI — ends with it. The scheduler's syncs and the pages' buttons run through here too.
 */
export async function runStoppable<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const c = new AbortController();
  stops().set(key, c);
  try {
    return await withAbort(c, fn);
  } finally {
    if (stops().get(key) === c) stops().delete(key);
  }
}

/** Stop a step that's running (and what it started). Whether there was one. */
export function stopSync(key: string): boolean {
  const c = stops().get(key);
  STEPS[key as SyncKey]?.stop?.();
  if (!c) return !!STEPS[key as SyncKey]?.stop;
  c.abort();
  return true;
}

/** Stop "Sync all": the step it's on, and no further ones. */
export function stopSyncAll(): boolean {
  const l = live();
  if (l.all === undefined) return false;
  l.allStopped = true;
  if (l.all) stopSync(l.all);
  return true;
}

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
  /** Stop it, when it doesn't run through runStoppable (the Ticket-Lage's own run). */
  stop?: () => void;
};

/** The Monday ISO dates of the last and the current month's weeks. */
async function lastAndCurrentWeeks(): Promise<string[]> {
  const { lastAndCurrentMonth } = await import("@/lib/month");
  const { last, current } = lastAndCurrentMonth();
  return [...last.weeks, ...current.weeks].map((w) => w.startIso);
}


/** When Jira last synced — through the menu, its page, or by itself. */
export const jiraLastSyncAt = () => recordedOr("jira", jiraTickets.syncedAt).lastAt;

/** When a step last ran, however it was started. */
export const lastSyncOf = (key: "calendar" | "roar" | "timo" | "whatsapp" | "keep") =>
  (key === "calendar" || key === "whatsapp" || key === "keep" ? recorded(key) : recordedOr(key, key === "roar" ? roarEntries.pulledAt : timoDays.pulledAt)).lastAt;

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
    schedule: () => ({ everyMinutes: stepMinutes("jira"), lastAt: recordedOr("jira", jiraTickets.syncedAt).lastAt }),
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
    what: "Your inbox's latest mails (Outlook, Gmail — read from the list, none opened)",
    ownRecord: true,
    run: async () => (await import("@/lib/mail/sync")).syncMail(),
    busy: () => flag("__zeffMailSyncing"),
    last: () => lastOf("mail"),
    schedule: () => ({ everyMinutes: getMailSettings().syncMinutes, lastAt: iso(getMailSettings().lastSyncAt) }),
  },
  whatsapp: {
    label: "WhatsApp",
    href: "/mail?folder=WhatsApp",
    what: "Your chats' latest messages (WhatsApp Web's chat list — no chat opened, nothing marked read)",
    run: async () => (await import("@/lib/mail/sync")).syncWhatsapp(),
    busy: () => flag("__zeffWhatsappSyncing"),
    schedule: () => ({ everyMinutes: stepMinutes("whatsapp"), lastAt: recorded("whatsapp").lastAt, window: "while the automation Chrome runs" }),
  },
  keep: {
    label: "Google Keep",
    href: "/keep/google",
    what: "Your Google Keep notes (Keep opened in a fresh tab, what it loads kept — nothing in Keep changes)",
    run: async () => (await import("@/plugins/keep/sync")).syncKeep(),
    busy: () => flag("__zeffKeepSyncing"),
    schedule: () => ({ everyMinutes: stepMinutes("keep"), lastAt: recorded("keep").lastAt, window: "while the automation Chrome runs" }),
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
    schedule: () => ({ everyMinutes: stepMinutes("calendar"), lastAt: lastSyncOf("calendar"), window: "while the automation Chrome runs" }),
  },
  roar: {
    label: "Roar",
    href: "/month",
    what: "Your Roar entries' approvals, last and this month (read-only)",
    run: async () => (await import("./pulls")).pullRoarWeekStarts(await lastAndCurrentWeeks()),
    last: () => recordedOr("roar", roarEntries.pulledAt),
    schedule: () => ({ everyMinutes: stepMinutes("roar"), lastAt: lastSyncOf("roar"), window: "while the automation Chrome runs" }),
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
    schedule: () => ({ everyMinutes: stepMinutes("timo"), lastAt: lastSyncOf("timo"), window: "while the automation Chrome runs" }),
  },
  boards: {
    label: "Ticket-Lage",
    href: "/todos",
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
    stop: () => {
      void import("@/lib/boards/run").then((m) => m.stopBoardRun());
    },
    // The Lage itself: not while its run syncs first or relates the mails (their own steps show that).
    busy: () => {
      const r = (globalThis as { __zeffBoardRun?: { phase: string } | null }).__zeffBoardRun;
      return !!r && r.phase !== "sync" && r.phase !== "mailtodos" && r.phase !== "mails" && r.phase !== "notetodos" && r.phase !== "notes" && r.phase !== "knowledge" && r.phase !== "autoactions";
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
    href: "/todos",
    what: "Todos from your mails — what they ask of you (trainings, deadlines, forms), by the AI (after each Ticket-Lage)",
    run: async () => {
      const r = await (await import("@/lib/boards/mail-todos")).reviewMailsForTodos(
        (globalThis as { __zeffBoardRun?: { id: number } | null }).__zeffBoardRun?.id ?? null,
      );
      return r.ok
        ? { ok: true, message: `${r.reviewed} Mails durchgesehen, ${r.added} neue Todos${r.updated ? `, ${r.updated} ergänzt` : ""}${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? "Fehlgeschlagen." };
    },
    busy: () => flag("__zeffMailTodos"),
    // It runs with the Ticket-Lage (after it, before the Mail-Zuordnung).
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("mailtodos").lastAt, window: "workdays, with the Ticket-Lage" }),
  },
  autoactions: {
    label: "Auto-Aktionen",
    href: "/todos",
    what: "Ready actions for the todos without a button — by the AI, from what the installed plugins can do (after each Ticket-Lage)",
    run: async () => {
      const r = await (await import("@/plugins/auto-actions/review")).reviewTodosForActions();
      return r.ok
        ? { ok: true, message: `${r.reviewed} Todos durchgesehen, ${r.withActions} mit Aktionen${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? "Fehlgeschlagen." };
    },
    busy: () => flag("__zeffAutoActions"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("autoactions").lastAt, window: "workdays, with the Ticket-Lage" }),
  },
  boardlage: {
    label: "Board-Lage",
    href: "/kanban",
    what: "The Lage of every relevant ticket on your Jira boards (not only yours) — for the Kanban cards (by hand: a Jira board's Auswerten; only what changed)",
    run: async () => {
      const r = await (await import("@/plugins/jira-lage/board-lage")).runBoardLage();
      return r.ok
        ? { ok: true, message: `${r.relevant} Tickets ${r.all ? "(alle)" : "(mit dir)"} · ${r.analyzed} neu eingeschätzt · ${r.unchanged} unverändert${r.failed ? ` · ${r.failed} fehlgeschlagen` : ""}` }
        : { ok: false, message: r.error ?? "Fehlgeschlagen." };
    },
    busy: () => flag("__zeffBoardLage"),
    schedule: () => ({ everyMinutes: 0, lastAt: recorded("boardlage").lastAt, window: "by hand — a Jira board's Auswerten" }),
  },
  relations: {
    label: "Mail-Zuordnung",
    href: "/todos",
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
  // Google Keep's extensions for Todos (there while they're on — see extensions.ts):
  notetodos: {
    label: "Notiz-Durchsicht",
    href: "/keep",
    what: "Todos from your notes — new and edited ones (Google Keep, your Keep boards in the Lage), by the AI (after each Ticket-Lage)",
    run: async () => {
      const r = await (await import("@/plugins/keep/note-review")).reviewNotesForTodos(
        (globalThis as { __zeffBoardRun?: { id: number } | null }).__zeffBoardRun?.id ?? null,
      );
      return r.ok
        ? { ok: true, message: `${r.reviewed} Notizen durchgesehen, ${r.added} neue Todos${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? "Fehlgeschlagen." };
    },
    busy: () => flag("__zeffNoteTodos"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("notetodos").lastAt, window: "workdays, with the Ticket-Lage" }),
  },
  noterelations: {
    label: "Notiz-Zuordnung",
    href: "/todos",
    what: "Which notes each open todo is about — the AI reads them by content (after each Ticket-Lage)",
    run: async () => {
      const r = await (await import("@/plugins/keep/note-relations")).relateNotes();
      return r.ok
        ? { ok: true, message: `${r.todos} Todos, ${r.changed} geändert${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? "Fehlgeschlagen." };
    },
    busy: () => flag("__zeffNoteRelations"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("noterelations").lastAt, window: "workdays, with the Ticket-Lage" }),
  },
  knowledgerel: {
    label: "Wissens-Zuordnung",
    href: "/todos",
    what: "Which knowledge pages each open todo needs — the AI keeps only those that really fit (after each Ticket-Lage)",
    run: async () => {
      const r = await (await import("@/plugins/knowledge/relations")).relateKnowledge();
      return r.ok ? { ok: true, message: `${r.todos} Todos durchgesehen, ${r.assigned} mit Wissen` } : { ok: false, message: r.error ?? "Fehlgeschlagen." };
    },
    busy: () => flag("__zeffKnowledgeRelations"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("knowledgerel").lastAt, window: "workdays, with the Ticket-Lage" }),
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
  // Only the steps there are: Zeff's own and the installed plugins'.
  const steps: SyncView[] = SYNC_KEYS.filter((key) => stepAvailable(key)).map((key) => {
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
  // A plugin's step while it isn't installed: nothing.
  if (!stepAvailable(key)) return;
  if (l.running.has(key) || STEPS[key].busy?.()) return;
  l.running.add(key);
  let outcome: { ok: boolean; message: string } | null = null;
  try {
    const r = await runStoppable(key, () => STEPS[key].run());
    outcome = { ok: r.ok, message: r.message };
    if (!STEPS[key].ownRecord) record(key, r.ok, r.message);
  } catch (e) {
    outcome = { ok: false, message: errorMessage(e) };
    if (!STEPS[key].ownRecord) record(key, false, errorMessage(e));
  } finally {
    l.running.delete(key);
  }
  // Over time (since when it fails): a stop isn't a failure. Steps with a record of their own: as they kept it.
  if (STEPS[key].ownRecord && STEPS[key].last) {
    const last = STEPS[key].last!();
    if (last.lastOk !== null) outcome = { ok: last.lastOk, message: last.lastMessage ?? "" };
  }
  if (outcome && !outcome.message.includes(ABORTED)) {
    try {
      noteSyncResult(key, outcome.ok, outcome.message);
    } catch {
      // the record of how it went stands; only the history is missing a run
    }
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
  if (!stepAvailable(key)) return { ok: false, message: `${STEPS[key].label}: das Plugin ist nicht installiert (Settings → Plugins).` };
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
  l.allStopped = false;
  void (async () => {
    try {
      // The Mail-Durchsicht and -Zuordnung come with the Ticket-Lage (its last steps) — not twice.
      for (const key of SYNC_KEYS.filter((k) => k !== "relations" && k !== "mailtodos" && k !== "autoactions" && k !== "boardlage" && k !== "knowledgerel" && k !== "notetodos" && k !== "noterelations" && stepAvailable(k))) {
        if (l.allStopped) break;
        l.all = key;
        await runStep(key);
      }
    } finally {
      l.all = undefined;
    }
  })();
  return { ok: true, message: "Syncing all." };
}
