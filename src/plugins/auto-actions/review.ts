/**
 * The auto-actions review (a step of its own after the Ticket-Lage): the AI goes through the open
 * todos that have no button yet — each with all it has (the ticket, its people and transitions,
 * where the todo comes from, the notes) — and proposes the actions that do it or move it on, from
 * what the installed plugins offer (a comment, a message, a mail draft, an appointment, a hand-over
 * to a worker …). Complete and ready: one click runs them. Server only.
 */
// "Do in Zeff" (what plugins offer to the AI) is registered by this: the dictionary and the checks need it.
import "@/plugins/actions/server";
import { fillPrompt, promptText } from "@/lib/prompts";
import { createHash } from "node:crypto";
import { pad2 as two } from "@/lib/text";
import { throwIfAborted } from "@/lib/abort";
import { extraBlock } from "@/lib/boards/context-prefs";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { aiChoice, runAi } from "@/lib/ai";
import { emitChange } from "@/lib/events";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { withoutAppointments } from "@/lib/boards/recurring";
import { cleanOps, opsDictionary, sourcesOf, TODO_KIND_LABELS, type TodoOp, type TodoView } from "@/lib/boards/shared";
import { plain } from "@/lib/boards/collect";
import { commentTodos, dropObsoleteInstructs, withCommentOps } from "@/lib/boards/comment-ops";
import { todoSources } from "@/lib/boards/sources";
import { lastGoodRun, listTodos } from "@/lib/boards/store";
import { entityHeadline, entitySourceLabel, entityText, entityWhoWhen } from "@/lib/entities-shared";
import { myJiraName, getJiraTicket } from "@/lib/jira/store";
import { busyBetween } from "@/lib/calendar/ir";
import { listFacts } from "@/lib/facts";
import { conversationOf } from "@/lib/mail/store";
import { isChatFolder } from "@/lib/mail/shared";
import { parseLocalDateTime } from "@/lib/calendar/meetings";
import { COPILOT_MAX_PROMPT } from "@/plugins/copilot-cli/cli";
import { opAvailable } from "@/plugins/ops";
import { OFFERED_ACTIONS } from "@/plugins/actions/catalog";

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

