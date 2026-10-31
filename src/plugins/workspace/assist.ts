import { createHash } from "node:crypto";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { docRefs, docText, docToMarkdown, markdownToDoc, sanitizeDoc, type DocNode } from "./doc";
import { ASSIST_ACTION_KINDS, MAX_ASSIST_ACTIONS, MAX_ASSIST_QUESTIONS, MAX_ASSIST_ROUNDS, type AssistAction, type AssistActionBody, type AssistActionKind, type AssistCreated, type AssistEvent, type AssistQuestion, type AssistQuestionKind, type AssistState } from "./assist-shared";
import { newId } from "./model";
import * as store from "./store";
import { localDay } from "@/lib/dates";

/**
 * "✨ Think along" (Mitdenken) on a page — only when the user presses its button. One AI call per step: it understands
 * the block (or the page), asks what changes the plan (at most two rounds of chips), then proposes a few actions from a
 * closed set; "Apply" runs the chosen ones here and hands the editor the blocks to insert after the card. Server only.
 */

type Busy = { start: Date; end: Date; title: string };

/** What the AI's answer is held to: the people that exist, the widgets there are (their settings), your busy times, what is installed. */
export type AssistCheck = {
  person: (id: number) => string | null;
  widgets: Map<string, { label: string; settings: string[] }>;
  busy: Busy[];
  can: { calendar: boolean; todos: boolean };
  /** The calendars proposals may go in: id → name. */
  calendars?: Map<number, string>;
  /** The widgets on the page already, "widget:personId" — not added twice. */
  onPage?: Set<string>;
  /** The person the text is about (the first it names): a person widget without one takes them. */
  defaultPerson?: { id: number; name: string };
};

const two = (n: number) => String(n).padStart(2, "0");
const stampOf = (d: Date) => `${localDay(d)} ${two(d.getHours())}:${two(d.getMinutes())}`;
const str = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim().slice(0, max) : "");

// ---------------------------------------------------------------------------
// The period a text is about (for your busy times in the prompt)
// ---------------------------------------------------------------------------

const MONTHS: [RegExp, number][] = [
  [/^(januar|jänner|january)$/, 0], [/^(februar|february)$/, 1], [/^(märz|maerz|march)$/, 2], [/^(april)$/, 3], [/^(mai|may)$/, 4], [/^(juni|june)$/, 5],
  [/^(juli|july)$/, 6], [/^(august)$/, 7], [/^(september)$/, 8], [/^(oktober|october)$/, 9], [/^(november)$/, 10], [/^(dezember|december)$/, 11],
];

/** The months a text names ("Januar 2027", "im Dezember" — the next one, "15.01.2027", "2027-01-15"), first to last (at most half a year); none: the next eight weeks. */
export function periodOf(text: string, today = new Date()): { from: Date; to: Date } {
  const found: Date[] = [];
  for (const m of text.toLowerCase().matchAll(/([a-zäöü]+)(?:\s+(\d{4}))?/g)) {
    const month = MONTHS.find(([re]) => re.test(m[1]))?.[1];
    if (month === undefined) continue;
    const year = m[2] ? Number(m[2]) : month >= today.getMonth() ? today.getFullYear() : today.getFullYear() + 1;
    found.push(new Date(year, month, 1));
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-\d{2}\b/g)) found.push(new Date(Number(m[1]), Number(m[2]) - 1, 1));
  for (const m of text.matchAll(/\b\d{1,2}\.(\d{1,2})\.(\d{4})\b/g)) found.push(new Date(Number(m[2]), Number(m[1]) - 1, 1));
  const ok = found.filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
  if (!ok.length) {
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return { from, to: new Date(from.getFullYear(), from.getMonth(), from.getDate() + 56) };
  }
  const from = ok[0];
  const last = ok[ok.length - 1];
  const to = new Date(last.getFullYear(), last.getMonth() + 1, 1);
  const cap = new Date(from.getFullYear(), from.getMonth() + 6, 1);
  return { from, to: to > cap ? cap : to };
}

// ---------------------------------------------------------------------------
// The AI's answer, checked
// ---------------------------------------------------------------------------

const QUESTION_KINDS: readonly AssistQuestionKind[] = ["choice", "multi", "text", "number", "date"];

/** Options that are dates or spans of days ("9.–10.1.", "2027-01-16", "Wochenende im Januar"): several of them can suit. */
const DATEISH = /\d{1,2}\.|\d{4}-\d{2}|\b(jan|feb|mär|mar|apr|mai|may|jun|jul|aug|sep|okt|oct|nov|dez|dec)|wochenende|weekend/i;

