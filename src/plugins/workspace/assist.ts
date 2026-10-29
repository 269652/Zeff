import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { docRefs, docText, docToMarkdown, markdownToDoc, sanitizeDoc, type DocNode } from "./doc";
import { ASSIST_ACTION_KINDS, MAX_ASSIST_ACTIONS, MAX_ASSIST_QUESTIONS, MAX_ASSIST_ROUNDS, type AssistAction, type AssistActionBody, type AssistActionKind, type AssistCreated, type AssistEvent, type AssistQuestion, type AssistQuestionKind, type AssistState } from "./assist-shared";
import * as store from "./store";

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
};

const two = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const stampOf = (d: Date) => `${dayOf(d)} ${two(d.getHours())}:${two(d.getMinutes())}`;
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

/** The questions as they may be shown: each with a text, a known kind, short options (a choice needs two) — at most four. */
function cleanQuestions(raw: unknown): AssistQuestion[] {
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
  return !Number.isNaN(d.getTime()) && (DAY.test(s) ? dayOf(d) : `${dayOf(d)}T${two(d.getHours())}:${two(d.getMinutes())}`) === s ? d : null;
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
    // Its end: the day after the last (a time given on that last day: the day after it).
    end = !end || end <= from ? new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1) : new Date(end.getFullYear(), end.getMonth(), end.getDate() + (DAY.test(String(o.end)) ? 0 : 1));
    ev = { title, start: dayOf(from), end: dayOf(end), allDay: true };
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
  if (kind === "shadowCalendar") {
    if (!check.can.calendar) return null;
    const events = (Array.isArray(o.events) ? o.events : []).slice(0, 31).map((e) => cleanEvent(e, check.busy)).filter((e): e is AssistEvent => !!e);
    const name = str(o.name, 80) || label;
    return events.length && name ? { kind, label: label || name, name, events } : null;
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
    return { kind, label: label || w.label, widget: String(o.widget), config };
  }
  const markdown = String(o.markdown ?? "").trim().slice(0, 4000);
  return markdown ? { kind: "text", label: label || markdown.split("\n")[0].replace(/^[#\-\s[\]x]+/, "").slice(0, 120), markdown } : null;
}

/** The actions the AI proposed, as Zeff can run them (at most six), numbered a1, a2 … */
export function cleanActions(raw: unknown, check: AssistCheck): AssistAction[] {
  return (Array.isArray(raw) ? raw : [])
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
          events: { type: "array", items: { type: "object", required: ["title", "start", "end"], properties: { title: { type: "string" }, start: { type: "string" }, end: { type: "string" }, allDay: { type: "boolean" } } } },
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
async function assistCheck(busy: Busy[]): Promise<AssistCheck> {
  const { widgetCatalog } = await import("./widgets");
  const people = isInstalled("people") ? await import("@/plugins/people/store") : null;
  return {
    person: (id) => people?.getPerson(id)?.name ?? null,
    widgets: new Map(widgetCatalog().map((w) => [w.id, { label: w.label, settings: w.settings.map((s) => s.key) }])),
    busy,
    can: { calendar: isInstalled("calendar"), todos: isInstalled("todos") },
  };
}

const answerText = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : String(v ?? "")).trim() || "(keine Antwort)";

function assistPrompt(v: { title: string; block: string; page: string; people: string[]; today: Date; period: { from: Date; to: Date }; busy: Busy[]; state: AssistState; history: { q: string; a: string }[]; check: AssistCheck }): string {
  const lastRound = v.state.round >= MAX_ASSIST_ROUNDS;
  const widgets = [...v.check.widgets].map(([id, w]) => `${id} (${w.label}${w.settings.length ? `; config: ${w.settings.join(", ")}` : ""})`).join("; ");
  const kinds = [
    v.check.can.calendar && `- {"kind":"shadowCalendar","label","name","events":[{"title","start","end","allDay"}]} — ein Planungskalender (nur Vorschläge, blockiert nichts). Ganze Tage "YYYY-MM-DD" (end = Tag nach dem letzten, allDay true), sonst "YYYY-MM-DDTHH:MM". Meide die belegten Zeiten.`,
    v.check.can.todos && `- {"kind":"todo","label","text","due"} — eine Aufgabe; Personen beim Namen; due "YYYY-MM-DD" nur wenn sinnvoll.`,
    `- {"kind":"widget","label","widget","person","config"} — ein Baustein der Seite; person = id einer Person oben. Widgets: ${widgets || "(keine)"}`,
    `- {"kind":"text","label","markdown"} — Text für die Seite (z. B. eine Checkliste "- [ ] …").`,
  ].filter(Boolean);
  return [
    "Du denkst auf einer Seite in Zeff mit — der Nutzer hat dich per Knopf gerufen. Verstehe, was er vorhat; frage nur, was den Plan wirklich ändert; schlage dann wenige, wertvolle Schritte vor. Antworte in der Sprache des Textes.",
    "",
    `Heute: ${dayOf(v.today)} (${v.today.toLocaleDateString("de-DE", { weekday: "long" })})`,
    `Seite: ${v.title || "(ohne Titel)"}`,
    "",
    v.state.scope === "page" ? "# Die Seite" : "# Der Block",
    v.block || "(leer)",
    ...(v.state.scope === "block" && v.page ? ["", "# Der Rest der Seite (Auszug)", v.page] : []),
    "",
    "# Genannte Personen ([[person:id|Name]])",
    ...(v.people.length ? v.people : ["(keine)"]),
    "",
    `# Deine belegten Zeiten ${dayOf(v.period.from)} – ${dayOf(v.period.to)}`,
    ...(v.busy.length ? v.busy.map((b) => `- ${stampOf(b.start)}–${stampOf(b.end).slice(11)} ${b.title}`) : ["(keine)"]),
    ...(v.history.length ? ["", "# Deine Fragen und die Antworten", ...v.history.map((h) => `- ${h.q} → ${h.a}`)] : []),
    ...(v.state.summary ? ["", `Bisher verstanden: ${v.state.summary}`] : []),
    "",
    "# Antwort (JSON)",
    "- intent: worum es geht, in wenigen Worten (z. B. \"Hamburg-Reise\").",
    "- summary: eine Zeile, wie du es verstehst (offenes als Frage).",
    lastRound
      ? "- questions: [] — keine Fragen mehr, schlage jetzt vor."
      : `- questions: 0–${MAX_ASSIST_QUESTIONS} kurze Fragen (Runde ${v.state.round + 1} von ${MAX_ASSIST_ROUNDS}), nur was den Plan ändert; kind: choice (eine Antwort), multi (mehrere), text, number, date; options kurz (2–5) bei choice/multi. Weißt du genug: [] und gleich actions.`,
    `- actions (nur ohne questions): 1–${MAX_ASSIST_ACTIONS}, die wenigsten, die wirklich helfen; label: kurz, was es ist.`,
    ...kinds,
    "Erfinde nichts; Personen nur mit den ids oben.",
  ].join("\n");
}

/** One step of the card: the AI asked about the block (`blockJson`, a node) or the whole page (null), with the answers so far. */
export async function runAssist(pageId: number, blockJson: string | null, state: AssistState, today = new Date()): Promise<AssistState> {
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
  const period = periodOf([block, state.summary, ...history.map((h) => h.a)].join("\n"), today);
  const busy = isInstalled("calendar") ? (await import("@/lib/calendar/ir")).busyBetween(period.from, period.to).slice(0, 60) : [];
  const check = await assistCheck(busy);
  const prompt = assistPrompt({ title: page.title, block, page: pageText, people, today, period, busy, state, history, check });
  const { runAi } = await import("@/lib/ai");
  const r = await runAi<unknown>(prompt, SCHEMA, { task: "page-assist", timeoutMs: 3 * 60000, maxBudgetUsd: 0.4 });
  const next = { ...readAssistAnswer(r.output, state, check), history };
  if (next.status === "proposing" && !next.actions.length) throw new ValidationError(t("The AI found nothing to ask or set up here."));
  return next;
}

// ---------------------------------------------------------------------------
// Applying: each action's executor — the blocks for the page, what it made elsewhere
// ---------------------------------------------------------------------------

type Made = { nodes: DocNode[]; created: AssistCreated[] };

const EXECUTORS: { [K in AssistActionKind]: (a: Extract<AssistAction, { kind: K }>) => Promise<Made> } = {
  // A plan calendar (a shadow one: suggestions, nothing blocked) with its appointments, shown in the page.
  shadowCalendar: async (a) => {
    const ir = await import("@/lib/calendar/ir");
    const cal = ir.createShadowCalendar(a.name);
    for (const e of a.events) ir.addEvent(cal.id, { title: e.title, start: e.start, end: e.end, allDay: !!e.allDay });
    const first = a.events.map((e) => e.start.slice(0, 10)).sort()[0];
    const last = a.events.map((e) => e.end.slice(0, 10)).sort().at(-1)!;
    const span = (new Date(`${last}T00:00`).getTime() - new Date(`${first}T00:00`).getTime()) / 86400000;
    return { nodes: [{ type: "calendarEmbed", attrs: { calendarId: cal.id, view: span > 7 ? "month" : "week", day: first, also: "" } }], created: [{ kind: "calendar", id: cal.id, label: cal.name }] };
  },
  // A todo of yours, linked from the page (one already open with the same text: that one, not made again).
  todo: async (a) => {
    const { addManualTodo, setTodoDue } = await import("@/lib/boards/store");
    const todo = addManualTodo({ ticket: "", text: a.text });
    if (a.due && !todo.outcome) setTodoDue(todo.id, a.due);
    const ref = { type: "zeffRef", attrs: { kind: "todo", ref: String(todo.id), label: `${todo.ref} ${todo.text}`.slice(0, 80), href: `/t/${todo.id}` } };
    return { nodes: [{ type: "paragraph", content: [ref] }], created: todo.outcome ? [] : [{ kind: "todo", id: todo.id, label: todo.text, href: `/t/${todo.id}` }] };
  },
  widget: async (a) => ({ nodes: [{ type: "zeffWidget", attrs: { widget: a.widget, config: JSON.stringify(a.config), title: "", header: "" } }], created: [] }),
  text: async (a) => ({ nodes: markdownToDoc(a.markdown).content ?? [], created: [] }),
};

/** The chosen actions of a proposal run (checked again — the card's state comes from the page): the blocks to insert after the card, what was made elsewhere. */
export async function applyAssist(pageId: number, state: AssistState, ids: string[]): Promise<Made & { summary: string }> {
  if (!store.getPage(pageId)) throw new ValidationError(t("This page is gone."));
  const check = await assistCheck([]);
  const chosen = state.actions.filter((a) => ids.includes(a.id)).map((a) => cleanAction(a, check)).filter((a): a is AssistActionBody => !!a);
  if (!chosen.length) throw new ValidationError(t("Choose at least one thing to set up."));
  const out: Made = { nodes: [], created: [] };
  try {
    for (const a of chosen) {
      const made = await (EXECUTORS[a.kind] as (x: typeof a) => Promise<Made>)(a);
      out.nodes.push(...made.nodes);
      out.created.push(...made.created);
    }
  } catch (e) {
    await undoAssist(out.created); // half done: nothing left behind
    throw e;
  }
  return { ...out, summary: `${state.intent || state.summary} · ${t("{n} set up", { n: chosen.length })}` };
}

/** What a card made outside the page taken back: its plan calendars deleted, its todos dismissed — only those (never another calendar). */
export async function undoAssist(created: AssistCreated[]): Promise<number> {
  let n = 0;
  for (const c of created) {
    const id = Number(c.id);
    if (c.kind === "calendar" && isInstalled("calendar")) {
      const ir = await import("@/lib/calendar/ir");
      if (!ir.listCalendars().some((x) => x.id === id && x.shadow)) continue;
      ir.deleteCalendar(id);
      n++;
    } else if (c.kind === "todo" && isInstalled("todos")) {
      const b = await import("@/lib/boards/store");
      const todo = b.getTodo(id);
      if (!todo || todo.source !== "From you" || todo.status !== "open") continue;
      b.setTodoStatus(id, "dismissed");
      n++;
    }
  }
  return n;
}