/** The auto-actions' instructions ({{me}}: your name; {{today}}: the day) — a page of System → Prompts. */
export const INSTRUCTIONS = `Du machst aus Todos Aktionen, die ich ({{me}}) mit EINEM Klick ausführe. Heute ist {{today}}.

Unten stehen offene Todos — jedes mit seinem Ticket (Status, Beteiligte mit Benutzernamen, mögliche Übergänge), woher es kommt (Kommentare, Teams-Nachrichten, Mails mit Kennung), meinen Notizen und Berichten. Und das Wörterbuch der Aktionen, die ich habe.

Tickets mit KB-… sind meine eigenen Kanban-Karten in Zeff, keine Jira-Tickets: für sie keine Jira-Aktionen (kein Kommentar, Übergang, Zuweisung in Jira) — Mails, Teams, Termine und Work gehen.

Für JEDES Todo: welche Aktionen erledigen es oder bringen es den nächsten echten Schritt weiter? Denk wie ein Assistent, der mir die Arbeit abnimmt:
- Eine Frage, Bitte oder Absprache mit jemandem → die fertige Nachricht an die Person (teams-message für Kollegen; mail-compose für Leute, die per Mail schreiben, mit ihrer Adresse aus dem Adressbuch unten), oder ein jira-comment, wenn es ins Ticket gehört.
- Etwas gemeinsam prüfen / abstimmen / vorführen → calendar-event mit der Person (Adresse aus dem Adressbuch), dazu ggf. eine kurze teams-message.
- Warten auf jemanden (wartet auf andere: ein Approval, eine Antwort, ein Test) → ein freundliches Nachhaken (teams-message) an genau die Person, auf die gewartet wird — mit dem, was du brauchst.
- Steht im Todo ein späterer Zeitpunkt („ab 12.10.“, „nach dem Deployment am 13.10.“) → ein calendar-event an diesem Tag als Erinnerung (ohne Teilnehmer), mit dem, was dann zu tun ist.
- Etwas, das nur ich selbst tun kann (selbst testen, ein Formular, eine Schulung, etwas vor Ort) → ein calendar-event als Zeitblock für mich (ohne Teilnehmer, realistische Dauer, nächster sinnvoller Werktag).
- Termine: in eine freie Zeit (meine belegten Zeiten stehen unten); Arbeitstermine (calendar-event) Werktag 9–17 Uhr; Teilnehmer nur mit Adresse aus dem Adressbuch — ohne Adresse lädst du die Person per teams-message ein.
- Etwas Privates mit einem Zeitpunkt oder das Zeit braucht (etwas besorgen, erledigen, vorbereiten; ein Geburtstag, eine Verabredung, eine Frist) → calendar-entry (mein Zeff-Kalender) oder gcal-event (Google Calendar) — was das Wörterbuch hat, nicht beide; abends oder am Wochenende, außer es braucht Öffnungszeiten (Arzt, Amt, Geschäft); vor dem Datum, um das es geht (ein Geschenk vor dem Geburtstag).
- Nach einer Übergabe an einen Worker (work-instruct) legt Zeff selbst ein Todo zum Testen an — dafür keinen eigenen Termin.
- Ticket-Pflege (Status, Zuweisung, Kommentar, neues Ticket) → jira-transition / jira-assign / jira-comment / jira-create — Übergänge nur aus den möglichen, Zuweisungen mit dem Benutzernamen.
- Ein neues Ticket / eine Story / ein Task soll angelegt werden („… anlegen“, „… Story erstellen“, „auslagern“) → IMMER eine jira-create, nie nur ein Kommentar: summary = ein präziser Titel (was geliefert wird, nicht „Ticket zu …“); body = vollständige Beschreibung in Markdown NUR aus dem Context unten (Beschreibung und Kommentare des Quell-Tickets, Quellen, Berichte, Notizen): Hintergrund mit Verweis auf das Quell-Ticket, was genau gebraucht wird (konkrete Seiten, Komponenten, Verhalten, Vorgaben aus dem Ticket), offene Fragen, Akzeptanzkriterien als prüfbare Liste. Nichts erfinden — was der Context nicht hergibt, steht unter „Offene Fragen“. issueType Story, wenn das Todo Story sagt, sonst Task. ticket = das Quell-Ticket. Wer es bearbeiten soll, schreibst du in die Beschreibung, nicht als jira-assign (das neue Ticket hat noch keinen Schlüssel).
- Ein GitLab-Kommentar / Thread (gitlab:note:<id>): zeigt der Kontext schon, dass es erledigt ist (ein Commit auf dem Branch, der Bericht eines Workers, eine Notiz), dann die fertige Antwort als gitlab-reply (note:<id>, Markdown, kurz, sachlich, mit dem, was geändert wurde) — kein work-instruct dafür; Zeff hängt das Resolve selbst an. Ist noch etwas zu tun, schlägst du keine Antwort vor, sondern das work-instruct.
- Etwas umsetzen, fixen, im Code nachsehen, ausarbeiten → work-instruct mit einer konkreten, vollständigen Anweisung — nie für etwas, das laut Kontext schon umgesetzt ist.
- Sagt jemand, wie in Zeff selbst etwas gehandhabt werden soll (eine Regel, eine Absprache: wie Branches heißen, wie Antworten klingen, worauf ein KI-Schritt achten soll) → zeff-do mit einer Methode aus dem Wörterbuch; die neuen Anweisungen schreibst du als Anpassung dessen, was unter „Bestehendes in Zeff“ steht.
- Mehrere Aktionen, wenn sie zusammengehören (z. B. Kommentar + Übergang + Zuweisung an den Tester), in der Reihenfolge, in der sie laufen.

Regeln:
- Alles fertig formuliert, kurz, freundlich, mit Ticket-Key — kein Platzhalter, nichts „[…]“.
- Eine Nachricht an eine Person in der Sprache, in der wir miteinander schreiben: der Verlauf ihres Chats / ihrer Mails und die Fakten zeigen es (z. B. „Sprache: Vinka — Spanisch“); sonst Deutsch — sofern die allgemeinen Anweisungen des Nutzers nichts anderes sagen.
- Nur Aktionen aus dem Wörterbuch, genau in seiner Form. Nur Personen, Adressen, Benutzernamen und Kennungen, die unten stehen — nichts erfinden.
- Keine Nachricht an mich selbst. Nichts, was schon erledigt ist oder eine frühere Notiz als bereits getan nennt.
- Fast jedes Todo bekommt mindestens eine Aktion. Nur wenn wirklich keine passt (z. B. ein Termin dafür steht schon) → ops leer, und why sagt kurz, warum.
- why: ein Satz, warum genau diese Aktionen.`;