/** The questions as they may be shown: each with a text, a known kind, short options (a choice needs two) — at most four. */
export function cleanQuestions(raw: unknown): AssistQuestion[] {
  const out: AssistQuestion[] = [];
  for (const [i, q] of (Array.isArray(raw) ? raw : []).entries()) {
    if (!q || typeof q !== "object" || out.length >= MAX_ASSIST_QUESTIONS) continue;
    const o = q as Record<string, unknown>;
    const text = str(o.text, 200);
    if (!text) continue;
    let id = /^[\w-]{1,24}$/.test(String(o.id ?? "")) ? String(o.id) : `q${i + 1}`;
    if (out.some((x) => x.id === id)) id = `q${i + 1}`;
    let kind: AssistQuestionKind = QUESTION_KINDS.includes(o.kind as AssistQuestionKind) ? (o.kind as AssistQuestionKind) : "text";
    let options = kind === "choice" || kind === "multi" ? [...new Set((Array.isArray(o.options) ? o.options : []).map((x) => str(x, 60)).filter(Boolean))].slice(0, 6) : [];
    if ((kind === "choice" || kind === "multi") && options.length < 2) [kind, options] = ["text", []];
    // Dates to choose from: as many as suit (which weekends would do), never just one.
    if (kind === "choice" && options.filter((x) => DATEISH.test(x)).length >= 2) kind = "multi";
    out.push({ id, text, kind, options });
  }
  return out;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** A day or a time as the calendar takes it, when it is a real one ("2027-01-32" is not). */
function when(v: unknown): Date | null {
  const s = String(v ?? "");
  if (!DAY.test(s) && !TIME.test(s)) return null;
  const d = new Date(DAY.test(s) ? `${s}T00:00` : s);
  return !Number.isNaN(d.getTime()) && (DAY.test(s) ? localDay(d) : `${localDay(d)}T${two(d.getHours())}:${two(d.getMinutes())}`) === s ? d : null;
}

/** A suggested appointment as the calendar takes it (a whole day ends the day after), flagged with what of yours it overlaps. */
function cleanEvent(raw: unknown, busy: Busy[]): AssistEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = str(o.title, 120);
  const start = when(o.start);
  if (!title || !start) return null;
  const allDay = DAY.test(String(o.start)) || o.allDay === true;
  let from = start;
  let end = when(o.end);
  let ev: AssistEvent;
  if (allDay) {
    from = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    // Its end: the day after the last. `lastDay` is that last day itself (what the prompt asks for — unambiguous); an `end`
    // (older answers) is the day after already (a time given on that last day: the day after it).
    const last = DAY.test(String(o.lastDay ?? "")) ? when(o.lastDay) : null;
    if (last) end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    else if (end) end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + (DAY.test(String(o.end)) ? 0 : 1));
    if (!end || end <= from) end = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
    ev = { title, start: localDay(from), end: localDay(end), allDay: true };
  } else {
    if (!end || end <= start) return null;
    ev = { title, start: String(o.start), end: String(o.end) };
  }
  const until = end;
  const conflicts = [...new Set(busy.filter((b) => b.start < until && b.end > from).map((b) => b.title))].slice(0, 3);
  return conflicts.length ? { ...ev, conflicts } : ev;
}

