import type { EntryType } from "@/db/schema";

/**
 * Report-rewriting rules — a server-free module so the client settings form and
 * the server report builder share one implementation (see the schedule/tags-shared
 * rule: never import a DB-backed lib into a "use client" component).
 *
 * A rule is a condition on an entry and an output template. The rules are tried
 * top-down; the FIRST match renders the entry's report line, and entries that
 * render to the same label on the same day are merged (their hours summed).
 */
export type RuleField = "type" | "tag" | "ticket" | "always";

export type ReportRule = {
  id: string;
  field: RuleField;
  /** type: ticket|meeting|other · tag: tag name · ticket: key prefix · always: ignored. */
  value: string;
  /** Output template, e.g. "Meetings" or "{ticket}: {desc}". */
  template: string;
};

/** The minimal entry shape the rules need (kept structural so both sides can pass it). */
export type RuleEntry = {
  type: EntryType;
  ticket: string | null;
  description: string;
  tags: { name: string }[];
};

export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  type: "Type is",
  tag: "Has tag",
  ticket: "Ticket starts with",
  always: "Any other entry",
};

export const ENTRY_TYPE_OPTIONS: { value: EntryType; label: string }[] = [
  { value: "ticket", label: "Ticket" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

const TYPE_LABEL: Record<EntryType, string> = { ticket: "Ticket", meeting: "Meeting", other: "Other" };

export function newRuleId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** The out-of-the-box rules (also the fallback): meetings collapse, tickets as "key: desc". */
export function defaultRules(): ReportRule[] {
  return [
    { id: "meetings", field: "type", value: "meeting", template: "Meetings" },
    { id: "tickets", field: "type", value: "ticket", template: "{ticket}: {desc}" },
    { id: "rest", field: "always", value: "", template: "{desc}" },
  ];
}

export function matchRule(rule: ReportRule, e: RuleEntry): boolean {
  switch (rule.field) {
    case "type":
      return e.type === rule.value;
    case "tag": {
      const v = rule.value.trim().replace(/^#/, "").toLowerCase();
      return v ? e.tags.some((t) => t.name.toLowerCase() === v) : e.tags.length > 0;
    }
    case "ticket": {
      if (!e.ticket) return false;
      const v = rule.value.trim().toLowerCase();
      return v ? e.ticket.toLowerCase().startsWith(v) : true;
    }
    case "always":
      return true;
    default:
      return false;
  }
}

/**
 * Substitute {ticket} {desc} {description} {type} {tags}. When {ticket} or {tags}
 * is empty, its trailing/leading separator (e.g. the ": " in "{ticket}: {desc}")
 * is dropped so nothing dangles, then leftover leading separators and double
 * spaces are tidied.
 */
export function renderTemplate(tpl: string, e: RuleEntry): string {
  const tags = e.tags.map((t) => `#${t.name}`).join(" ");
  let s = tpl;
  if (e.ticket) s = s.replaceAll("{ticket}", e.ticket);
  else s = s.replace(/\{ticket\}\s*[:–\-|]?[ \t]*/g, "");
  s = s.replaceAll("{description}", e.description).replaceAll("{desc}", e.description).replaceAll("{type}", TYPE_LABEL[e.type]);
  if (tags) s = s.replaceAll("{tags}", tags);
  else s = s.replace(/\s*\{tags\}/g, "");
  s = s
    .replace(/^[\s:–\-|,]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s || e.description || e.ticket || "(untitled)";
}

/** The first matching rule, or a synthetic description-only fallback. */
export function matchedRule(rules: ReportRule[], e: RuleEntry): ReportRule {
  for (const r of rules) if (matchRule(r, e)) return r;
  return { id: "fallback", field: "always", value: "", template: "{desc}" };
}

export function renderEntryLabel(rules: ReportRule[], e: RuleEntry): string {
  return renderTemplate(matchedRule(rules, e).template, e);
}

function isRuleField(v: unknown): v is RuleField {
  return v === "type" || v === "tag" || v === "ticket" || v === "always";
}

/** Parse rules from stored JSON, dropping anything malformed. Returns [] when absent/empty. */
export function parseRules(json: string | null | undefined): ReportRule[] {
  if (!json) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: ReportRule[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    if (!isRuleField(o.field)) continue;
    const template = typeof o.template === "string" ? o.template : "";
    if (!template.trim()) continue;
    out.push({
      id: typeof o.id === "string" && o.id ? o.id : newRuleId(),
      field: o.field,
      value: typeof o.value === "string" ? o.value : "",
      template,
    });
  }
  return out;
}

/** Validate a rule list for saving; returns an error message or null. */
export function validateRules(rules: ReportRule[]): string | null {
  if (rules.length === 0) return "Add at least one rule.";
  for (const r of rules) {
    if (!isRuleField(r.field)) return "Each rule needs a valid condition.";
    if (!r.template.trim()) return "Every rule needs an output template.";
    if (r.field === "type" && !["ticket", "meeting", "other"].includes(r.value)) {
      return "Pick a type (Ticket / Meeting / Other) for a Type rule.";
    }
    if (r.field === "tag" && !r.value.trim()) return "Give the tag name for a Has-tag rule.";
  }
  return null;
}