/** The people whose mail addresses are known (from the mails read): "Name <address>", for those the todos name. */
/** The bank accounts of the people the todos name (the People plugin's details): "Name: IBAN (BIC …)". */
async function accountsOf(text: string): Promise<string[]> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("people")) return [];
  const { detailsOf } = await import("@/plugins/people/details");
  const { listPeople, namesThem } = await import("@/plugins/people/store");
  return listPeople()
    .filter((p) => namesThem(p, text))
    .map((p) => ({ name: p.name, details: detailsOf(p.id) }))
    .flatMap((p) => {
      const iban = p.details.find((d) => d.key === "iban")?.value;
      const bic = p.details.find((d) => d.key === "bic")?.value;
      const revtag = p.details.find((d) => d.key === "revtag")?.value;
      const parts = [iban ? `IBAN ${iban}${bic ? ` (BIC ${bic})` : ""}` : "", revtag ? `RevTag ${revtag}` : ""].filter(Boolean);
      return parts.length ? [`- ${p.name}: ${parts.join(" · ")}`] : [];
    });
}

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

/** My appointments of the next days — every calendar that blocks time (Zeff's calendar model: Outlook, Google, Zeff's own). */
function busyTimes(days = 14): { start: Date; end: Date; subject: string }[] {
  const from = new Date();
  return busyBetween(from, new Date(from.getTime() + days * 864e5)).map((b) => ({ start: b.start, end: b.end, subject: b.title }));
}

/** When an appointment may go: work ones on workdays 9–17, private ones (Zeff's calendar, Google) any day 8–21. */
type Window = { workdays: boolean; from: number; to: number };
const WORK: Window = { workdays: true, from: 9, to: 17 };
const PRIVATE: Window = { workdays: false, from: 8, to: 21 };

const localStamp = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;

/**
 * An appointment's start, moved to the first free time from the one asked for: a workday, 9–17
 * o'clock, not before now, clear of my appointments and of those already placed (`taken`).
 */
function placeAppointment(start: string, minutes: number, busy: { start: Date; end: Date }[], taken: { start: Date; end: Date }[], window: Window = WORK): string {
  const wanted = parseLocalDateTime(start.length === 16 ? `${start}:00` : start);
  const now = new Date();
  now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  let t = new Date(Math.max(wanted.getTime(), now.getTime()));
  for (let i = 0; i < 4 * 24 * 21; i++) {
    const end = new Date(t.getTime() + minutes * 60000);
    const day = t.getDay();
    const inHours = t.getHours() >= window.from && (end.getHours() < window.to || (end.getHours() === window.to && end.getMinutes() === 0)) && end.getDate() === t.getDate();
    const clash = [...busy, ...taken].some((b) => t < b.end && end > b.start);
    if ((!window.workdays || (day >= 1 && day <= 5)) && inHours && !clash) {
      taken.push({ start: t, end });
      return localStamp(t);
    }
    t = new Date(t.getTime() + 15 * 60000);
  }
  return start;
}

/** The addresses of the systems the todo is about (Test, Prod …), as the Wissens-Zuordnung found them in the knowledge: for comments and messages that point to the right one. */
function systemsOf(t: TodoView): string[] {
  const repo = t.knowledge?.repo;
  return repo ? [`Projekt ${repo.name} (aus dem Wissen — nenne in Nachrichten und Kommentaren die passende Adresse):
${repo.summary}`] : [];
}

/** What the actions say they need for a todo with this text (their offer's `needs`). */
function contextNeeded(text: string): Set<string> {
  const out = new Set<string>();
  for (const a of OFFERED_ACTIONS) {
    const n = a.offer?.needs;
    if (n && opAvailable(a.type) && new RegExp(n.match, "i").test(text)) n.context.forEach((c) => out.add(c));
  }
  return out;
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
    // A todo that makes a new ticket needs what the source ticket says to write it from.
    ...(t.ticket && jira?.description && contextNeeded(t.text).has("ticket.description") ? [`Beschreibung von ${t.ticket}:
${plain(jira.description, 3500)}`] : []),
    ...(tk?.people?.length ? [`Beteiligte: ${tk.people.join(", ")}`] : []),
    ...(tk?.transitions?.length ? [`Mögliche Übergänge: ${tk.transitions.join(", ")}`] : []),
    ...(t.source ? [`Quelle laut Lage: ${plain(t.source, 160)}`] : []),
    ...(t.planned.length ? [`Danach geplant: ${t.planned[0].steps.map((s) => s.text).join(" → ")}`] : []),
    ...t.userNotes.slice(-3).map((n) => `${n.by ? `Bericht ${n.by}` : n.kind === "instruction" ? "Meine Anweisung" : "Meine Notiz"} (${n.at.slice(0, 10)}): ${plain(n.text, 400)}`),
    ...(t.note ? [`Notiz: ${plain(t.note, 200)}`] : []),
    ...systemsOf(t),
    ...from.map(({ s, at }) => {
      const { author } = entityWhoWhen(s);
      return `- [${sourceRef(s)}] ${entitySourceLabel(s)} ${at.slice(0, 16).replace("T", " ")} ${author ?? ""}: ${plain(entityHeadline(s), 120)} — ${plain(entityText(s), 450)}`;
    }),
    ...historyOf(from.map((f) => f.s)),
    ...factsFor(t, from.map((f) => f.s)),
  ];
  return lines.join("\n");
}