/** One action as Zeff can run it — or null (unknown kind, its plugin not installed, nothing valid in it). */
function cleanAction(raw: unknown, check: AssistCheck): AssistActionBody | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind as AssistActionKind;
  if (!ASSIST_ACTION_KINDS.includes(kind)) return null;
  const label = str(o.label, 120);
  if (kind === "events") {
    if (!check.can.calendar) return null;
    // One appointment per time: one overlapping an earlier one is dropped (the plan's days are moved by drag and drop instead).
    // Options are alternatives (this weekend or that one): they may overlap — only the same one twice goes.
    const span = (e: AssistEvent) => [new Date(e.start.length === 10 ? `${e.start}T00:00` : e.start).getTime(), new Date(e.end.length === 10 ? `${e.end}T00:00` : e.end).getTime()];
    const asOptions = o.options === true;
    const cleaned = (Array.isArray(o.events) ? o.events : [])
      .slice(0, asOptions ? 8 : 31)
      .map((e) => cleanEvent(e, check.busy))
      .filter((e): e is AssistEvent => !!e);
    const events = cleaned.reduce<AssistEvent[]>((kept, e) => {
      const [a, b] = span(e);
      if (asOptions) return kept.some((k) => k.start === e.start && k.end === e.end) ? kept : [...kept, e];
      return kept.some((k) => span(k)[0] < b && span(k)[1] > a) ? kept : [...kept, e];
    }, []);
    const own = Number(o.calendarId);
    const calendar = check.calendars?.get(own);
    // (one option alone is no choice: a plain proposal)
    const options = asOptions && events.length > 1 ? { options: true as const } : {};
    return events.length ? { kind, label: label || str(o.name, 80) || events[0].title, events, ...(calendar ? { calendarId: own, calendar } : {}), ...options } : null;
  }
  if (kind === "todo") {
    if (!check.can.todos) return null;
    // Plain names: a person's todos are found by their name (people/blocks.ts), not by a mention.
    const text = str(String(o.text ?? "").replace(/\[\[[a-z]+:[^\]|]+\|([^\]]*)\]\]/g, "$1"), 300);
    if (!text) return null;
    return { kind, label: label || text, text, ...(when(o.due) && DAY.test(String(o.due)) ? { due: String(o.due) } : {}) };
  }
  if (kind === "widget") {
    const w = check.widgets.get(String(o.widget ?? ""));
    if (!w) return null;
    const given = o.config && typeof o.config === "object" && !Array.isArray(o.config) ? (o.config as Record<string, unknown>) : {};
    const config: Record<string, string | number | boolean> = {};
    for (const k of w.settings) {
      const v = given[k];
      if (k === "person") continue; // only a person that exists, by their id (below)
      if (typeof v === "number" || typeof v === "boolean") config[k] = v;
      else if (typeof v === "string" && v.trim()) config[k] = v.slice(0, 200);
    }
    const name = w.settings.includes("person") && Number.isInteger(o.person) ? check.person(Number(o.person)) : null;
    if (name) Object.assign(config, { person: name, personId: Number(o.person) });
    // No person given: the one the text is about (a person widget without one shows nothing).
    else if (w.settings.includes("person") && check.defaultPerson) Object.assign(config, { person: check.defaultPerson.name, personId: check.defaultPerson.id });
    // On the page already (asked again): not twice.
    if (check.onPage?.has(`${String(o.widget)}:${config.personId ?? ""}`)) return null;
    return { kind, label: label || w.label, widget: String(o.widget), config };
  }
  const markdown = String(o.markdown ?? "").trim().slice(0, 4000);
  return markdown ? { kind: "text", label: label || markdown.split("\n")[0].replace(/^[#\-\s[\]x]+/, "").slice(0, 120), markdown } : null;
}

/** The actions the AI proposed, as Zeff can run them (at most six), numbered a1, a2 … */
export function cleanActions(raw: unknown, check: AssistCheck): AssistAction[] {
  return (Array.isArray(raw) ? raw : [])
    // A text's checklist lines are todos (the page's one checklist that feeds the engine) — not a second list beside it.
    .flatMap((a): unknown[] => {
      const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
      if (o?.kind !== "text" || typeof o.markdown !== "string") return [a];
      const lines = o.markdown.split("\n");
      const todos = lines.map((l) => /^\s*[-*+]\s+\[ \]\s+(.+)$/.exec(l)?.[1]).filter((x): x is string => !!x);
      if (!todos.length) return [a];
      const rest = lines.filter((l) => !/^\s*[-*+]\s+\[[ xX]\]\s+/.test(l)).join("\n").trim();
      return [...(rest ? [{ ...o, markdown: rest }] : []), ...todos.map((text) => ({ kind: "todo", text }))];
    })
    .slice(0, 12)
    .map((a) => cleanAction(a, check))
    .filter((a): a is AssistActionBody => !!a)
    .slice(0, MAX_ASSIST_ACTIONS)
    .map((a, i) => ({ id: `a${i + 1}`, ...a }) as AssistAction);
}

/** The card's next state from the AI's answer: a round of questions (while rounds are left), else its proposal. */
export function readAssistAnswer(raw: unknown, state: AssistState, check: AssistCheck): AssistState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const base: AssistState = { ...state, intent: str(o.intent, 120) || state.intent, summary: str(o.summary, 240) || state.summary };
  delete base.error; // (an earlier step's failure is over)
  const questions = state.round < MAX_ASSIST_ROUNDS ? cleanQuestions(o.questions) : [];
  if (questions.length) return { ...base, status: "asking", questions, answers: {}, round: state.round + 1, actions: [] };
  return { ...base, status: "proposing", questions: [], actions: cleanActions(o.actions, check) };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

const SCHEMA = {
  type: "object",
  required: ["intent", "summary", "questions", "actions"],
  properties: {
    intent: { type: "string" },
    summary: { type: "string" },
    questions: { type: "array", items: { type: "object", required: ["id", "text", "kind"], properties: { id: { type: "string" }, text: { type: "string" }, kind: { type: "string", enum: QUESTION_KINDS }, options: { type: "array", items: { type: "string" } } } } },
    actions: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "label"],
        properties: {
          kind: { type: "string", enum: ASSIST_ACTION_KINDS },
          label: { type: "string" },
          name: { type: "string" },
          options: { type: "boolean" },
          events: { type: "array", items: { type: "object", required: ["title", "start"], properties: { title: { type: "string" }, start: { type: "string" }, end: { type: "string" }, lastDay: { type: "string" }, allDay: { type: "boolean" } } } },
          calendarId: { type: "integer" },
          text: { type: "string" },
          due: { type: "string" },
          widget: { type: "string" },
          person: { type: "integer" },
          config: { type: "object" },
          markdown: { type: "string" },
        },
      },
    },
  },
};

