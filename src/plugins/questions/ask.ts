import { errorMessage } from "@/lib/errors";
import { getLanguage } from "@/lib/i18n/server";
import { isoDay } from "@/lib/text";
import { promptText } from "@/lib/prompts";
import { workspaceDatabases } from "./builtin-views";
import type { KnowledgeAnswer } from "@/plugins/knowledge/shared";
import type { QueryResultView, StructuredAnswer, StructuredSource } from "./shared";
import { AGGREGATES, TIME_DIMS, listViews, runQuery, validateQuery, type QueryContext, type QueryView } from "./views";

/**
 * Structured questions: a question about numbers and dates ("Wie viel habe ich 2026 für Handwerker ausgegeben?", "Wann
 * zuletzt mit Y gesprochen?") answered from Zeff's own data instead of from text. One AI call routes and plans at once —
 * text (the knowledge's answer) or structured, with up to three queries over the named views (views.ts) as JSON; the
 * queries are checked (a plan that fails goes back once with what was wrong), Zeff runs them, and a second AI call
 * phrases the answer from the numbers, citing the rows behind them, which come back as links. The queries come along,
 * so the chat can show how it was computed. Server only.
 */

/** The planner's instructions — a page of System → Prompts. */
export const PLAN_INSTRUCTIONS = `Du entscheidest, wie eine Frage der Person beantwortet wird, und planst dafür Abfragen über ihre eigenen Daten in Zeff.

- kind "structured": Die Frage will Zahlen, Anzahlen, Summen, Zeitpunkte, Häufigkeiten oder Rangfolgen aus ihren eigenen Daten (Arbeitszeit, Kontobewegungen, Termine, Todos, Nachrichten, Workspace-Datenbanken) — z. B. „wie viel“, „wie oft“, „wann zuletzt“, „welche … am meisten“. Plane dann 1 bis 3 Abfragen über die Sichten unten.
- kind "text": Die Frage will Wissen, Erklärungen oder Inhalte aus Dokumentation und Texten („wie funktioniert …“, „wer ist zuständig …“, „was steht in …“). Dann keine Abfragen.
- Kann eine Sicht die Frage beantworten, nimm "structured" — auch wenn du nicht sicher bist, dass Daten da sind.

Eine Abfrage: view (Name einer Sicht), filters (Liste von {name, value} — bei Filtern vom Typ texts {name, values: [...]}, bei where {name: "where", prop, op, value}), optional groupBy (eine Gruppierung der Sicht oder day/week/month/year/weekday), aggregate (${AGGREGATES.join(", ")}: count = Anzahl, sum/avg/min/max über measure, first/last = frühester/letzter Zeitpunkt, count_days = an wie vielen Tagen, list = die Einträge), measure (bei sum/avg/min/max), order (desc|asc), limit.
Nutze nur die Sichten, Filter, Gruppierungen und Maße unten — erfinde keine. Zeiträume als from/to (YYYY-MM-DD, YYYY-MM oder YYYY), bezogen auf heute. Lieber etwas weiter fassen (mehr Suchwörter, Synonyme) als etwas Gesuchtes zu verpassen.`;

/** The phrasing's instructions — a page of System → Prompts. */
export const ANSWER_INSTRUCTIONS = `Beantworte die Frage der Person nur anhand der Ergebnisse der Abfragen unten (ihre eigenen Daten in Zeff). Erfinde nichts.
Nenne die Zahlen genau (mit Einheit: Stunden, Euro, Anzahl, Datum) und sag kurz, worüber gerechnet wurde (Zeitraum, Filter). Belege Einträge mit ihrer Nummer in eckigen Klammern, z. B. [3].
Ist ein Ergebnis leer, sag das — und was gesucht wurde, damit die Person die Frage anders stellen kann.`;

