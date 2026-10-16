import { eq, sql, type AnyColumn } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getBoardSettings, latestRun } from "@/lib/boards/store";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { getPref } from "@/lib/prefs";
import { driverOf } from "@/lib/connectors/store";
import { getGitlabSettings } from "@/lib/gitlab/store";
import { getTeamsSettings } from "@/lib/teams/store";
import { getMailSettings } from "@/lib/mail/store";
import { SYNC_KEYS, type SyncKey, type SyncOverview, type SyncView } from "./shared";
import { stepAvailable } from "@/plugins/state";
import { inThisAccount } from "@/db/accounts";
import { ABORTED, sleep, withAbort } from "@/lib/abort";
import { noteSyncResult } from "./health";
import { stepMinutes } from "./intervals";
import { callHost, HostDownError } from "@/lib/host/client";
import { remoteResult } from "@/lib/host/commands";
import { delegates } from "@/lib/host/role";
import { integrationServer, integrationServerIds } from "@/lib/integrations/server";
/** Quiet hours: from 19:00 to 08:00 nothing syncs by itself (by hand it still does). */
export const QUIET = { from: 19, to: 8 };
export const quietAt = (at = new Date()) => at.getHours() >= QUIET.from || at.getHours() < QUIET.to;

const { syncState, jiraTickets } = schema;

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

/** Stop a step that's running (and what it started) — here, or on the sync host. Whether there was one. */
export async function stopSync(key: string): Promise<boolean> {
  if (!delegates()) return stopSyncHere(key);
  const r = await remoteResult("sync.stop", { key });
  return r.ok;
}

/** Stop a step that's running in this server (and what it started). Whether there was one. */
export function stopSyncHere(key: string): boolean {
  const c = stops().get(key);
  STEPS[key as SyncKey]?.stop?.();
  if (!c) return !!STEPS[key as SyncKey]?.stop;
  c.abort();
  return true;
}

/** Stop "Sync all": the step it's on, and no further ones. */
export async function stopSyncAll(): Promise<boolean> {
  if (!delegates()) return stopSyncAllHere();
  return (await remoteResult("sync.stopAll", {})).ok;
}