/** What Zeff can do here: the installed plugins, the widgets (their settings), the people that exist. */
async function assistCheck(busy: Busy[], ctx: { created?: AssistCreated[]; page?: DocNode | null; defaultPerson?: { id: number; name: string } } = {}): Promise<AssistCheck> {
  const { widgetCatalog } = await import("./widgets");
  const people = isInstalled("people") ? await import("@/plugins/people/store") : null;
  return {
    person: (id) => people?.getPerson(id)?.name ?? null,
    widgets: new Map(widgetCatalog().map((w) => [w.id, { label: w.label, settings: w.settings.map((s) => s.key) }])),
    busy,
    can: { calendar: isInstalled("calendar"), todos: isInstalled("todos") },
    calendars: isInstalled("calendar") ? new Map((await import("@/lib/calendar/ir")).listCalendars().map((c) => [c.id, c.name])) : new Map(),
    onPage: widgetsOn(ctx.page ?? null),
    ...(ctx.defaultPerson ? { defaultPerson: ctx.defaultPerson } : {}),
  };
}

/** The widgets a page holds, "widget:personId" (a person widget by its person; others by their id alone). */
function widgetsOn(doc: DocNode | null): Set<string> {
  const out = new Set<string>();
  const walk = (n: DocNode) => {
    if (n.type === "zeffWidget") {
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(String(n.attrs?.config ?? "{}"));
      } catch {
        // no settings
      }
      out.add(`${String(n.attrs?.widget ?? "")}:${config.personId ?? ""}`);
    }
    (n.content ?? []).forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}

/** The page shows todos in a widget (a person's): its todos go there, not into a checklist of their own. */
export const todosWidgetOn = (doc: DocNode | null): boolean => {
  const walk = (n: DocNode): boolean => (n.type === "zeffWidget" && n.attrs?.widget === "people.todos") || (n.content ?? []).some(walk);
  return !!doc && walk(doc);
};

/** What this card set up before (asked again): its proposed appointments (still open), its todos — to update, not to make twice. */
async function madeBefore(created: AssistCreated[]): Promise<string[]> {
  const out: string[] = [];
  const ir = isInstalled("calendar") ? await import("@/lib/calendar/ir") : null;
  for (const c of created) {
    if (c.kind === "event" && ir) {
      const e = ir.eventById(Number(c.id));
      if (e?.proposed) out.push(`- Terminvorschlag in calendarId ${e.calendarId} "${e.calendar.name}": ${e.title} ${e.start}–${e.end}`);
    } else if (c.kind === "todo" || c.kind === "list") out.push(`- Todo${c.kind === "list" ? "s (Checkliste der Seite)" : ""}: ${c.label}`);
  }
  return out;
}

const answerText = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : String(v ?? "")).trim() || "(keine Antwort)";