/**
 * The conversations a todo's messages are from (a WhatsApp chat, a mail thread): their last messages,
 * both sides — what was said before, and in which language (a voice message says nothing of it).
 */
function historyOf(from: Parameters<typeof entityText>[0][]): string[] {
  const convs = [...new Set(from.flatMap((s) => (s.source === "mail" ? [s.mail.convId] : [])))].slice(0, 2);
  return convs.flatMap((c) => {
    const msgs = conversationOf(c, 8);
    if (msgs.length < 2) return [];
    return [
      `Verlauf ${isChatFolder(msgs[0].folder) ? "des Chats" : "der Unterhaltung"} „${plain(msgs[msgs.length - 1].subject, 60)}“ (älteste zuerst):`,
      ...msgs.map((m) => `  ${m.receivedAt.slice(0, 10)} ${m.fromName ?? m.fromEmail ?? "?"}: ${plain(m.preview, 220)}`),
    ];
  });
}

/** What Zeff knows about a todo's people and things (facts — a birthday, the language someone writes in): those whose subject names them. */
function factsFor(t: TodoView, from: Parameters<typeof entityText>[0][]): string[] {
  const about = [t.text, ...from.map((s) => entityWhoWhen(s).author ?? ""), ...from.map((s) => (s.source === "mail" ? s.mail.subject : ""))].join(" ").toLowerCase();
  return listFacts()
    .filter((f) => f.subject.split(/[\s:,–-]+/).some((w) => w.length > 3 && about.includes(w.toLowerCase())))
    .slice(0, 6)
    .map((f) => `Bekannt: ${plain(f.subject, 80)} — ${plain(f.text, 200)}`);
}