type PlanFilter = { name?: string; value?: unknown; values?: unknown[]; prop?: string; op?: string };
type PlanQuery = { view?: string; aggregate?: string; groupBy?: string; measure?: string; order?: string; limit?: number; filters?: PlanFilter[] | Record<string, unknown> };
export type Plan = { kind?: string; why?: string; queries?: PlanQuery[] };
type Phrased = { answer?: string; cites?: number[] };

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["structured", "text"] },
    why: { type: "string", description: "Ein kurzer Satz, warum." },
    queries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          view: { type: "string" },
          aggregate: { type: "string", enum: [...AGGREGATES] },
          groupBy: { type: "string" },
          measure: { type: "string" },
          order: { type: "string", enum: ["desc", "asc"] },
          limit: { type: "integer" },
          filters: {
            type: "array",
            items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" }, values: { type: "array", items: { type: "string" } }, prop: { type: "string" }, op: { type: "string" } }, required: ["name"] },
          },
        },
        required: ["view", "aggregate"],
      },
    },
  },
  required: ["kind", "queries"],
};

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "Die Antwort, knapp; Belege als [1], [2] im Text." },
    cites: { type: "array", items: { type: "integer" }, description: "Die Nummern der Einträge, die du benutzt hast." },
  },
  required: ["answer", "cites"],
};

const LANGUAGE: Record<string, string> = { de: "Deutsch", en: "Englisch", es: "Spanisch" };

/** A view as the planner reads it. */
function describeView(v: QueryView): string {
  const filters = Object.entries(v.filters).map(([k, f]) => `${k} (${f.type}${f.values ? `: ${f.values.join("|")}` : ""}${f.required ? ", Pflicht" : ""}) — ${f.description}`);
  const measures = Object.entries(v.measures).map(([k, d]) => `${k} — ${d}`);
  return [
    `### ${v.name}`,
    v.description,
    `Filter: ${filters.join("; ") || "keine"}`,
    v.dynamic ? `Gruppierungen: die Eigenschaften der Datenbank, ${TIME_DIMS.join(", ")}` : `Gruppierungen: ${[...v.dims, ...TIME_DIMS].join(", ")}`,
    v.dynamic ? "Maße: ihre Zahl-Eigenschaften" : `Maße: ${measures.join("; ") || "keine (nur zählen)"}`,
  ].join("\n");
}

export function planPrompt(question: string, history: { role: string; text: string }[], ctx: QueryContext, retry?: string): string {
  const views = listViews(ctx);
  const today = ctx.now ?? new Date();
  const dbs = views.some((v) => v.name === "workspace") ? workspaceDatabases() : [];
  return [
    promptText("questions-plan", PLAN_INSTRUCTIONS),
    "",
    `Heute ist ${isoDay(today)}.`,
    "",
    "## Sichten",
    ...views.map(describeView),
    ...(dbs.length ? ["", "## Datenbanken des Workspace (für die Sicht workspace)", ...dbs.map((d) => `- ${d.id} „${d.title}“: ${d.props}`)] : []),
    ...(history.length ? ["", "## Gespräch bisher", ...history.slice(-6).map((h) => `${h.role === "assistant" ? "Antwort" : "Frage"}: ${h.text.slice(0, 600)}`)] : []),
    "",
    `## Frage\n${question}`,
    ...(retry ? ["", `## Dein letzter Plan ging nicht\n${retry}\nKorrigiere ihn mit den erlaubten Namen.`] : []),
  ].join("\n");
}

/** The results as the phrasing reads them: each query, its total and groups, its rows numbered across all queries. */
function resultsBlock(results: QueryResultView[], sources: { n: number; row: QueryResultView["rows"][number] }[]): string {
  return results
    .map((r, i) => {
      const rows = sources.filter((s) => r.rows.includes(s.row));
      const groups = r.groups.slice(0, 25).map((g) => `- ${g.key}: ${g.value ?? "—"} (${g.count} Einträge)`);
      return [
        `### Abfrage ${i + 1}: ${r.explain}`,
        `Gesamt: ${r.query.aggregate}${r.query.measure ? `(${r.query.measure})` : ""} = ${r.total.value ?? "—"} über ${r.total.count} Einträge`,
        ...(groups.length ? [`Gruppen (${r.groupsTotal}${r.groupsTotal > groups.length ? `, die ersten ${groups.length}` : ""}):`, ...groups] : []),
        ...(rows.length ? ["Einträge:", ...rows.map((s) => `[${s.n}] ${s.row.at.slice(0, 16).replace("T", " ")} · ${s.row.title}${s.row.value !== undefined ? ` · ${s.row.value}` : ""}`)] : ["Keine Einträge."]),
      ].join("\n");
    })
    .join("\n\n");
}

export type AskDeps = {
  plan?: (prompt: string) => Promise<Plan>;
  phrase?: (prompt: string) => Promise<Phrased>;
  context?: QueryContext;
};