function assistPrompt(v: { title: string; block: string; page: string; people: string[]; today: Date; period: { from: Date; to: Date }; busy: Busy[]; state: AssistState; history: { q: string; a: string }[]; check: AssistCheck; before?: string[] }): string {
  const lastRound = v.state.round >= MAX_ASSIST_ROUNDS;
  const widgets = [...v.check.widgets].map(([id, w]) => `${id} (${w.label}${w.settings.length ? `; config: ${w.settings.join(", ")}` : ""})`).join("; ");
  const kinds = [
    v.check.can.calendar &&
      `- {"kind":"events","label","calendarId","options","events":[{"title","start","lastDay" | "end","allDay"}]} — Terminvorschläge in einem Kalender (blockieren nichts; der Nutzer nimmt jeden an oder verwirft ihn). calendarId: einer dieser Kalender (weglassen: der Zeff-Kalender): ${[...(v.check.calendars ?? [])].map(([id, name]) => `${id} "${name}"`).join(", ") || "(keine)"}. Ganze Tage: start und lastDay "YYYY-MM-DD" — lastDay ist der LETZTE Tag selbst (Fr 8. bis So 10. = start "…-08", lastDay "…-10"), allDay true, kein end; sonst start und end "YYYY-MM-DDTHH:MM". Meide die belegten Zeiten. Pro Zeitraum genau ein Vorschlag, nichts überlappt (auch keine Anreise im Besuch) — der Nutzer verschiebt die Tage per Drag & Drop. Alternativen (der Nutzer hat mehrere Termine/Zeiträume gewählt oder genannt, oder der Plan hat Varianten): IMMER eine eigene Aktion mit options true und JEDER Alternative als eigenem Termin (Option A, B …; nimmt er eine an, fallen die anderen weg) — lass keine gewählte Alternative weg, leg sie nie zusammen; feste Termine daneben in einer zweiten events-Aktion ohne options.`,
    v.check.can.todos && `- {"kind":"todo","label","text","due"} — eine Aufgabe; Personen beim Namen; due "YYYY-MM-DD" nur wenn sinnvoll.`,
    `- {"kind":"widget","label","widget","person","config"} — ein Baustein der Seite; person = id einer Person oben. Widgets: ${widgets || "(keine)"}`,
    `- {"kind":"text","label","markdown"} — Text für die Seite (z. B. eine Checkliste "- [ ] …").`,
  ].filter(Boolean);
  return [
    "Du denkst auf einer Seite in Zeff mit — der Nutzer hat dich per Knopf gerufen. Verstehe, was er vorhat; frage nur, was den Plan wirklich ändert; schlage dann wenige, wertvolle Schritte vor. Antworte in der Sprache des Textes.",
    "",
    `Heute: ${localDay(v.today)} (${v.today.toLocaleDateString("de-DE", { weekday: "long" })})`,
    `Seite: ${v.title || "(ohne Titel)"}`,
    "",
    ...(v.state.wish ? ["# Was der Nutzer möchte (seine Worte)", v.state.wish, ""] : []),
    v.state.scope === "page" ? "# Die Seite" : "# Der Block",
    v.block || "(leer)",
    ...(v.state.scope === "block" && v.page ? ["", "# Der Rest der Seite (Auszug)", v.page] : []),
    "",
    "# Genannte Personen ([[person:id|Name]])",
    ...(v.people.length ? v.people : ["(keine)"]),
    "",
    `# Deine belegten Zeiten ${localDay(v.period.from)} – ${localDay(v.period.to)}`,
    ...(v.busy.length ? v.busy.map((b) => `- ${stampOf(b.start)}–${stampOf(b.end).slice(11)} ${b.title}`) : ["(keine)"]),
    ...(v.history.length ? ["", "# Deine Fragen und die Antworten", ...v.history.map((h) => `- ${h.q} → ${h.a}`)] : []),
    ...(v.state.summary ? ["", `Bisher verstanden: ${v.state.summary}`] : []),
    ...(v.before?.length
      ? ["", "# Schon angelegt (du wirst erneut gefragt: aktualisiere, statt doppelt anzulegen)", ...v.before, "Neue Terminvorschläge (events) ersetzen die früheren dieser Karte — gib alle an, die gelten sollen. Was passt, lässt du weg."]
      : []),
    "",
    "# Antwort (JSON)",
    "- intent: worum es geht, in wenigen Worten (z. B. \"Hamburg-Reise\").",
    "- summary: eine Zeile, wie du es verstehst (offenes als Frage).",
    lastRound
      ? "- questions: [] — keine Fragen mehr, schlage jetzt vor."
      : `- questions: 0–${MAX_ASSIST_QUESTIONS} kurze Fragen (Runde ${v.state.round + 1} von ${MAX_ASSIST_ROUNDS}), nur was den Plan ändert; kind: multi, wenn mehrere Antworten passen können (Termine, Zeiträume, Optionen zum Vergleichen — immer multi), choice nur wenn genau eine stimmt, sonst text, number, date; options kurz (2–5) bei choice/multi. Weißt du genug: [] und gleich actions.`,
    `- actions (nur ohne questions): 1–${MAX_ASSIST_ACTIONS}, die wenigsten, die wirklich helfen; label: kurz, was es ist.`,
    ...kinds,
    "Erfinde nichts; Personen nur mit den ids oben.",
  ].join("\n");
}

/** One step of the card: the AI asked about the block (`blockJson`, a node) or the whole page (null), with the answers so far. */
export async function runAssist(pageId: number, blockJson: string | null, state: AssistState, today = new Date()): Promise<AssistState> {
  const next = await think(pageId, blockJson, state, today);
  if (next.status === "proposing" && !next.actions.length) throw new ValidationError(t("The AI found nothing to ask or set up here."));
  return next;
}

