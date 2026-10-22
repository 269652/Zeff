/**
 * "What you should know" (the know plugin): the AI's short summary on top of a brief — a few points, each resting on numbered
 * lines of the brief (its people, open loops, latest events, related things) and linked to them; a point without a valid line is
 * dropped. Kept per brief (a meeting "event:<id>", a row "row:<id>", a ref) with the brief's hash: the AI is asked again only when
 * what the brief says changed — no call when nothing did. Made before your meetings with the briefing (prepareMeetingBriefs,
 * hooked into the People matching step; a switch turns it off) and when you ask on a panel. Your verdict on one goes to the
 * learning ledger. The brief is already cut to what may be seen; the LLM layer leaves secret lines out of every prompt. Server only.
 */
import { getSqlite } from "@/db";
import { recordFeedback } from "@/lib/learning/ledger";
import { getPref, setPref } from "@/lib/prefs";
import { fillPrompt } from "@/lib/prompts";
import { isInstalled } from "@/plugins/state";
import { briefFor, meetingBrief, upcomingMeetings, type HealthLike } from "./brief";
import { briefEmpty, type Brief, type BriefLink, type BriefSummary } from "./shared";

/** What the AI answers. */
type Answer = { points?: { text?: string; sources?: number[] }[] };
/** An AI: the prompt and the schema in, its JSON out (null: none). */
export type SummaryAi = (prompt: string, schema: object) => Promise<Answer | null>;

const SCHEMA = {
  type: "object",
  properties: { points: { type: "array", items: { type: "object", properties: { text: { type: "string" }, sources: { type: "array", items: { type: "integer" } } }, required: ["text", "sources"] } } },
  required: ["points"],
};

/** How the summary is asked for ({{what}}: the meeting or the thing) — a page of System → Prompts. */
export const KNOW_SUMMARY_INSTRUCTIONS =
  "Du bereitest mich auf {{what}} vor. Unten steht nummeriert, was Zeff darüber weiß: die Personen (Rolle, Fakten, Abwesenheit, Geburtstag, Geld), offene Zusagen (was ich schulde, was man mir schuldet), die letzten Kontakte und Ereignisse, verwandte Tickets, Vorgänge und Projekte. Schreib 2 bis 5 kurze Punkte auf Deutsch, was ich jetzt wissen sollte — Offenes und Überfälliges zuerst, dann was sich zuletzt getan hat, dann Persönliches (ein Geburtstag, eine Abwesenheit, offenes Geld), wenn es dasteht. Lieber ein Punkt zu viel als etwas Wichtiges weglassen. Jeder Punkt nennt in sources die Nummern der Zeilen, auf die er sich stützt; nichts, was nicht in den Zeilen steht. Nur JSON nach diesem Schema:";

const AUTO = "know.autoSummary";
/** Whether the summaries are made before your meetings by themselves (with the briefing) — on until you switch it off. */
export const autoSummary = (): boolean => getPref<boolean>(AUTO, true) !== false;
export const setAutoSummary = (on: boolean): void => setPref(AUTO, on);

/** How far ahead the briefing makes the summaries of meetings, and at most how many a run. */
const AHEAD_MINUTES = 180;
const PER_RUN = 6;

function db() {
  const d = getSqlite();
  d.exec("create table if not exists know_summaries (key text primary key, hash text not null, points text not null default '[]', at text not null)");
  return d;
}

const day = (iso: string) => iso.slice(0, 16).replace("T", " ");
const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** The brief as numbered lines for the AI, each with what it links to. Line n is `lines[n - 1]`. */
export function summaryLines(b: Brief): { text: string; link: BriefLink }[] {
  const out: { text: string; link: BriefLink }[] = [];
  const add = (text: string, link: BriefLink) => out.push({ text: text.replace(/\s+/g, " ").trim().slice(0, 400), link });
  if (b.meeting) add(`Termin „${b.meeting.title}“ am ${day(b.meeting.start)}${b.meeting.location ? ` in ${b.meeting.location}` : ""}${b.meeting.attendees.length ? `, mit ${b.meeting.attendees.join(", ")}` : ""}`, { ref: `event:${b.meeting.id}`, label: b.meeting.title, href: b.meeting.href });
  for (const p of b.people) {
    const link = { ref: p.ref, label: p.name, href: p.href };
    const bits = [p.role ? `Rolle: ${p.role}` : "", p.away ? `abwesend bis ${p.away.until}` : "", p.birthday ? `${p.birthday.label} am ${p.birthday.on} (in ${p.birthday.inDays} Tagen${p.birthday.turns ? `, wird ${p.birthday.turns}` : ""})` : "", p.money?.owe ? `ich schulde ${euro(p.money.owe)}` : "", p.money?.owed ? `schuldet mir ${euro(p.money.owed)}` : "", p.lastContact ? `letzter Kontakt ${day(p.lastContact.at)} (${p.lastContact.title})` : ""].filter(Boolean);
    add(`Person ${p.name}${bits.length ? `: ${bits.join("; ")}` : ""}`, link);
    for (const f of p.facts) add(`${p.name} — ${f.text}`, link);
  }
  for (const l of b.loops) {
    const who = l.direction === "mine" ? `Ich schulde ${l.personName}` : l.direction === "theirs" ? `${l.personName} schuldet mir` : `Offen mit ${l.personName}`;
    add(`${who}: ${l.text}${l.due ? ` (fällig ${l.due}${l.overdue ? ", überfällig" : ""})` : ""}`, { ref: `person:${l.personId}`, label: l.personName, href: b.people.find((p) => p.id === l.personId)?.href ?? "" });
  }
  for (const e of b.recent) add(`${day(e.at)} ${e.kind}: ${e.title}${e.summary && e.summary !== e.title ? ` — ${e.summary.slice(0, 200)}` : ""}`, { ref: `tl:${e.id}`, label: e.title, href: e.href });
  for (const r of b.related) add(`Verwandt: ${r.label}`, r);
  return out;
}

