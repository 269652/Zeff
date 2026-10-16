import { getSqlite } from "@/db";
import { cellText, newId, newProperty, newView, type FilterRule, type Option, type Property } from "./model";
import { holds, recordText, type SourceRecord } from "./pipeline";
import { addJob } from "./jobs";
import { addRow, createPage, getDatabase, getPage, rawRows } from "./store";

/**
 * Rules as data: a database whose rows are rules — WHEN (a field, a condition, a value; no field: the record as a whole)
 * THEN (drop the record, set a field, hand it to an agent as a job, or a hint every agent gets). Written by you or the AI
 * like any row, paused by a tick, in priority order (the lowest first). A pipeline's rules step applies them to its records;
 * a record dropped by a rule meets no rule after it. The fixed property ids let the code, the AI and the views meet.
 */

export const RULE = { field: "rule_field", op: "rule_op", value: "rule_value", then: "rule_then", target: "rule_target", set: "rule_set", prio: "rule_prio", paused: "rule_paused", why: "rule_why" } as const;

/** The conditions as the rule rows name them (German, or the English the filter knows). */
const OPS: Record<string, FilterRule["op"]> = {
  "enthält": "contains",
  "enthält nicht": "not_contains",
  ist: "is",
  "ist nicht": "is_not",
  leer: "empty",
  "nicht leer": "not_empty",
  contains: "contains",
  not_contains: "not_contains",
  is: "is",
  is_not: "is_not",
  empty: "empty",
  not_empty: "not_empty",
};
export const RULE_OPS = ["enthält", "enthält nicht", "ist", "ist nicht", "leer", "nicht leer"] as const;

/** What a rule does. */
export type RuleAction = "exclude" | "set" | "job" | "hint";
const THEN: Record<string, RuleAction> = { "ausschließen": "exclude", "feld setzen": "set", "auftrag anlegen": "job", "hinweis für agenten": "hint", exclude: "exclude", set: "set", job: "job", hint: "hint" };
export const RULE_THEN = ["Ausschließen", "Feld setzen", "Auftrag anlegen", "Hinweis für Agenten"] as const;

export type Rule = { id: number; title: string; field: string; op: FilterRule["op"]; value: string; then: RuleAction; target: string; set: string; prio: number; why: string };

const opt = (name: string, i: number): Option => ({ id: newId("o"), name, color: ["gray", "blue", "green", "orange", "purple", "pink"][i % 6] });

/** A rules database: its properties, a table in priority order. */
export function createRulesDatabase(parentId: number | null, title = "Regeln"): number {
  const sel = (id: string, name: string, names: readonly string[]): Property => ({ ...newProperty(name, "select"), id, options: names.map(opt) });
  const text = (id: string, name: string): Property => ({ ...newProperty(name, "text"), id });
  const properties: Property[] = [
    { ...newProperty("Pausiert", "checkbox"), id: RULE.paused },
    text(RULE.field, "Feld"),
    sel(RULE.op, "Bedingung", RULE_OPS),
    text(RULE.value, "Wert"),
    sel(RULE.then, "Dann", RULE_THEN),
    text(RULE.target, "Ziel / Anweisung"),
    text(RULE.set, "Setzen auf"),
    { ...newProperty("Priorität", "number"), id: RULE.prio },
    text(RULE.why, "Warum"),
  ];
  const table = { ...newView("Regeln", "table"), sorts: [{ prop: RULE.prio, dir: "asc" as const }] };
  return createPage({ kind: "database", title, icon: "📏", parentId, schema: { titleName: "Regel", properties, views: [table], rules: true } });
}

/** A rule as a row (by the names the rows show). */
export function addRule(dbId: number, v: { title: string; field?: string; op?: string; value?: string; then: string; target?: string; set?: string; prio?: number; why?: string; paused?: boolean }): number {
  const d = getDatabase(dbId);
  if (!d) throw new Error("No such database.");
  const choice = (prop: string, name: string | undefined) => (name ? d.schema.properties.find((p) => p.id === prop)?.options?.find((o) => o.name.toLowerCase() === name.toLowerCase())?.id : undefined);
  const cells: Record<string, unknown> = {
    ...(v.field ? { [RULE.field]: v.field } : {}),
    ...(choice(RULE.op, v.op) ? { [RULE.op]: choice(RULE.op, v.op) } : {}),
    ...(v.value ? { [RULE.value]: v.value } : {}),
    ...(choice(RULE.then, v.then) ? { [RULE.then]: choice(RULE.then, v.then) } : {}),
    ...(v.target ? { [RULE.target]: v.target } : {}),
    ...(v.set ? { [RULE.set]: v.set } : {}),
    ...(v.prio !== undefined ? { [RULE.prio]: v.prio } : {}),
    ...(v.why ? { [RULE.why]: v.why } : {}),
    ...(v.paused ? { [RULE.paused]: true } : {}),
  };
  return addRow(dbId, { title: v.title, cells });
}