/** The AI asked once — `final`: no more questions, a proposal now (Regenerate); `doc`: the page as the editor has it. */
async function think(pageId: number, blockJson: string | null, state: AssistState, today: Date, opts: { final?: boolean; doc?: DocNode | null } = {}): Promise<AssistState> {
  const page = store.getPage(pageId);
  if (!page) throw new ValidationError(t("This page is gone."));
  let node: unknown = null;
  try {
    node = blockJson ? JSON.parse(blockJson) : null;
  } catch {
    // not a block: the whole page
  }
  const blockDoc = node ? sanitizeDoc({ type: "doc", content: [node] }) : page.content;
  const block = docToMarkdown(blockDoc).trim().slice(0, 6000);
  const pageText = node ? docText(page.content).slice(0, 3000) : "";
  // The answers of the round asked go with it as questions and answers (a second round asks new ones).
  const history = [...state.history, ...(state.status === "asking" ? state.questions.map((q) => ({ q: q.text, a: answerText(state.answers[q.id]) })) : [])];
  const people: string[] = [];
  if (isInstalled("people")) {
    const { getPerson } = await import("@/plugins/people/store");
    for (const r of [...docRefs(blockDoc), ...(node ? docRefs(page.content) : [])].filter((x) => x.kind === "person").slice(0, 8)) {
      const p = getPerson(Number(r.ref));
      if (!p || people.some((x) => x.startsWith(`- [[person:${p.id}|`))) continue;
      const facts = [p.note, p.compiled?.connection, ...(p.compiled?.keyFacts ?? []).slice(0, 4)].map((x) => str(x, 200)).filter(Boolean);
      people.push(`- [[person:${p.id}|${p.name}]]${facts.length ? ` — ${facts.join("; ")}` : ""}`);
    }
  }
  const period = periodOf([state.wish ?? "", block, state.summary, ...history.map((h) => h.a)].join("\n"), today);
  const busy = isInstalled("calendar") ? (await import("@/lib/calendar/ir")).busyBetween(period.from, period.to).slice(0, 60) : [];
  const firstPerson = /^- \[\[person:(\d+)\|([^\]]*)\]\]/.exec(people[0] ?? "");
  const check = await assistCheck(busy, { created: state.created, page: opts.doc ?? page.content, ...(firstPerson ? { defaultPerson: { id: Number(firstPerson[1]), name: firstPerson[2] } } : {}) });
  const before = await madeBefore(state.created);
  const asked = opts.final ? { ...state, round: MAX_ASSIST_ROUNDS } : state;
  const prompt = assistPrompt({ title: page.title, block, page: pageText, people, today, period, busy, state: asked, history, check, before });
  const { runAi } = await import("@/lib/ai");
  const r = await runAi<unknown>(prompt, SCHEMA, { task: "page-assist", timeoutMs: 3 * 60000, maxBudgetUsd: 0.4 });
  return { ...readAssistAnswer(r.output, asked, check), history, ...(opts.final ? { round: state.round } : {}) };
}

// ---------------------------------------------------------------------------
// Applying: each action's executor — the blocks for the page, what it made elsewhere
// ---------------------------------------------------------------------------

type Made = { nodes: DocNode[]; created: AssistCreated[] };

/** What the executors know: what the card made before (`created`; its earlier proposals replaced by the first events action
 * only — `replace`), the calendars whose block is in the page already or goes in now (`shown`). */
type Context = { created: AssistCreated[]; replace: number[]; shown: Set<number> };

const EXECUTORS: { [K in AssistActionKind]: (a: Extract<AssistAction, { kind: K }>, ctx: Context) => Promise<Made> } = {
  // Proposed appointments (nothing blocked; each accepted or dismissed in the calendar) in the chosen calendar — your Zeff one by
  // default — and that calendar in the page at the first of them. Asked again: this card's earlier proposals (still open)
  // replaced; the calendar's block is in the page already then.
  events: async (a, ctx) => {
    const ir = await import("@/lib/calendar/ir");
    const cal = (a.calendarId && ir.listCalendars().find((c) => c.id === a.calendarId)) || ir.zeffCalendar();
    const earlier = ctx.replace.splice(0);
    const shown = ctx.shown.has(cal.id) || earlier.some((id) => ir.eventById(id)?.calendarId === cal.id) || ctx.created.some((c) => c.kind === "calendar" && Number(c.id) === cal.id);
    // Options: one group (its name made of what they are — the same options asked again are the same ones, one dismissed stays out).
    const group = a.options && a.events.length > 1 ? createHash("sha1").update(JSON.stringify([cal.id, a.events.map((e) => [e.title, e.start, e.end])])).digest("hex").slice(0, 10) : "";
    const { optionKey } = await import("@/lib/calendar/ir-shared");
    const made = ir.proposeEvents(
      cal.id,
      a.events.map((e, i) => ({ ...(group ? { key: optionKey(group, i) } : {}), title: e.title, start: e.start, end: e.end, allDay: !!e.allDay })),
      earlier,
    );
    const created: AssistCreated[] = made.map((e) => ({ kind: "event", id: e.id, label: e.title, href: `/kalender?v=day&d=${e.start.slice(0, 10)}` }));
    if (shown || !made.length) return { nodes: [], created };
    ctx.shown.add(cal.id);
    const first = made.map((e) => e.start.slice(0, 10)).sort()[0];
    const last = made.map((e) => e.end.slice(0, 10)).sort().at(-1)!;
    const span = (new Date(`${last}T00:00`).getTime() - new Date(`${first}T00:00`).getTime()) / 86400000;
    return { nodes: [{ type: "calendarEmbed", attrs: { calendarId: cal.id, view: span > 7 ? "month" : "week", day: first, also: "" } }], created: [{ kind: "calendar", id: cal.id, label: cal.name }, ...created] };
  },
  // A todo: an item of the page's checklist that feeds the Todo engine (applyAssist gathers them into one list) — ticked there,
  // the todo is done; the list taken out of the page, its todos go.
  todo: async (a) => ({ nodes: [{ type: "taskItem", attrs: { checked: false, itemId: newId("i"), ...(a.due ? { due: a.due } : {}) }, content: [{ type: "paragraph", content: [{ type: "text", text: a.text }] }] }], created: [] }),
  widget: async (a) => ({ nodes: [{ type: "zeffWidget", attrs: { widget: a.widget, config: JSON.stringify(a.config), title: "", header: "" } }], created: [] }),
  text: async (a) => ({ nodes: markdownToDoc(a.markdown).content ?? [], created: [] }),
};

