import type { Condition } from "./routines";
import { localDay } from "@/lib/dates";

/**
 * Conditions and templates of the routines' steps — on a record (the row in hand: its fields by name, lower case) as a filter's
 * rules read one, and `{{row.Field}}` placeholders in a step's texts. Pure.
 */

export type RecordOf = Record<string, string | number | boolean | null | undefined>;

const YES = new Set(["yes", "ja", "true", "1", "x"]);
const NO = new Set(["no", "nein", "false", "0"]);

function holds(rec: RecordOf, rule: Condition["rules"][number]): boolean {
  const v = rec[rule.field.trim().toLowerCase()];
  const empty = v === null || v === undefined || v === "" || v === false;
  if (rule.op === "empty") return empty;
  if (rule.op === "not_empty") return !empty;
  const want = (rule.value ?? "").trim().toLowerCase();
  if (typeof v === "boolean" || (v === undefined && (YES.has(want) || NO.has(want)))) {
    const is = v === true;
    const wanted = YES.has(want);
    return rule.op === "is" ? is === wanted : rule.op === "is_not" ? is !== wanted : rule.op === "contains" ? is === wanted : is !== wanted;
  }
  const text = String(v ?? "").toLowerCase();
  if (rule.op === "contains") return text.includes(want);
  if (rule.op === "not_contains") return !text.includes(want);
  if (rule.op === "is") return text === want;
  return text !== want;
}

/** Whether the record meets the condition (no rules: it does). */
export function conditionHolds(cond: Condition | undefined, rec: RecordOf): boolean {
  if (!cond || !cond.rules.length) return true;
  return cond.match === "any" ? cond.rules.some((r) => holds(rec, r)) : cond.rules.every((r) => holds(rec, r));
}

export type TemplateContext = { row?: RecordOf; trigger?: { kind: string }; payload?: Record<string, string>; now?: Date };

/** A text with its `{{…}}` placeholders filled in; what is unknown becomes empty. */
export function fillTemplate(text: string, ctx: TemplateContext): string {
  const now = ctx.now ?? new Date();
  return text.replace(/\{\{([^}]+)\}\}/g, (_m, raw: string) => {
    const key = raw.trim();
    const dot = key.indexOf(".");
    const head = (dot < 0 ? key : key.slice(0, dot)).toLowerCase();
    const rest = dot < 0 ? "" : key.slice(dot + 1).trim().toLowerCase();
    if (head === "today" && dot < 0) return localDay(now);
    if (head === "now" && dot < 0) return now.toISOString();
    if (head === "row") return String(ctx.row?.[rest] ?? "");
    if (head === "trigger") return rest === "kind" ? (ctx.trigger?.kind ?? "") : "";
    if (head === "payload") return String(Object.entries(ctx.payload ?? {}).find(([k]) => k.toLowerCase() === rest)?.[1] ?? "");
    return "";
  });
}