/** The rules of a database that are on, in order: the lowest priority first (none given: last), then as written. */
export function loadRules(dbId: number): Rule[] {
  const d = getDatabase(dbId);
  if (!d) return [];
  const name = (prop: string, v: unknown) => d.schema.properties.find((p) => p.id === prop)?.options?.find((o) => o.id === v)?.name ?? "";
  return rawRows(dbId)
    .filter((r) => r.cells[RULE.paused] !== true)
    .map((r): Rule | null => {
      const then = THEN[name(RULE.then, r.cells[RULE.then]).toLowerCase()];
      if (!then) return null;
      const prop = (id: string) => d.schema.properties.find((p) => p.id === id);
      const t = (id: string) => cellText(prop(id), r.cells[id]).trim();
      return { id: r.id, title: r.title, field: t(RULE.field), op: OPS[name(RULE.op, r.cells[RULE.op]).toLowerCase()] ?? "contains", value: t(RULE.value), then, target: t(RULE.target), set: t(RULE.set), prio: typeof r.cells[RULE.prio] === "number" ? (r.cells[RULE.prio] as number) : 1e9, why: t(RULE.why) };
    })
    .filter((x): x is Rule => !!x)
    .sort((a, b) => a.prio - b.prio || a.id - b.id);
}

/** Whether a rule's condition holds for a record: its field, else the record's whole text. */
export function matches(r: SourceRecord, rule: Rule): boolean {
  if (rule.field) return holds(r, { field: rule.field, op: rule.op, value: rule.value });
  if (rule.op === "empty" || rule.op === "not_empty") return holds({ ...r }, { field: "title", op: rule.op });
  const text = recordText(r).toLowerCase();
  const want = rule.value.toLowerCase();
  return rule.op === "contains" ? text.includes(want) : rule.op === "not_contains" ? !text.includes(want) : rule.op === "is" ? text === want : text !== want;
}

function jobsDb() {
  getSqlite().exec("create table if not exists ws_rule_jobs (rule_row integer not null, ref text not null, job_row integer not null, primary key (rule_row, ref))");
  return getSqlite();
}

/**
 * A rules step: the records through the rules of `rulesDb`, in order. A rule that drops a record ends its rules; one that sets
 * a field puts the value on it (a field by name); one that hands it to an agent makes a job in `jobsTo` — once per rule and
 * record, kept (a job you removed isn't made again).
 */
export function applyRules(records: SourceRecord[], rulesDb: number, jobsTo: number | undefined): SourceRecord[] {
  const rules = loadRules(rulesDb).filter((r) => r.then !== "hint");
  if (!rules.length) return records;
  const db = jobsDb();
  const out: SourceRecord[] = [];
  for (const rec of records) {
    let cur = rec;
    let dropped = false;
    for (const rule of rules) {
      if (!matches(cur, rule)) continue;
      if (rule.then === "exclude") {
        dropped = true;
        break;
      }
      if (rule.then === "set" && rule.target) cur = { ...cur, fields: { ...cur.fields, [rule.target]: rule.set } };
      if (rule.then === "job" && jobsTo && getPage(jobsTo)) {
        const known = db.prepare("select job_row from ws_rule_jobs where rule_row = ? and ref = ?").get(rule.id, cur.ref);
        if (!known) {
          const instruction = (rule.target || rule.title).replaceAll("{{title}}", cur.title).replaceAll("{{ref}}", cur.ref);
          const job = addJob(jobsTo, { title: instruction.split("\n")[0], instruction: `${instruction}\n\n${(cur.text ?? "").slice(0, 3000)}`.trim(), by: `Regel „${rule.title}“` });
          db.prepare("insert into ws_rule_jobs (rule_row, ref, job_row) values (?, ?, ?)").run(rule.id, cur.ref, job);
        }
      }
    }
    if (!dropped) out.push(cur);
  }
  return out;
}

/** The hints every agent gets (rules with "Hinweis für Agenten"): of the rules databases, those whose condition holds for the job's text. */
export function hintsFor(jobTitle: string, jobText: string): string[] {
  const rec: SourceRecord = { ref: "job", title: jobTitle, fields: {}, text: jobText };
  const hints: string[] = [];
  for (const d of rulesDatabases()) for (const rule of loadRules(d)) if (rule.then === "hint" && rule.target && (!rule.value && !rule.field ? true : matches(rec, rule))) hints.push(rule.why ? `${rule.target} (${rule.why})` : rule.target);
  return hints;
}

/** Every rules database. */
export function rulesDatabases(): number[] {
  const rows = getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null").all() as { id: number }[];
  return rows.filter((r) => getDatabase(r.id)?.schema.rules).map((r) => r.id);
}