type Row = { key: string; hash: string; points: string; at: string };

/** The summary kept for `key` — `current` when it was made from this hash (null hash: any). null: none made yet. */
export function cachedSummary(key: string, hash: string | null): BriefSummary | null {
  const r = db().prepare("select * from know_summaries where key = ?").get(key) as Row | undefined;
  if (!r) return null;
  let points: BriefSummary["points"] = [];
  try {
    points = JSON.parse(r.points) as BriefSummary["points"];
  } catch {
    points = [];
  }
  return { points, hash: r.hash, at: r.at, current: hash == null || r.hash === hash };
}

/** The default AI: the LLM layer's task "know-summary". */
const llmAi: SummaryAi = async (prompt, schema) => {
  const { runAi } = await import("@/lib/ai");
  return (await runAi<Answer>(prompt, schema, { task: "know-summary", timeoutMs: 180000 })).output ?? null;
};

/**
 * The summary of a brief, made by the AI only when none is kept for this brief as it is now (`force`: again anyway). null for a
 * brief with nothing to say (no call) or when the AI gave nothing usable.
 */
export async function summarizeBrief(key: string, b: Brief, opts: { ai?: SummaryAi; force?: boolean } = {}): Promise<BriefSummary | null> {
  if (briefEmpty(b)) return null;
  const had = cachedSummary(key, b.hash);
  if (had?.current && !opts.force) return had;
  const lines = summaryLines(b);
  const what = b.meeting ? `den Termin „${b.meeting.title}“ (${day(b.meeting.start)})` : `„${b.label}“`;
  const prompt = `${fillPrompt("know-summary", KNOW_SUMMARY_INSTRUCTIONS, { what })}\n${JSON.stringify(SCHEMA)}\n\n${lines.map((l, i) => `[${i + 1}] ${l.text}`).join("\n")}`;
  const answer = await (opts.ai ?? llmAi)(prompt, SCHEMA);
  const points = (answer?.points ?? []).flatMap((p) => {
    const text = String(p.text ?? "").trim().slice(0, 400);
    const sources = [...new Set((Array.isArray(p.sources) ? p.sources : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= lines.length).map((n) => lines[n - 1].link);
    return text && sources.length ? [{ text, sources }] : [];
  });
  if (!points.length) return had;
  const at = new Date().toISOString();
  db().prepare("insert into know_summaries (key, hash, points, at) values (?, ?, ?, ?) on conflict(key) do update set hash = excluded.hash, points = excluded.points, at = excluded.at").run(key, b.hash, JSON.stringify(points), at);
  return { points, hash: b.hash, at, current: true };
}

/** A meeting's key for its summary (a series' occurrence by its day). */
export const meetingKey = (id: number, occurrence?: string | null) => `event:${id}${occurrence ? `:${occurrence.slice(0, 10)}` : ""}`;

/**
 * Before your meetings (run with the briefing — the People matching step): the summaries of the meetings with people in the next
 * hours made where none is kept for them as they are now. Off with the switch, without the LLM plugin (unless an AI is given —
 * tests) or this plugin. How many were made.
 */
export async function prepareMeetingBriefs(opts: { now?: Date; ai?: SummaryAi; health?: HealthLike[] | null } = {}): Promise<{ made: number }> {
  if (!isInstalled("know") || !autoSummary() || (!opts.ai && !isInstalled("llm"))) return { made: 0 };
  let made = 0;
  for (const m of upcomingMeetings({ now: opts.now, withinMinutes: AHEAD_MINUTES }).slice(0, PER_RUN)) {
    const b = await meetingBrief(m.id, { now: opts.now, occurrence: m.occurrence ?? undefined, health: opts.health });
    if (!b) continue;
    const key = meetingKey(m.id, m.occurrence);
    if (cachedSummary(key, b.hash)?.current) continue;
    try {
      if (await summarizeBrief(key, b, { ai: opts.ai })) made++;
    } catch (e) {
      console.error("[know] meeting summary:", e);
    }
  }
  return { made };
}

/** Your verdict on a summary (helpful or not) — kept in the learning ledger (step "know-summary"). */
export function rateSummary(key: string, verdict: "accepted" | "rejected"): void {
  recordFeedback({ step: "know-summary", itemRef: key, verdict, kind: key.split(":")[0] });
}

/** The brief for a key as the panels and the MCP ask for it: a meeting, a row, or refs. */
export async function briefOfKey(q: { event?: number; occurrence?: string; row?: number; refs?: string[] }, now = new Date()): Promise<{ key: string; brief: Brief } | null> {
  if (q.event) {
    const b = await meetingBrief(q.event, { now, occurrence: q.occurrence });
    return b ? { key: meetingKey(q.event, q.occurrence), brief: b } : null;
  }
  if (q.row) {
    const { rowEvent, rowRefs } = await import("./brief");
    // An appointment's row (the calendar database): its meeting's brief.
    const ev = rowEvent(q.row);
    if (ev) return briefOfKey({ event: ev.id, occurrence: ev.occurrence }, now);
    const { labelOf } = await import("@/plugins/timeline/refs");
    return { key: `row:${q.row}`, brief: await briefFor(rowRefs(q.row), { now, label: labelOf(`page:${q.row}`) }) };
  }
  const refs = (q.refs ?? []).filter(Boolean);
  return refs.length ? { key: `ref:${refs.join(",")}`, brief: await briefFor(refs, { now }) } : null;
}
