/**
 * The auto-actions review (a step of its own after the Ticket-Lage): the AI goes through the open
 * todos that have no button yet — each with all it has (the ticket, its people and transitions,
 * where the todo comes from, the notes) — and proposes the actions that do it or move it on, from
 * what the installed plugins offer (a comment, a message, a mail draft, an appointment, a hand-over
 * to a worker …). Complete and ready: one click runs them. Server only.
 */
import { throwIfAborted } from "@/lib/abort";
import { extraBlock } from "@/lib/boards/context-prefs";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { aiChoice, runAi } from "@/lib/ai";
import { emitChange } from "@/lib/events";
import { errorMessage } from "@/lib/errors";
import { cleanOps, opsDictionary, sourcesOf, TODO_KIND_LABELS, type TodoOp, type TodoView } from "@/lib/boards/shared";
import { plain } from "@/lib/boards/collect";
import { todoSources } from "@/lib/boards/sources";
import { lastGoodRun, listTodos } from "@/lib/boards/store";
import { entityHeadline, entitySourceLabel, entityText, entityWhoWhen } from "@/lib/entities-shared";
import { myJiraName, getJiraTicket } from "@/lib/jira/store";
import { readInbox } from "@/lib/calendar/inbox";
import { parseLocalDateTime } from "@/lib/calendar/meetings";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { opAvailable } from "@/plugins/ops";

const { todos, emails } = schema;

/** A prompt's room (Copilot takes it on the command line) — and at most this many todos in one (a broken answer costs less). */
const BATCH_CHARS = COPILOT_MAX_PROMPT - 9000;
const BATCH_TODOS = 6;

const SCHEMA = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          ops: { type: "array", items: { type: "object" } },
          why: { type: "string" },
        },
        required: ["id", "ops", "why"],
      },
    },
  },
  required: ["todos"],
};
type Answer = { todos?: { id?: number; ops?: unknown[]; why?: string }[] };

const INSTRUCTIONS = (me: string, today: string) => `Du machst aus Todos Aktionen, die ich (${me || "der Nutzer"}) mit EINEM Klick ausführe. Heute ist ${today}.

Unten stehen offene Todos — jedes mit seinem Ticket (Status, Beteiligte mit Benutzernamen, mögliche Übergänge), woher es kommt (Kommentare, Teams-Nachrichten, Mails mit Kennung), meinen Notizen und Berichten. Und das Wörterbuch der Aktionen, die ich habe.

Tickets mit KB-… sind meine eigenen Kanban-Karten in Zeff, keine Jira-Tickets: für sie keine Jira-Aktionen (kein Kommentar, Übergang, Zuweisung in Jira) — Mails, Teams, Termine und Work gehen.

Für JEDES Todo: welche Aktionen erledigen es oder bringen es den nächsten echten Schritt weiter? Denk wie ein Assistent, der mir die Arbeit abnimmt:
- Eine Frage, Bitte oder Absprache mit jemandem → die fertige Nachricht an die Person (teams-message für Kollegen; mail-compose für Leute, die per Mail schreiben, mit ihrer Adresse aus dem Adressbuch unten), oder ein jira-comment, wenn es ins Ticket gehört.
- Etwas gemeinsam prüfen / abstimmen / vorführen → calendar-event mit der Person (Adresse aus dem Adressbuch), dazu ggf. eine kurze teams-message.
- Warten auf jemanden (wartet auf andere: ein Approval, eine Antwort, ein Test) → ein freundliches Nachhaken (teams-message) an genau die Person, auf die gewartet wird — mit dem, was du brauchst.
- Steht im Todo ein späterer Zeitpunkt („ab 12.10.“, „nach dem Deployment am 13.10.“) → ein calendar-event an diesem Tag als Erinnerung (ohne Teilnehmer), mit dem, was dann zu tun ist.
- Etwas, das nur ich selbst tun kann (selbst testen, ein Formular, eine Schulung, etwas vor Ort) → ein calendar-event als Zeitblock für mich (ohne Teilnehmer, realistische Dauer, nächster sinnvoller Werktag).
- Termine: in eine freie Zeit (meine belegten Zeiten stehen unten), Werktag 9–17 Uhr; Teilnehmer nur mit Adresse aus dem Adressbuch — ohne Adresse lädst du die Person per teams-message ein.
- Nach einer Übergabe an einen Worker (work-instruct) legt Zeff selbst ein Todo zum Testen an — dafür keinen eigenen Termin.
- Ticket-Pflege (Status, Zuweisung, Kommentar, neues Ticket) → jira-transition / jira-assign / jira-comment / jira-create — Übergänge nur aus den möglichen, Zuweisungen mit dem Benutzernamen.
- Antwort auf einen GitLab-Kommentar / Thread erledigt → gitlab-reply / gitlab-resolve mit note:<id>.
- Etwas umsetzen, fixen, im Code nachsehen, ausarbeiten → work-instruct mit einer konkreten, vollständigen Anweisung.
- Mehrere Aktionen, wenn sie zusammengehören (z. B. Kommentar + Übergang + Zuweisung an den Tester), in der Reihenfolge, in der sie laufen.

Regeln:
- Alles fertig formuliert, kurz, freundlich, mit Ticket-Key — auf Deutsch (oder in der Sprache der Person), sofern die allgemeinen Anweisungen des Nutzers nichts anderes sagen — kein Platzhalter, nichts „[…]“.
- Nur Aktionen aus dem Wörterbuch, genau in seiner Form. Nur Personen, Adressen, Benutzernamen und Kennungen, die unten stehen — nichts erfinden.
- Keine Nachricht an mich selbst. Nichts, was schon erledigt ist oder eine frühere Notiz als bereits getan nennt.
- Fast jedes Todo bekommt mindestens eine Aktion. Nur wenn wirklich keine passt (z. B. ein Termin dafür steht schon) → ops leer, und why sagt kurz, warum.
- why: ein Satz, warum genau diese Aktionen.`;