/** The text of a page's to-do item, compared as words (case and spacing aside). */
const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const itemKey = (n: DocNode) => flat(docText({ type: "doc", content: (n.content ?? []).filter((c) => c.type !== "taskList") }));

/** A page's blocks of a kind, anywhere in it. */
function nodesOf(doc: DocNode | null, type: string): DocNode[] {
  const out: DocNode[] = [];
  const walk = (n: DocNode) => {
    if (n.type === type) out.push(n);
    (n.content ?? []).forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}

/**
 * The chosen actions of a proposal run (checked again — the card's state comes from the page): the blocks to insert after the
 * card, what was made elsewhere. `again` (Regenerate): the page as the editor has it (`doc`) — what is in it already isn't put
 * in twice (a widget, the calendar's block, a text, a todo), the card's checklist is given back with its id (the editor puts it
 * in place of the old one: its ticked items kept, the open ones those of now), Zeff's todos reused by their text (the card's
 * earlier ones no longer proposed dismissed); `created` is then all the card made, what is gone left out.
 */
export async function applyAssist(pageId: number, state: AssistState, ids: string[], again?: { doc: DocNode | null }): Promise<Made & { summary: string }> {
  const page = store.getPage(pageId);
  if (!page) throw new ValidationError(t("This page is gone."));
  const doc = again ? (again.doc ?? page.content) : null;
  const check = await assistCheck([], { created: state.created, ...(doc ? { page: doc } : {}) });
  const chosen = state.actions.filter((a) => ids.includes(a.id)).map((a) => cleanAction(a, check)).filter((a): a is AssistActionBody => !!a);
  if (!chosen.length && !again) throw new ValidationError(t("Choose at least one thing to set up."));
  const out: Made = { nodes: [], created: [] };
  // The todos: one checklist, where the first of them stands — or, the page showing todos in a widget, Zeff's todos only
  // (the widget shows them; a checklist beside it would be the same twice).
  let list: DocNode | null = null;
  const widgetShows = todosWidgetOn(doc ?? page.content);
  const ctx: Context = {
    created: state.created,
    replace: state.created.filter((c) => c.kind === "event").map((c) => Number(c.id)),
    shown: new Set(nodesOf(doc, "calendarEmbed").map((n) => Number(n.attrs?.calendarId))),
  };
  // Regenerate: the card's checklist in the page (by its id), the page's other to-do items and its text — not put in twice.
  const oldRef = state.created.find((c) => c.kind === "list" && c.ref)?.ref;
  const oldList = oldRef ? (nodesOf(doc, "taskList").find((n) => String(n.attrs?.listId) === oldRef) ?? null) : null;
  const elsewhere = new Set(nodesOf(doc, "taskList").filter((n) => n !== oldList).flatMap((n) => (n.content ?? []).map(itemKey)));
  const pageText = doc ? flat(docText(doc)) : "";
  const earlierTodos = new Set(state.created.filter((c) => c.kind === "todo").map((c) => Number(c.id)));
  const reused = new Set<number>();
  let done = 0;
  try {
    for (const a of chosen) {
      if (a.kind === "todo" && widgetShows) {
        const { addManualTodo, setTodoDue } = await import("@/lib/todos/store");
        const todo = addManualTodo({ ticket: "", text: a.text }); // (the same open text: that one, not a second)
        if (a.due && !todo.outcome) setTodoDue(todo.id, a.due);
        if (!todo.outcome) out.created.push({ kind: "todo", id: todo.id, label: todo.text, href: `/t/${todo.id}` });
        else if (earlierTodos.has(todo.id)) reused.add(todo.id); // the card's own of before: still its own
        done++;
        continue;
      }
      if (doc && a.kind === "text") {
        const words = flat(docText(markdownToDoc(a.markdown)));
        if (words && pageText.includes(words)) continue;
      }
      if (a.kind === "todo" && elsewhere.has(flat(a.text))) continue;
      const made = await (EXECUTORS[a.kind] as (x: typeof a, ctx: Context) => Promise<Made>)(a, ctx);
      done++;
      if (a.kind === "todo") {
        if (!list) {
          list = { type: "taskList", attrs: { listId: oldList ? oldRef! : newId("t"), title: String(oldList?.attrs?.title ?? ""), engine: true }, content: [] };
          out.nodes.push(list);
        }
        list.content!.push(...made.nodes);
        continue;
      }
      out.nodes.push(...made.nodes);
      out.created.push(...made.created);
    }
    if (list && oldList) {
      // The card's checklist anew: what was ticked stays (and isn't added again); an open item of the same text is the same item.
      const old = oldList.content ?? [];
      const ticked = old.filter((i) => i.attrs?.checked === true);
      const have = new Set(ticked.map(itemKey));
      const fresh: DocNode[] = [];
      for (const n of list.content ?? []) {
        const k = itemKey(n);
        if (have.has(k)) continue;
        have.add(k);
        const same = old.find((i) => i.attrs?.checked !== true && itemKey(i) === k);
        fresh.push(same ? { ...same, attrs: { ...same.attrs, ...(n.attrs?.due ? { due: n.attrs.due } : {}) } } : n);
      }
      list.content = [...ticked, ...fresh];
    }
    if (list) out.created.push({ kind: "list", id: 0, label: (list.content ?? []).map((i) => i.content?.[0]?.content?.[0]?.text ?? "").join(" · ").slice(0, 300), ref: String(list.attrs!.listId) });
  } catch (e) {
    await undoAssist(out.created); // half done: nothing left behind
    throw e;
  }
  if (again) out.created = await stillMade(state.created, out.created, reused, widgetShows && chosen.some((a) => a.kind === "todo"));
  return { ...out, summary: `${state.intent || state.summary} · ${t("{n} set up", { n: done })}` };
}

/**
 * Regenerated: all the card made — what it made before and is still there (a calendar, an accepted appointment, its checklist
 * unless given anew, a todo reused or no longer open) and what it made now. Its todos of before that weren't proposed again
 * (`replaceTodos`) and are still open are dismissed: replaced, as its proposals are.
 */
async function stillMade(before: AssistCreated[], now: AssistCreated[], reused: Set<number>, replaceTodos: boolean): Promise<AssistCreated[]> {
  const ir = isInstalled("calendar") ? await import("@/lib/calendar/ir") : null;
  const todos = isInstalled("todos") ? await import("@/lib/todos/store") : null;
  const kept: AssistCreated[] = [];
  for (const c of before) {
    if (now.some((x) => x.kind === c.kind && (c.kind === "list" || x.id === c.id))) continue;
    if (c.kind === "event" && !ir?.eventById(Number(c.id))) continue; // replaced (or dismissed)
    if (c.kind === "todo" && todos && replaceTodos && !reused.has(Number(c.id))) {
      const todo = todos.getTodo(Number(c.id));
      if (todo?.status === "open" && todo.source === "From you") {
        todos.setTodoStatus(todo.id, "dismissed");
        continue;
      }
    }
    kept.push(c);
  }
  return [...kept, ...now];
}

/**
 * "Regenerate" on a card: the AI asked again with what it was told — no new questions — and everything it proposes set up at
 * once, as Apply does when asked again (its earlier proposals replaced, nothing doubled, nothing of yours lost: accepted
 * appointments and ticked todos stay). The card's next state (applied, with all it made) and the blocks for the page (a
 * checklist with the id of one in it: in place of that one).
 */
export async function regenerateAssist(pageId: number, blockJson: string | null, state: AssistState, doc: DocNode | null, today = new Date()): Promise<{ state: AssistState; nodes: DocNode[] }> {
  const page = doc ? sanitizeDoc(doc) : null;
  // (pressed while it asked: those answers count too)
  const next = await think(pageId, blockJson, state, today, { final: true, doc: page });
  if (!next.actions.length) throw new ValidationError(t("The AI found nothing to ask or set up here."));
  const r = await applyAssist(pageId, next, next.actions.map((a) => a.id), { doc: page });
  return { state: { ...next, status: "applied", summary: r.summary, created: r.created }, nodes: r.nodes };
}

/** What a card made outside the page taken back: its proposed appointments (those still proposed) taken out, its todos dismissed — never a calendar. */
export async function undoAssist(created: AssistCreated[]): Promise<number> {
  let n = 0;
  for (const c of created) {
    const id = Number(c.id);
    if (c.kind === "event" && isInstalled("calendar")) {
      const ir = await import("@/lib/calendar/ir");
      if (!ir.eventById(id)?.proposed) continue; // accepted meanwhile (or gone): it stays
      ir.deleteEvent(id);
      n++;
    } else if (c.kind === "todo" && isInstalled("todos")) {
      const b = await import("@/lib/todos/store");
      const todo = b.getTodo(id);
      if (!todo || todo.source !== "From you" || todo.status !== "open") continue;
      b.setTodoStatus(id, "dismissed");
      n++;
    }
  }
  return n;
}
