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
export type RuleField = "type" | "tag" | "ticket" | "job";

/** One condition on an entry. type: ticket|meeting|other · tag: tag name · ticket: key prefix · job: job number. */
export type RuleCondition = { field: RuleField; value: string };

export type ReportRule = {
  id: string;
  /** ALL conditions must match (AND). An empty list matches every entry (a catch-all). */
  conditions: RuleCondition[];
  /** Output template, e.g. "Meetings" or "{ticket}: {desc}". */
  template: string;
};

/** The minimal entry shape the rules need (kept structural so both sides can pass it). */
export type RuleEntry = {
  type: EntryType;
  ticket: string | null;
  /** The ticket's Jira title, for {ticket-name} (empty when unknown). */
  ticketName: string;
  description: string;
  tags: { name: string }[];
  jobNumber: string;
  jobName: string;
};

export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  type: "Type is",
  tag: "Has tag",
  ticket: "Ticket starts with",
  job: "Job is",
};

export const RULE_FIELDS: RuleField[] = ["type", "tag", "ticket", "job"];

export const ENTRY_TYPE_OPTIONS: { value: EntryType; label: string }[] = [
  { value: "ticket", label: "Ticket" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

const TYPE_LABEL: Record<EntryType, string> = { ticket: "Ticket", meeting: "Meeting", other: "Other" };

export function newRuleId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function newCondition(): RuleCondition {
  return { field: "type", value: "meeting" };
}

/** The out-of-the-box rules (also the fallback): meetings collapse, tickets as "key: desc". */
export function defaultRules(): ReportRule[] {
  return [
    { id: "meetings", conditions: [{ field: "type", value: "meeting" }], template: "Meetings" },
    { id: "tickets", conditions: [{ field: "type", value: "ticket" }], template: "{ticket}: {desc}" },
    { id: "rest", conditions: [], template: "{desc}" },
  ];
}

/** Whether one condition matches an entry. */
export function matchCondition(c: RuleCondition, e: RuleEntry): boolean {
  switch (c.field) {
    case "type":
      return e.type === c.value;
    case "tag": {
      const v = c.value.trim().replace(/^#/, "").toLowerCase();
      return v ? e.tags.some((t) => t.name.toLowerCase() === v) : e.tags.length > 0;
    }
    case "ticket": {
      if (!e.ticket) return false;
      const v = c.value.trim().toLowerCase();
      return v ? e.ticket.toLowerCase().startsWith(v) : true;
    }
    case "job": {
      const v = c.value.trim();
      return v ? e.jobNumber === v : true;
    }
    default:
      return false;
  }
}

/** A rule matches when ALL its conditions match (an empty list is a catch-all). */
export function matchRule(rule: ReportRule, e: RuleEntry): boolean {
  return rule.conditions.every((c) => matchCondition(c, e));
}

/**
 * Substitute {ticket} {desc} {description} {type} {tags}. When {ticket} or {tags}
 * is empty, its trailing/leading separator (e.g. the ": " in "{ticket}: {desc}")
 * is dropped so nothing dangles, then leftover leading separators and double
 * spaces are tidied. May return "" (no fallback) — for renderTemplate's use.
 */
function substitute(tpl: string, e: RuleEntry): string {
  const tags = e.tags.map((t) => `#${t.name}`).join(" ");
  let s = tpl;
  // Ticket number: {ticket-nr} (and {ticket} as an alias). Ticket title: {ticket-name}.
  // When a token is empty, drop it AND an adjacent separator on either side (e.g. the
  // " — " in "{ticket-nr} — {ticket-name}") so nothing dangles.
  if (e.ticket) s = s.replaceAll("{ticket-nr}", e.ticket).replaceAll("{ticket}", e.ticket);
  else s = s.replace(/\s*[:—–\-|·]?\s*\{ticket-nr\}\s*[:—–\-|·]?[ \t]*/g, " ").replace(/\s*[:—–\-|·]?\s*\{ticket\}\s*[:—–\-|·]?[ \t]*/g, " ");
  if (e.ticketName) s = s.replaceAll("{ticket-name}", e.ticketName);
  else s = s.replace(/\s*[:—–\-|·]?\s*\{ticket-name\}\s*[:—–\-|·]?[ \t]*/g, " ");
  s = s.replaceAll("{description}", e.description).replaceAll("{desc}", e.description).replaceAll("{type}", TYPE_LABEL[e.type]);
  s = s.replaceAll("{jobName}", e.jobName).replaceAll("{job}", e.jobNumber);
  if (tags) s = s.replaceAll("{tags}", tags);
  else s = s.replace(/\s*[:—–\-|·]?\s*\{tags\}\s*[:—–\-|·]?[ \t]*/g, " ");
  return s
    .replace(/^[\s:—–\-|·,]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Render a rule template for one entry (with a sensible fallback when it comes out empty). */
export function renderTemplate(tpl: string, e: RuleEntry): string {
  return substitute(tpl, e) || e.description || e.ticket || "(untitled)";
}

/** The first matching rule, or a synthetic description-only fallback. */
export function matchedRule(rules: ReportRule[], e: RuleEntry): ReportRule {
  for (const r of rules) if (matchRule(r, e)) return r;
  return { id: "fallback", conditions: [], template: "{desc}" };
}

const hasDescPlaceholder = (tpl: string) => /\{desc(ription)?\}/.test(tpl);

/**
 * The key entries are grouped by within a day: the rule's template with the
 * description removed, so entries that differ ONLY by description (e.g. two
 * bookings on the same ticket) group together. A description-only template
 * (nothing left once {desc} is gone) groups per entry so those lines stay
 * separate.
 */
export function reportGroupKey(rule: ReportRule, e: RuleEntry, entryId: number): string {
  const stripped = rule.template.replaceAll("{description}", "").replaceAll("{desc}", "");
  const base = substitute(stripped, e);
  return base ? `g:${rule.id}:${base}` : `e:${entryId}`;
}

/**
 * The label for a group: the rendered template for a single entry, or — when
 * several entries merge and the template shows a description — "Contains N items"
 * in place of the description (never a concatenation of the individual ones).
 */
export function reportGroupLabel(rule: ReportRule, first: RuleEntry, count: number): string {
  if (count <= 1 || !hasDescPlaceholder(rule.template)) return renderTemplate(rule.template, first);
  return renderTemplate(rule.template, { ...first, description: `Contains ${count} items` });
}

function isRuleField(v: unknown): v is RuleField {
  return v === "type" || v === "tag" || v === "ticket" || v === "job";
}

function parseConditions(raw: unknown): RuleCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: RuleCondition[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (!isRuleField(o.field)) continue;
    out.push({ field: o.field, value: typeof o.value === "string" ? o.value : "" });
  }
  return out;
}

/**
 * Parse rules from stored JSON, dropping anything malformed and migrating the
 * legacy single-condition shape ({field, value}; "always" = catch-all) to the
 * multi-condition shape ({conditions: [...]}). Returns [] when absent/empty.
 */
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
    const template = typeof o.template === "string" ? o.template : "";
    if (!template.trim()) continue;
    let conditions: RuleCondition[];
    if (Array.isArray(o.conditions)) {
      conditions = parseConditions(o.conditions);
    } else if (typeof o.field === "string") {
      // Legacy single-condition rule; "always" becomes a catch-all (no conditions).
      conditions = isRuleField(o.field) ? [{ field: o.field, value: typeof o.value === "string" ? o.value : "" }] : [];
    } else {
      conditions = [];
    }
    out.push({ id: typeof o.id === "string" && o.id ? o.id : newRuleId(), conditions, template });
  }
  return out;
}

/** Validate a rule list for saving; returns an error message or null. */
export function validateRules(rules: ReportRule[]): string | null {
  if (rules.length === 0) return "Add at least one rule.";
  for (const r of rules) {
    if (!r.template.trim()) return "Every rule needs an output template.";
    for (const c of r.conditions) {
      if (!isRuleField(c.field)) return "Each condition needs a valid field.";
      if (c.field === "type" && !["ticket", "meeting", "other"].includes(c.value)) {
        return "Pick a type (Ticket / Meeting / Other) for a Type condition.";
      }
      if (c.field === "tag" && !c.value.trim()) return "Give the tag name for a Has-tag condition.";
      if (c.field === "job" && !c.value.trim()) return "Pick a job for a Job condition.";
    }
  }
  return null;
}