/** A source's ref, as the todo's refs name it. */
const sourceRef = (s: Parameters<typeof entityText>[0]) =>
  s.source === "teams" ? `teams:${s.teams.key}` : s.source === "mail" ? `mail:${s.mail.key}` : s.source === "jira-comment" ? `jira-comment:${s.comment.id}` : s.source === "gitlab" ? `gitlab:${s.gitlab.key}` : s.source === "fact" ? s.fact.ref : s.source === "document" ? s.doc.ref : s.source === "calendar" ? s.event.ref : s.source;

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
    // What can be done changed (a plugin or an extension came — WhatsApp, Gmail, Keep, a calendar):
    // every open todo without actions is looked at again, once — and those whose actions this review
    // proposed itself (not run yet: what ran is gone from a todo), so they can get the new kind.
    const { TODO_OP_TYPES } = await import("@/lib/boards/shared");
    const { getPref, setPref } = await import("@/lib/prefs");
    // (The prompt's own text counts too: a better prompt looks at every todo without actions again, once.)
    const promptHash = createHash("sha1").update(promptText("auto-actions", INSTRUCTIONS)).digest("hex").slice(0, 8);
    const offered = TODO_OP_TYPES.filter((t) => opAvailable(t)).sort().join(",") + `|${promptHash}`;
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
    const board = lastGoodRun();
    const open = listTodos({ status: "open" });
    // What a todo learned since its actions were proposed here (and not run or edited — those aren't
    // ours any more): a note of yours or a review's, a newer message — then they're proposed again.
    const reviewedAt = new Map(getDb().select({ id: todos.id, at: todos.actionsReviewedAt }).from(todos).where(eq(todos.status, "open")).all().map((r) => [r.id, r.at ?? ""]));
    const ours = open.filter((t) => t.ops.length && !!t.autoOpsWhy && due.has(t.id));
    const oursSources = todoSources(ours, board?.tickets ?? []);
    const learned = new Set(
      ours
        .filter((t) => {
          const at = reviewedAt.get(t.id) ?? "";
          return t.userNotes.some((n) => n.at > at) || sourcesOf(t.refs, oursSources).some((x) => (entityWhoWhen(x).at ?? "") > at);
        })
        .map((t) => t.id),
    );
    // A todo that stands for review comments, with actions of someone else's (a delivery, a hand-over): only the replies it still lacks are
    // asked for — they are added to its actions, before their thread's Resolve; nothing else of what is proposed is used.
    const gaps = new Map(commentTodos().filter((c) => c.open.some((n) => !c.ops.some((o) => o.type === "gitlab-reply" && o.note === n))).map((c) => [c.id, c]));
    // Asked for on given todos: those (unless they have actions not proposed here — the Lage's, a delivery's).
    const list = opts.ids
      ? open.filter((t) => opts.ids!.includes(t.id) && (!t.ops.length || !!t.autoOpsWhy || gaps.has(t.id)))
      : open.filter((t) => due.has(t.id) && (!t.ops.length || (!!t.autoOpsWhy && (all || learned.has(t.id))) || (!t.autoOpsWhy && gaps.has(t.id))));
    if (!opts.ids) setPref("autoactions:offered", offered);
    if (!list.length) return { ok: true, reviewed: 0, withActions: 0, batches: 0 };
    const sources = todoSources(list, board?.tickets ?? []);
    // What exists now that an action may adjust (the current instructions of an AI step, the boards, what the knowledge base says): retrieved per todo.
    const { offerContext } = await import("@/plugins/actions/server");
    const blocks = await Promise.all(
      list.map(async (t) => {
        const known = await offerContext({ ticket: t.ticket, text: plain(t.text, 400) });
        return { t, text: todoBlock(t, sources, board) + (known.length ? ["", "Bestehendes in Zeff (für Aktionen, die etwas anpassen):", ...known].join("\n") : "") };
      }),
    );
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
      const accounts = await accountsOf(text);
      const prompt = [
        fillPrompt("auto-actions", INSTRUCTIONS, { me: me || "der Nutzer", today }) + extraBlock("autoactions"),
        "",
        dictionary,
        "",
        "# Adressbuch (Mail-Adressen aus meinen Mails)",
        ...(book.length ? book : ["(keine passenden)"]),
        "",
        "# Konten meiner Kontakte (für bank-transfer / revolut-pay)",
        ...(accounts.length ? accounts : ["(keins bekannt — bei einer Rückzahlung an eine Person die IBAN leer lassen)"]),
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
        // (A todo that comes back has its series in the calendar: no appointment for it.)
        const ops: TodoOp[] = withoutAppointments(cleanOps(a?.ops ?? [], t.ticket || ""), !!t.recurrence)
          .filter((o) => opAvailable(o.type) && !(o.type === "teams-message" && me && o.to.toLowerCase() === me.toLowerCase()))
          // An appointment into a free time (mine, and the ones placed before it).
          .map((o) =>
            o.type === "calendar-event"
              ? { ...o, start: placeAppointment(o.start, o.minutes, busy, taken) }
              : o.type === "calendar-entry" || o.type === "gcal-event"
                ? { ...o, start: placeAppointment(o.start, o.minutes, busy, taken, PRIVATE) }
                : o,
          );
        const set: Partial<typeof todos.$inferInsert> = { actionsReviewedAt: now };
        const gap = gaps.get(t.id);
        // Only onto a todo that still has none (the Lage or you may have given it some meanwhile) — or
        // whose actions this review proposed itself, looked at again (on request, or new kinds came).
        const still = getDb().select({ ops: todos.ops }).from(todos).where(eq(todos.id, t.id)).get();
        if (gap && t.ops.length && !t.autoOpsWhy && still) {
          // (Someone else's actions stay: only the drafted replies are added.)
          const replies = ops.filter((o) => o.type === "gitlab-reply");
          if (replies.length) {
            // (Replies for every open thread: the hand-over to a worker is obsolete — the replies answer from what is known.)
            const next = dropObsoleteInstructs(withCommentOps(JSON.parse(still.ops) as TodoOp[], gap.open, replies), gap.open);
            set.ops = JSON.stringify(next);
            withActions++;
          }
        } else if (ops.length && still && ((JSON.parse(still.ops) as unknown[]).length === 0 || ((opts.ids || all || learned.has(t.id)) && t.autoOpsWhy))) {
          set.ops = JSON.stringify(ops);
          set.autoOpsWhy = (a?.why ?? "").trim().slice(0, 500) || "Vorgeschlagen aus dem Kontext.";
          withActions++;
        }
        getDb().update(todos).set(set).where(eq(todos.id, t.id)).run();
      }
    }
    if (withActions || opts.ids) emitChange("todos"); // (a review of chosen todos — after a note — says it is through even with nothing new)
    return {
      ok: failed < list.length,
      reviewed: list.length,
      withActions,
      batches: batches.length,
      ...(failed ? { error: failed === 1 ? t("1 todo without a valid answer") : t("{n} todos without a valid answer", { n: failed }) } : {}),
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