export type Routed = { kind: "text"; why?: string } | { kind: "structured"; answer: StructuredAnswer };

const realPlan = async (prompt: string): Promise<Plan> => {
  const { runAi } = await import("@/lib/ai");
  return (await runAi<Plan>(prompt, PLAN_SCHEMA, { task: "questions-structured", timeoutMs: 3 * 60000, maxBudgetUsd: 0.2 })).output ?? {};
};
const realPhrase = async (prompt: string): Promise<Phrased> => {
  const { runAi } = await import("@/lib/ai");
  return (await runAi<Phrased>(prompt, ANSWER_SCHEMA, { task: "questions-structured", timeoutMs: 3 * 60000, maxBudgetUsd: 0.2 })).output ?? {};
};

/** The plan's queries checked: the good ones, or what is wrong with the first that isn't. */
function checkPlan(plan: Plan, ctx: QueryContext): { ok: true; queries: PlanQuery[] } | { ok: false; error: string } {
  const queries = (Array.isArray(plan.queries) ? plan.queries : []).slice(0, 3);
  if (!queries.length) return { ok: false, error: "No queries." };
  for (const q of queries) {
    const v = validateQuery(q, ctx);
    if (!v.ok) return { ok: false, error: v.error };
  }
  return { ok: true, queries };
}

/**
 * A question routed and, when it is about the data, answered from it. "text": the knowledge's answer is wanted (or no
 * plan held up — the text answer is the fallback, never nothing).
 */
export async function askStructured(question: string, history: { role: string; text: string }[], deps: AskDeps = {}): Promise<Routed> {
  const ctx = deps.context ?? { via: "chat" };
  const plan = deps.plan ?? realPlan;
  const phrase = deps.phrase ?? realPhrase;
  const started = Date.now();
  let p = await plan(planPrompt(question, history, ctx));
  if (p.kind !== "structured") return { kind: "text", why: p.why };
  let checked = checkPlan(p, ctx);
  let results: QueryResultView[] | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (checked.ok) {
      try {
        results = [];
        for (const q of checked.queries) results.push(await runQuery(q, ctx));
        break;
      } catch (err) {
        // A Workspace database's property names are only known when it runs.
        checked = { ok: false, error: errorMessage(err) };
        results = null;
      }
    }
    if (attempt === 1) break;
    p = await plan(planPrompt(question, history, ctx, (checked as { error: string }).error));
    if (p.kind !== "structured") return { kind: "text", why: p.why };
    checked = checkPlan(p, ctx);
  }
  if (!results) return { kind: "text", why: checked.ok ? undefined : checked.error };
  let n = 0;
  const numbered = results.flatMap((r) => r.rows.map((row) => ({ n: ++n, row, view: r.query.view })));
  const lang = LANGUAGE[getLanguage()] ?? "Deutsch";
  const raw = await phrase([promptText("questions-answer", ANSWER_INSTRUCTIONS), `Antworte auf ${lang}.`, "", `Frage: ${question}`, "", resultsBlock(results, numbered)].join("\n"));
  const answer = String(raw.answer ?? "").slice(0, 4000);
  const cited = new Set([...(raw.cites ?? []).map(Number), ...[...answer.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]))]);
  const sources: StructuredSource[] = numbered
    .filter((s) => cited.has(s.n))
    .map((s) => ({ n: s.n, title: s.row.title, url: s.row.href ?? "", heading: `${s.view} · ${s.row.at.slice(0, 10)}`, excerpt: s.row.value !== undefined ? String(s.row.value) : "" }));
  return { kind: "structured", answer: { answer, sources, queries: results, model: null, durationMs: Date.now() - started } };
}

/**
 * The knowledge chat's router: a question about the data answered from it, as the chat's answer (with the queries);
 * null — a text question, the plugin off, or the AI failing — leaves it to the knowledge, as before.
 */
export async function chatAnswer(question: string, history: { role: string; text: string }[], deps: AskDeps = {}): Promise<KnowledgeAnswer | null> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("questions")) return null;
  try {
    const r = await askStructured(question, history, deps);
    if (r.kind !== "structured") return null;
    return { answer: r.answer.answer, sources: r.answer.sources, entities: [], searchedFor: "", model: r.answer.model, durationMs: r.answer.durationMs, structured: { queries: r.answer.queries } };
  } catch (err) {
    console.error("[questions]", errorMessage(err));
    return null;
  }
}