export function stopSyncAllHere(): boolean {
  const l = live();
  if (l.all === undefined) return false;
  l.allStopped = true;
  if (l.all) stopSyncHere(l.all);
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
export function recordedOr(key: SyncKey, column: AnyColumn): Last {
  const r = recorded(key);
  const at = iso(getDb().select({ at: sql<string | null>`max(${column})` }).from(column.table).get()?.at);
  return at && (!r.lastAt || at > r.lastAt) ? { lastAt: at, lastOk: true, lastMessage: null } : r;
}

function lastOf(key: "teams" | "gitlab" | "mail"): Last {
  const s = key === "teams" ? getTeamsSettings() : key === "mail" ? getMailSettings() : getGitlabSettings();
  return { lastAt: iso(s.lastSyncAt), lastOk: s.lastOk ?? null, lastMessage: s.lastResult ?? null };
}

export type SyncStep = {
  label: string;
  href: string;
  what: string;
  /** Run it to the end. Steps with a record of their own (ownRecord) keep it themselves. */
  run: () => Promise<{ ok: boolean; message: string }>;
  ownRecord?: boolean;
  /** Running by itself right now. */
  busy?: () => boolean;
  last?: () => Last;
  schedule?: () => { everyMinutes: number; lastAt: string | null; window?: string; workdays?: boolean };
  /** Stop it, when it doesn't run through runStoppable (the Ticket-Lage's own run). */
  stop?: () => void;
};

type Step = SyncStep;

/** The Monday ISO dates of the last and the current month's weeks. */
export async function lastAndCurrentWeeks(): Promise<string[]> {
  const { lastAndCurrentMonth } = await import("@/lib/month");
  const { last, current } = lastAndCurrentMonth();
  return [...last.weeks, ...current.weeks].map((w) => w.startIso);
}


/** When Jira last synced — through the menu, its page, or by itself. */
export const jiraLastSyncAt = () => recordedOr("jira", jiraTickets.syncedAt).lastAt;

/** When a step last ran, however it was started. */
export const lastSyncOf = (key: SyncKey) =>
  (key === "calendar" || key === "whatsapp" || key === "signal" || key === "keep" || key === "gcalendar" || key === "drivebackup" || key === "drivedocs" || key === "news" ? recorded(key) : (STEPS[key]?.last?.() ?? recorded(key))).lastAt;

/** Each step: how it runs, what it last did, when it runs by itself. All only read from elsewhere. */
const CORE_STEPS: Partial<Record<SyncKey, Step>> = {
  jira: {
    label: "Jira",
    href: "/jira",
    get what() { return t("Your tickets and the chosen boards' tickets"); },
    run: async () => {
      const { syncFromJira } = await import("@/lib/jira/sync");
      const { jiraDown } = await import("@/lib/jira/mcp-client");
      const r = await syncFromJira().catch((e) => {
        throw new Error(jiraDown(errorMessage(e)) ?? errorMessage(e));
      });
      const unread = r.unreadBoards
        ? ` ${t("{n} board(s) couldn't be read to the end — nothing deactivated, next sync tries again.", { n: r.unreadBoards })}`
        : "";
      const done = t("{total} tickets — {mine} yours ({inserted} new, {updated} updated).", { total: r.total, mine: r.mine, inserted: r.inserted, updated: r.updated });
      // The Jira boards' databases in the Workspace (Jira as a data source) follow at once.
      const { isInstalled } = await import("@/plugins/state");
      if (isInstalled("jira-lage") && isInstalled("workspace"))
        await (await import("@/plugins/jira-lage/to-workspace")).syncJiraBoardDatabases().catch((e) => console.error("[jira] keeping the boards' databases failed", e));
      // My briefing replaced by Meine Lage, a pipeline database (once); the databases with a pipeline keep their rows; their AI steps go with the briefing.
      if (isInstalled("jira-lage") && isInstalled("workspace")) await (await import("@/plugins/jira-lage/to-workspace")).replaceBriefingOnce().catch((e) => console.error("[jira] Meine Lage as a pipeline database failed", e));
      if (isInstalled("workspace")) await (await import("@/plugins/workspace/pipeline")).runPipelinesAfterSync().catch((e) => console.error("[workspace] the pipelines failed", e));
      return { ok: !unread, message: `${done}${unread}` };
    },
    last: () => recordedOr("jira", jiraTickets.syncedAt),
    schedule: () => ({ everyMinutes: stepMinutes("jira"), lastAt: recordedOr("jira", jiraTickets.syncedAt).lastAt }),
  },
  teams: {
    label: "Teams",
    href: "/teams",
    get what() { return t("Your mentions and 1:1 messages"); },
    ownRecord: true,
    run: async () => (await import("@/lib/teams/sync")).syncTeams(),
    busy: () => flag("__zeffTeamsSyncing"),
    last: () => lastOf("teams"),
    schedule: () => ({ everyMinutes: getTeamsSettings().syncMinutes, lastAt: iso(getTeamsSettings().lastSyncAt) }),
  },
  mail: {
    get label() { return t("Mail"); },
    href: "/mail",
    get what() { return t("Your inbox's latest mails (Outlook, Gmail — read from the list, none opened)"); },
    ownRecord: true,
    run: async () => (await import("@/lib/mail/sync")).syncMail(),
    busy: () => flag("__zeffMailSyncing"),
    last: () => lastOf("mail"),
    schedule: () => ({ everyMinutes: getMailSettings().syncMinutes, lastAt: iso(getMailSettings().lastSyncAt) }),
  },
  whatsapp: {
    label: "WhatsApp",
    href: "/mail?folder=WhatsApp",
    get what() { return t("Your chats' latest messages (WhatsApp Web's chat list — no chat opened, nothing marked read)"); },
    run: async () => (await import("@/lib/mail/sync")).syncWhatsapp(),
    busy: () => flag("__zeffWhatsappSyncing"),
    schedule: () => ({ everyMinutes: stepMinutes("whatsapp"), lastAt: recorded("whatsapp").lastAt, window: t("while the automation Chrome runs") }),
  },
  signal: {
    label: "Signal",
    href: "/mail?folder=Signal",
    get what() { return t("Your Signal chats' latest messages (from Signal Desktop — no chat opened, nothing marked read)"); },
    run: async () => (await import("@/lib/mail/sync")).syncSignal(),
    busy: () => flag("__zeffSignalSyncing"),
    schedule: () => ({ everyMinutes: stepMinutes("signal"), lastAt: recorded("signal").lastAt, window: t("while Signal Desktop runs") }),
  },
  keep: {
    label: "Google Keep",
    href: "/keep/google",
    get what() { return t("Your Google Keep notes (Keep opened in a fresh tab, what it loads kept — nothing in Keep changes)"); },
    run: async () => (await import("@/plugins/keep/sync")).syncKeep(),
    busy: () => flag("__zeffKeepSyncing"),
    schedule: () => ({ everyMinutes: stepMinutes("keep"), lastAt: recorded("keep").lastAt, window: t("while the automation Chrome runs") }),
  },
  news: {
    get label() { return t("News"); },
    href: "/news",
    get what() { return t("The news from your sources and searches for your interests — fetched, scored for you, old items removed (public feeds; nothing of yours is sent)"); },
    run: async () => (await import("@/plugins/news/sync")).syncNews(),
    busy: () => flag("__zeffNewsSyncing"),
    schedule: () => ({ everyMinutes: stepMinutes("news"), lastAt: recorded("news").lastAt, window: t("always") }),
  },
  gcalendar: {
    label: "Google Calendar",
    href: "/kalender",
    get what() { return t("Your Google calendars (the week view read in a fresh tab, week by week — nothing in Google changes)"); },
    run: async () => (await import("@/plugins/google-calendar/sync")).syncGoogleCalendar(),
    busy: () => flag("__zeffGcalSyncing"),
    schedule: () => ({ everyMinutes: stepMinutes("gcalendar"), lastAt: recorded("gcalendar").lastAt, window: driverOf("gcalendar") === "api" ? t("always") : t("while the automation Chrome runs") }),
  },
  // The Google Drive plugin's extensions for Backups and Documents (there while they're on):
  drivebackup: {
    label: "Backups → Google Drive",
    href: "/google-drive",
    get what() { return t("Your backups, copied to Google Drive as they are made (encrypted ones; what the retention removes goes from Drive too, if set)"); },
    run: async () => (await import("@/plugins/google-drive/sync")).syncBackups(),
    busy: () => flag("__zeffDriveBackup"),
    schedule: () => ({ everyMinutes: stepMinutes("drivebackup"), lastAt: recorded("drivebackup").lastAt }),
  },
  drivedocs: {
    label: "Documents ↔ Google Drive",
    href: "/google-drive",
    get what() { return t("Your documents, copied to Google Drive — and, if you set so, what you add to its Documents folder comes into Zeff"); },
    run: async () => (await import("@/plugins/google-drive/sync")).syncDocuments(),
    busy: () => flag("__zeffDriveDocs"),
    schedule: () => ({ everyMinutes: stepMinutes("drivedocs"), lastAt: recorded("drivedocs").lastAt }),
  },
  gitlab: {
    label: "GitLab",
    href: "/gitlab",
    get what() { return t("Merge requests, comments and branches"); },
    ownRecord: true,
    run: async () => (await import("@/lib/gitlab/sync")).syncGitlab(),
    busy: () => flag("__zeffGitlabSyncing"),
    last: () => lastOf("gitlab"),
    schedule: () => ({ everyMinutes: getGitlabSettings().syncMinutes, lastAt: iso(getGitlabSettings().lastSyncAt) }),
  },
  calendar: {
    get label() { return t("Calendar"); },
    href: "/calendar",
    get what() { return t("Outlook meetings, last month to next week (read-only)"); },
    run: async () => {
      const { outlookWeeks, syncOutlookWeekStarts } = await import("./pulls");
      const r = await syncOutlookWeekStarts(await outlookWeeks());
      return { ok: true, message: t("{weeks} weeks from Outlook — {events} events.", { weeks: r.weeks, events: r.events }) };
    },
    schedule: () => ({ everyMinutes: stepMinutes("calendar"), lastAt: lastSyncOf("calendar"), window: driverOf("outlook-calendar") === "api" ? t("always") : t("while the automation Chrome runs") }),
  },
  boards: {
    get label() { return t("Briefing"); },
    href: "/todos",
    get what() { return t("Your tickets through the AI: what happened, what's to do"); },
    ownRecord: true,
    run: async () => {
      const { startBoardRun, boardRunState } = await import("@/lib/boards/run");
      const r = startBoardRun();
      if (!r.ok) return r;
      // It runs in the background: wait for it, so "Sync all" ends when it does.
      while (boardRunState()) await sleep(2000);
      const run = latestRun();
      return run?.status === "ok" ? { ok: true, message: t("Briefing updated.") } : { ok: false, message: run?.error ?? t("The run failed.") };
    },
    stop: () => {
      void import("@/lib/boards/run").then((m) => m.stopBoardRun());
    },
    // The Lage itself: not while its run syncs first or relates the mails (their own steps show that).
    busy: () => {
      const r = (globalThis as { __zeffBoardRun?: { phase: string } | null }).__zeffBoardRun;
      return !!r && r.phase !== "sync" && r.phase !== "mailtodos" && r.phase !== "mails" && r.phase !== "notetodos" && r.phase !== "notes" && r.phase !== "documents" && r.phase !== "docrelations" && r.phase !== "knowledge" && r.phase !== "autoactions";
    },
    last: () => {
      const run = latestRun();
      if (!run || run.status === "running") return { lastAt: run ? iso(run.startedAt) : null, lastOk: null, lastMessage: null };
      return {
        lastAt: iso(run.finishedAt ?? run.startedAt),
        lastOk: run.status === "ok",
        lastMessage: run.status === "ok" ? t("{n} tickets", { n: run.tickets.filter((x) => x.analyzed).length }) : run.error,
      };
    },
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: iso(latestRun()?.startedAt), window: t("workdays"), workdays: true }),
  },
  mailtodos: {
    get label() { return t("Mail review"); },
    href: "/todos",
    get what() { return t("Todos from your mails — what they ask of you (trainings, deadlines, forms), by the AI (after each briefing)"); },
    run: async () => {
      const r = await (await import("@/lib/boards/mail-todos")).reviewMailsForTodos(
        (globalThis as { __zeffBoardRun?: { id: number } | null }).__zeffBoardRun?.id ?? null,
      );
      return r.ok
        ? {
            ok: true,
            message: `${t("{reviewed} mails reviewed, {added} new todos", { reviewed: r.reviewed, added: r.added })}${r.merged ? `, ${t("{n} merged into open ones", { n: r.merged })}` : ""}${r.updated ? `, ${t("{n} updated", { n: r.updated })}` : ""}${r.error ? ` (${r.error})` : ""}`,
          }
        : { ok: false, message: r.error ?? t("Failed.") };
    },
    busy: () => flag("__zeffMailTodos"),
    // It runs with the Ticket-Lage (after it, before the Mail-Zuordnung).
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("mailtodos").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
  autoactions: {
    get label() { return t("Auto actions"); },
    href: "/todos",
    get what() { return t("Ready actions for the todos without a button — by the AI, from what the installed plugins can do (after each briefing)"); },
    run: async () => {
      const r = await (await import("@/plugins/auto-actions/review")).reviewTodosForActions();
      return r.ok
        ? { ok: true, message: `${t("{reviewed} todos reviewed, {n} with actions", { reviewed: r.reviewed, n: r.withActions })}${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? t("Failed.") };
    },
    busy: () => flag("__zeffAutoActions"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("autoactions").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
  tododupes: {
    get label() { return t("Duplicate todos"); },
    href: "/todos",
    get what() { return t("Open todos that repeat an older one (the same message or numbers, mostly the same words) merged into the oldest, which keeps its id - the gate does the same for every new todo (after each briefing)"); },
    run: async () => {
      const { mergeDuplicateTodos } = await import("@/lib/boards/dedupe");
      const { attributed } = await import("@/lib/boards/activity");
      const r = attributed("merge", () => mergeDuplicateTodos({ actor: "merge" }));
      return { ok: true, message: r.merged ? t("{n} duplicates merged", { n: r.merged }) : t("No duplicates.") };
    },
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("tododupes").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
  boardlage: {
    get label() { return t("Board briefing"); },
    href: "/kanban",
    get what() { return t("The briefing on every relevant card of your boards — the Jira boards' tickets (not only yours) and your own boards' cards — shown on the cards (only what changed)"); },
    run: async () => {
      const r = await (await import("@/plugins/jira-lage/board-lage")).runBoardLage();
      // The Workspace databases with an AI review: their AI properties for the rows that changed — the same step.
      const { isInstalled } = await import("@/plugins/state");
      if (isInstalled("workspace") && isInstalled("llm")) {
        // (The databases' AI reviews ran in it.) The AI blocks set to go with the briefing (Meine Lage's overall picture among them) written again.
        await (await import("@/plugins/workspace/ai-block")).refreshAiBlocks().catch((e) => console.error("[workspace] the AI blocks failed", e));
        // The pipelines with their AI steps: the fields of the rows that changed, the summaries.
        await (await import("@/plugins/workspace/pipeline")).runPipelines({ ai: true }).catch((e) => console.error("[workspace] the pipelines failed", e));
      }
      return r.ok
        ? {
            ok: true,
            message: [
              r.all ? t("{n} tickets (all)", { n: r.relevant }) : t("{n} tickets (with you)", { n: r.relevant }),
              t("{n} reassessed", { n: r.analyzed }),
              t("{n} unchanged", { n: r.unchanged }),
              ...(r.failed ? [t("{n} failed", { n: r.failed })] : []),
            ].join(" · "),
          }
        : { ok: false, message: r.error ?? t("Failed.") };
    },
    busy: () => flag("__zeffBoardLage"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("boardlage").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
  relations: {
    get label() { return t("Mail matching"); },
    href: "/todos",
    get what() { return t("Which mails each open todo is about — the AI reads them by content (after each briefing)"); },
    run: async () => {
      const r = await (await import("@/lib/boards/mail-relations")).relateMails();
      return r.ok
        ? { ok: true, message: `${t("{todos} todos, {changed} changed", { todos: r.todos, changed: r.changed })}${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? t("Failed.") };
    },
    busy: () => flag("__zeffMailRelations"),
    // It runs with the Ticket-Lage (its last step).
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("relations").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
  // Google Keep's extensions for Todos (there while they're on — see extensions.ts):
  notetodos: {
    get label() { return t("Note review"); },
    href: "/keep",
    get what() { return t("Todos from your notes — new and edited ones (Google Keep, your Keep boards in the briefing), by the AI (after each briefing)"); },
    run: async () => {
      const r = await (await import("@/plugins/keep/note-review")).reviewNotesForTodos(
        (globalThis as { __zeffBoardRun?: { id: number } | null }).__zeffBoardRun?.id ?? null,
      );
      return r.ok
        ? { ok: true, message: `${t("{reviewed} notes reviewed, {added} new todos", { reviewed: r.reviewed, added: r.added })}${r.merged ? `, ${t("{n} merged into open ones", { n: r.merged })}` : ""}${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? t("Failed.") };
    },
    busy: () => flag("__zeffNoteTodos"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("notetodos").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
  noterelations: {
    get label() { return t("Note matching"); },
    href: "/todos",
    get what() { return t("Which notes each open todo is about — the AI reads them by content (after each briefing)"); },
    run: async () => {
      const r = await (await import("@/plugins/keep/note-relations")).relateNotes();
      return r.ok
        ? { ok: true, message: `${t("{todos} todos, {changed} changed", { todos: r.todos, changed: r.changed })}${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? t("Failed.") };
    },
    busy: () => flag("__zeffNoteRelations"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("noterelations").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
  // The Documents plugin's extensions for Todos (there while they're on):
  doctodos: {
    get label() { return t("Document review"); },
    href: "/documents",
    get what() { return t("Todos from your documents — what they ask of you: deadlines, bills, forms, open questions — new and changed ones, by the AI (after each briefing)"); },
    run: async () => {
      const r = await (await import("@/plugins/documents/review")).reviewDocumentsForTodos(
        (globalThis as { __zeffBoardRun?: { id: number } | null }).__zeffBoardRun?.id ?? null,
      );
      return r.ok
        ? { ok: true, message: `${t("{reviewed} documents reviewed, {added} new todos", { reviewed: r.reviewed, added: r.added })}${r.merged ? `, ${t("{n} merged into open ones", { n: r.merged })}` : ""}${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? t("Failed.") };
    },
    busy: () => flag("__zeffDocTodos"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("doctodos").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
  docrelations: {
    get label() { return t("Document matching"); },
    href: "/todos",
    get what() { return t("Which documents each open todo is about — the AI reads them by content (after each briefing)"); },
    run: async () => {
      const r = await (await import("@/plugins/documents/relations")).relateDocuments();
      return r.ok
        ? { ok: true, message: `${t("{todos} todos, {changed} changed", { todos: r.todos, changed: r.changed })}${r.error ? ` (${r.error})` : ""}` }
        : { ok: false, message: r.error ?? t("Failed.") };
    },
    busy: () => flag("__zeffDocRelations"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("docrelations").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
  peoplenorm: {
    get label() { return t("People matching"); },
    get href() {
      const db = getPref<number | null>("workspace.peopleDb", null);
      return db ? `/workspace/${db}` : "/workspace";
    },
    get what() { return t("Who is meant by the names in your todos — aliases added, profiles for contacts made, duplicates merged (after each briefing)"); },
    run: async () => {
      const r = await (await import("@/plugins/people/normalize")).normalizePeople();
      return r.ok ? { ok: true, message: t("{a} aliases, {c} new, {m} merged, {r} relations", { a: r.aliases, c: r.created, m: r.merged, r: r.relations }) } : { ok: false, message: r.error ?? t("Failed.") };
    },
    busy: () => flag("__zeffPeopleNormalize"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("peoplenorm").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
  knowledgerel: {
    get label() { return t("Knowledge matching"); },
    href: "/todos",
    get what() { return t("Which knowledge pages each open todo needs — the AI keeps only those that really fit (after each briefing)"); },
    run: async () => {
      const r = await (await import("@/plugins/knowledge/relations")).relateKnowledge();
      return r.ok ? { ok: true, message: t("{todos} todos reviewed, {n} with knowledge", { todos: r.todos, n: r.assigned }) } : { ok: false, message: r.error ?? t("Failed.") };
    },
    busy: () => flag("__zeffKnowledgeRelations"),
    schedule: () => ({ everyMinutes: getBoardSettings().autoMinutes, lastAt: recorded("knowledgerel").lastAt, window: t("workdays, with the briefing"), workdays: true }),
  },
};

/** The steps the mounted integrations bring (Chrono, Punch: src/lib/integrations) — by their key. */
const integrationSteps = (): Partial<Record<string, Step>> =>
  Object.fromEntries(integrationServerIds().flatMap((id) => { const x = integrationServer(id)?.syncStep; return x ? [[x.key, x.step]] : []; }));

/** Every step's key, in the menu's order: Zeff's own, the integrations' right after the calendar. */
const allKeys = (): SyncKey[] => {
  const own = Object.keys(integrationSteps());
  const at = SYNC_KEYS.indexOf("calendar") + 1;
  return [...SYNC_KEYS.slice(0, at), ...own, ...SYNC_KEYS.slice(at)];
};
export const isSyncKey = (v: unknown): v is SyncKey => allKeys().includes(v as SyncKey);

/**
 * Every step by its key. The integrations' are added on first use, not while this module loads: they import it
 * (for lastSyncOf, recordedOr …) and are themselves loaded by the generated mount.
 */
let allSteps: Record<SyncKey, Step> | undefined;
const STEPS = new Proxy({} as Record<SyncKey, Step>, {
  get: (_target, key) => (allSteps ??= { ...CORE_STEPS, ...integrationSteps() } as Record<SyncKey, Step>)[key as SyncKey],
});

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
  const steps: SyncView[] = allKeys().filter((key) => stepAvailable(key)).map((key) => {
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
      nextAt: sched ? nextRun(sched.everyMinutes, sched.lastAt, !!sched.workdays) : null,
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
  // The mails and messages it brought: into the databases whose pipelines read them (their rows only; the AI goes with the briefing).
  if (outcome?.ok && (key === "mail" || key === "teams" || key === "whatsapp" || key === "signal")) {
    const { isInstalled } = await import("@/plugins/state");
    if (isInstalled("workspace")) await (await import("@/plugins/workspace/pipeline")).runPipelinesAfterSync().catch((e) => console.error("[workspace] the pipelines failed", e));
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
  if (!delegates()) return syncAndWaitHere(key);
  try {
    return await callHost<Last>("sync.wait", { key }, 45 * 60000);
  } catch (e) {
    if (e instanceof HostDownError) return { lastAt: null, lastOk: false, lastMessage: e.message };
    throw e;
  }
}

export async function syncAndWaitHere(key: SyncKey): Promise<Last> {
  const l = live();
  if (l.running.has(key) || STEPS[key].busy?.()) {
    while (live().running.has(key) || STEPS[key].busy?.()) await sleep(1000);
  } else await runStep(key);
  return STEPS[key].last ? STEPS[key].last!() : recorded(key);
}

/** Start one step in the background (on the sync host, when there is one). */
export async function startSync(key: SyncKey): Promise<{ ok: boolean; message: string }> {
  return delegates() ? remoteResult("sync.start", { key }) : startSyncHere(key);
}

/** Start one step in the background, in this server. */
export function startSyncHere(key: SyncKey): { ok: boolean; message: string } {
  // Kept in the account it was started in — whichever is switched to while it runs.
  return inThisAccount(() => {
    if (!stepAvailable(key)) return { ok: false, message: t("{step}: not installed (Menu → Plugins).", { step: STEPS[key].label }) };
    if (live().running.has(key) || STEPS[key].busy?.()) return { ok: false, message: t("{step} is already syncing.", { step: STEPS[key].label }) };
    void runStep(key);
    return { ok: true, message: t("{step} is syncing.", { step: STEPS[key].label }) };
  });
}

/**
 * "Sync all": every step, one after the other (the drivers share one Chrome) — the Ticket-Lage
 * last, as it reads what the others brought.
 */
export async function startSyncAll(): Promise<{ ok: boolean; message: string }> {
  return delegates() ? remoteResult("sync.startAll", {}) : startSyncAllHere();
}

export function startSyncAllHere(): { ok: boolean; message: string } {
  // Kept in the account it was started in — whichever is switched to while it runs.
  return inThisAccount(() => {
    const l = live();
    if (l.all !== undefined) return { ok: false, message: t("Already syncing all.") };
    l.all = null;
    l.allStopped = false;
    void (async () => {
      try {
        // The Mail-Durchsicht and -Zuordnung come with the Ticket-Lage (its last steps) — not twice.
        for (const key of allKeys().filter((k) => k !== "relations" && k !== "mailtodos" && k !== "autoactions" && k !== "boardlage" && k !== "knowledgerel" && k !== "peoplenorm" && k !== "tododupes" && k !== "notetodos" && k !== "noterelations" && k !== "doctodos" && k !== "docrelations" && stepAvailable(k))) {
          if (l.allStopped) break;
          l.all = key;
          await runStep(key);
        }
      } finally {
        l.all = undefined;
      }
    })();
    return { ok: true, message: t("Syncing all.") };
  });
}