/** The people whose mail addresses are known (from the mails read): "Name <address>", for those the todos name. */
function addressBook(text: string): string[] {
  const rows = getDb()
    .select({ name: emails.fromName, email: emails.fromEmail })
    .from(emails)
    .where(and(isNotNull(emails.fromName), isNotNull(emails.fromEmail)))
    .orderBy(desc(emails.receivedAt))
    .limit(2000)
    .all();
  const seen = new Map<string, string>();
  const namesOf = new Map<string, Set<string>>();
  for (const r of rows) {
    const name = (r.name ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
    const email = (r.email ?? "").trim().toLowerCase();
    if (!name.includes(" ") || !/@/.test(email) || /^(git|gitlab|jira|no-?reply|notifications?|mailer|postmaster|support|info|service|system)[@.+-]/i.test(email)) continue;
    namesOf.set(email, (namesOf.get(email) ?? new Set()).add(name));
    if (!seen.has(name)) seen.set(name, email);
  }
  // One address under several names (GitLab writing "for" everyone): a system's, not a person's.
  for (const [name, email] of [...seen]) if ((namesOf.get(email)?.size ?? 0) > 1) seen.delete(name);
  // Only those the todos are about (their name — or their last name — appears).
  const t = text.toLowerCase();
  return [...seen].filter(([name]) => name.split(/\s+/).some((part) => part.length > 3 && t.includes(part.toLowerCase()))).map(([n, e]) => `${n} <${e}>`).slice(0, 40);
}

/** My appointments of the next days (Outlook, as Zeff read them): busy times. */
function busyTimes(days = 7): { start: Date; end: Date; subject: string }[] {
  const from = Date.now();
  const to = from + days * 864e5;
  return readInbox()
    .filter((e) => !e.isCancelled && !e.isAllDay && (e.showAs ?? "busy") !== "free")
    .map((e) => ({ start: parseLocalDateTime(e.start.dateTime), end: parseLocalDateTime(e.end.dateTime), subject: e.subject ?? "" }))
    .filter((b) => b.end.getTime() > from && b.start.getTime() < to)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

const two = (n: number) => String(n).padStart(2, "0");
const localStamp = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;

/**
 * An appointment's start, moved to the first free time from the one asked for: a workday, 9–17
 * o'clock, not before now, clear of my appointments and of those already placed (`taken`).
 */
function placeAppointment(start: string, minutes: number, busy: { start: Date; end: Date }[], taken: { start: Date; end: Date }[]): string {
  const wanted = parseLocalDateTime(start.length === 16 ? `${start}:00` : start);
  const now = new Date();
  now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  let t = new Date(Math.max(wanted.getTime(), now.getTime()));
  for (let i = 0; i < 4 * 24 * 21; i++) {
    const end = new Date(t.getTime() + minutes * 60000);
    const day = t.getDay();
    const inHours = t.getHours() >= 9 && (end.getHours() < 17 || (end.getHours() === 17 && end.getMinutes() === 0)) && end.getDate() === t.getDate();
    const clash = [...busy, ...taken].some((b) => t < b.end && end > b.start);
    if (day >= 1 && day <= 5 && inHours && !clash) {
      taken.push({ start: t, end });
      return localStamp(t);
    }
    t = new Date(t.getTime() + 15 * 60000);
  }
  return start;
}

/** One todo for the prompt: the todo, its ticket, where it comes from, the notes on it. */
function todoBlock(t: TodoView, sources: ReturnType<typeof todoSources>, run: ReturnType<typeof lastGoodRun>): string {
  const tk = run?.tickets.find((x) => x.key === t.ticket);
  const jira = t.ticket ? getJiraTicket(t.ticket) : undefined;
  const from = sourcesOf(t.refs, sources)
    .map((s) => ({ s, at: entityWhoWhen(s).at ?? "" }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
  const lines = [
    `## Todo [${t.id}] ${t.ticket || "(kein Ticket)"} — ${TODO_KIND_LABELS[t.kind]}${t.owner === "other" ? ", wartet auf andere" : ""}: ${plain(t.text, 400)}`,
    ...(t.ticket
      ? [`Ticket ${t.ticket}: ${plain(tk?.summary ?? jira?.summary ?? "", 160)} — Status ${tk?.status ?? jira?.status ?? "?"}, zugewiesen ${tk?.assignee ?? jira?.assignee ?? "niemand"}`]
      : []),
    ...(tk?.people?.length ? [`Beteiligte: ${tk.people.join(", ")}`] : []),
    ...(tk?.transitions?.length ? [`Mögliche Übergänge: ${tk.transitions.join(", ")}`] : []),
    ...(t.source ? [`Quelle laut Lage: ${plain(t.source, 160)}`] : []),
    ...(t.planned.length ? [`Danach geplant: ${t.planned[0].steps.map((s) => s.text).join(" → ")}`] : []),
    ...t.userNotes.slice(-3).map((n) => `${n.by ? `Bericht ${n.by}` : n.kind === "instruction" ? "Meine Anweisung" : "Meine Notiz"} (${n.at.slice(0, 10)}): ${plain(n.text, 400)}`),
    ...(t.note ? [`Notiz: ${plain(t.note, 200)}`] : []),
    ...from.map(({ s, at }) => {
      const { author } = entityWhoWhen(s);
      return `- [${sourceRef(s)}] ${entitySourceLabel(s)} ${at.slice(0, 16).replace("T", " ")} ${author ?? ""}: ${plain(entityHeadline(s), 120)} — ${plain(entityText(s), 450)}`;
    }),
  ];
  return lines.join("\n");
}

/** A source's ref, as the todo's refs name it. */
const sourceRef = (s: Parameters<typeof entityText>[0]) =>
  s.source === "teams" ? `teams:${s.teams.key}` : s.source === "mail" ? `mail:${s.mail.key}` : s.source === "jira-comment" ? `jira-comment:${s.comment.id}` : s.source === "gitlab" ? `gitlab:${s.gitlab.key}` : s.source;

const state = globalThis as unknown as { __zeffAutoActions?: Promise<AutoActionsResult> | null };
export type AutoActionsResult = { ok: boolean; reviewed: number; withActions: number; batches: number; error?: string };

/**
 * The review: the open todos without operations — new ones, or changed since they were last gone
 * through — in batches (each its own prompt); what the AI proposes, held to the actions' own
 * rules and the installed plugins, goes on the todo (marked as proposed, with why). One at a time.
 */
export function reviewTodosForActions(opts: { all?: boolean; ids?: number[] } = {}): Promise<AutoActionsResult> {
  if (state.__zeffAutoActions && !opts.ids) return state.__zeffAutoActions;
  const run = (async (): Promise<AutoActionsResult> => {
    if (opts.ids && state.__zeffAutoActions) await state.__zeffAutoActions;
    // What can be done changed (a plugin or an extension came — WhatsApp, Gmail, Keep): every open
    // todo without actions is looked at again, once.
    const { TODO_OP_TYPES } = await import("@/lib/boards/shared");
    const { getPref, setPref } = await import("@/lib/prefs");
    const offered = TODO_OP_TYPES.filter((t) => opAvailable(t)).sort().join(",");
    const all = opts.all || getPref("autoactions:offered", "") !== offered;
    // Not looked at yet, or changed since (a new note, a new source).
    const due = new Set(
      getDb()
        .select({ id: todos.id })
        .from(todos)
        .where(and(eq(todos.status, "open"), all ? sql`1` : or(isNull(todos.actionsReviewedAt), sql`${todos.updatedAt} > ${todos.actionsReviewedAt}`)))
        .all()
        .map((r) => r.id),
    );
    // Asked for on given todos: those (unless they have actions not proposed here — the Lage's, a delivery's).
    const list = opts.ids
      ? listTodos({ status: "open" }).filter((t) => opts.ids!.includes(t.id) && (!t.ops.length || !!t.autoOpsWhy))
      : listTodos({ status: "open" }).filter((t) => due.has(t.id) && !t.ops.length);
    if (!opts.ids) setPref("autoactions:offered", offered);
    if (!list.length) return { ok: true, reviewed: 0, withActions: 0, batches: 0 };
    const board = lastGoodRun();
    const sources = todoSources(list, board?.tickets ?? []);
    const blocks = list.map((t) => ({ t, text: todoBlock(t, sources, board) }));
    const me = myJiraName() ?? "";
    const today = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const dictionary = opsDictionary(opAvailable);
    const busy = busyTimes();
    const busyLines = busy.slice(0, 40).map((b) => `- ${b.start.toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}–${b.end.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`);
    // The appointments placed so far in this review (and those already on todos): not on top of each other.
    const taken: { start: Date; end: Date }[] = [];
    const limit = aiChoice().provider === "copilot" ? BATCH_CHARS : 3 * BATCH_CHARS;
    const batches: (typeof blocks)[] = [];
    let size = 0;
    for (const b of blocks) {
      const n = b.text.length + 2;
      if (!batches.length || size + n > limit - dictionary.length || batches[batches.length - 1].length >= BATCH_TODOS) {
        batches.push([]);
        size = 0;
      }
      batches[batches.length - 1].push(b);
      size += n;
    }
    let withActions = 0;
    let failed = 0;
    const now = new Date().toISOString();
    const ask = async (batch: typeof blocks): Promise<{ batch: typeof blocks; answer: Answer }[]> => {
      throwIfAborted();
      const text = batch.map((b) => b.text).join("\n\n");
      const book = addressBook(text);
      const prompt = [
        INSTRUCTIONS(me, today) + extraBlock("autoactions"),
        "",
        dictionary,
        "",
        "# Adressbuch (Mail-Adressen aus meinen Mails)",
        ...(book.length ? book : ["(keine passenden)"]),
        "",
        "# Meine belegten Zeiten (nächste Tage)",
        ...(busyLines.length ? busyLines : ["(keine bekannt)"]),
        "",
        "# Todos",
        text,
      ].join("\n");
      try {
        return [{ batch, answer: (await runAi<Answer>(prompt, SCHEMA, { task: "auto-actions", timeoutMs: 10 * 60000, maxBudgetUsd: 1 })).output }];
      } catch (e) {
        console.error("[auto-actions]", errorMessage(e).slice(0, 300));
        if (batch.length === 1) {
          failed++;
          return [];
        }
        // Halved and asked again — a broken answer costs only its half.
        const half = Math.ceil(batch.length / 2);
        return [...(await ask(batch.slice(0, half))), ...(await ask(batch.slice(half)))];
      }
    };
    for (const { batch, answer } of (await Promise.all(batches.map(ask))).flat()) {
      const said = new Map((answer?.todos ?? []).filter((x) => Number.isInteger(x?.id)).map((x) => [x.id!, x]));
      for (const { t } of batch) {
        const a = said.get(t.id);
        // Its actions, by their own rules, of installed plugins — none to myself.
        const ops: TodoOp[] = cleanOps(a?.ops ?? [], t.ticket || "")
          .filter((o) => opAvailable(o.type) && !(o.type === "teams-message" && me && o.to.toLowerCase() === me.toLowerCase()))
          // An appointment into a free time (mine, and the ones placed before it).
          .map((o) => (o.type === "calendar-event" ? { ...o, start: placeAppointment(o.start, o.minutes, busy, taken) } : o));
        const set: Partial<typeof todos.$inferInsert> = { actionsReviewedAt: now };
        // Only onto a todo that still has none (the Lage or you may have given it some meanwhile).
        const still = getDb().select({ ops: todos.ops }).from(todos).where(eq(todos.id, t.id)).get();
        if (ops.length && still && ((JSON.parse(still.ops) as unknown[]).length === 0 || (opts.ids && t.autoOpsWhy))) {
          set.ops = JSON.stringify(ops);
          set.autoOpsWhy = (a?.why ?? "").trim().slice(0, 500) || "Vorgeschlagen aus dem Kontext.";
          withActions++;
        }
        getDb().update(todos).set(set).where(eq(todos.id, t.id)).run();
      }
    }
    if (withActions) emitChange("todos");
    return {
      ok: failed < list.length,
      reviewed: list.length,
      withActions,
      batches: batches.length,
      ...(failed ? { error: `${failed} Todo${failed === 1 ? "" : "s"} ohne gültige Antwort` } : {}),
    };
  })()
    .catch((e): AutoActionsResult => {
      console.error("[auto-actions]", errorMessage(e));
      return { ok: false, reviewed: 0, withActions: 0, batches: 0, error: errorMessage(e) };
    })
    .finally(() => {
      if (!opts.ids) state.__zeffAutoActions = null;
    });
  if (!opts.ids) state.__zeffAutoActions = run;
  return run;
}
