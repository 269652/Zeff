/**
 * Data boundaries — what may flow where. Every source Zeff reads (Jira, Teams, mail, WhatsApp, the bank …) and every
 * Workspace database carries a label: `open` (work data: anything may read it), `personal` (private life: the knowledge,
 * the briefing and the AI steps may read it, agents only when their permissions allow personal data) or `secret` (it
 * never leaves its place: no knowledge, no briefing, no agent, no external AI). The exits are where data leaves its place.
 * Pure and client-safe: the store (index.ts), the MCP server, the export and the settings page all read it.
 */

export const LABELS = ["open", "personal", "secret"] as const;
export type Label = (typeof LABELS)[number];
export const isLabel = (v: unknown): v is Label => (LABELS as readonly unknown[]).includes(v);

/** The stricter of labels. */
export const maxLabel = (...labels: Label[]): Label => labels.reduce<Label>((a, b) => (LABELS.indexOf(b) > LABELS.indexOf(a) ? b : a), "open");

/** What a reader may see: open data only, or personal data too. Secret is never readable from outside its place. */
export type Clearance = "open" | "personal";

export const allows = (clearance: Clearance, label: Label): boolean => label === "open" || (label === "personal" && clearance === "personal");

/** A source as the boundaries know it: its key, its name, its label when you have set none, the plugin that brings it. */
export type BoundarySource = { key: string; name: string; default: Label; plugin?: string };

export const BOUNDARY_SOURCES: BoundarySource[] = [
  { key: "jira", name: "Jira", default: "open", plugin: "jira" },
  { key: "teams", name: "Teams", default: "open", plugin: "teams" },
  { key: "mail", name: "Work mail (Outlook)", default: "open", plugin: "outlook-mail" },
  { key: "gmail", name: "Gmail", default: "open", plugin: "gmail" },
  { key: "gitlab", name: "GitLab", default: "open", plugin: "gitlab" },
  { key: "todos", name: "Todos", default: "open", plugin: "todos" },
  { key: "reports", name: "Worker reports", default: "open", plugin: "work" },
  { key: "time", name: "Time tracking", default: "open", plugin: "zeiterfassung" },
  { key: "recaps", name: "Day recaps", default: "open" },
  { key: "notes", name: "Notes and context", default: "open" },
  { key: "facts", name: "Facts", default: "open" },
  { key: "documents", name: "Documents", default: "open", plugin: "documents" },
  { key: "people", name: "People", default: "open", plugin: "people" },
  { key: "keep", name: "Google Keep", default: "open", plugin: "keep" },
  { key: "kanban", name: "Kanban", default: "open", plugin: "kanban" },
  { key: "whatsapp", name: "WhatsApp", default: "personal", plugin: "whatsapp" },
  { key: "signal", name: "Signal", default: "personal", plugin: "signal" },
  { key: "bank", name: "Bank statements", default: "personal", plugin: "finances" },
];

const DEFAULTS = new Map(BOUNDARY_SOURCES.map((s) => [s.key, s.default]));
/** A source's label when you have set none (an unknown source: open). */
export const defaultSourceLabel = (key: string): Label => DEFAULTS.get(key) ?? "open";

/** A mail's source by its key: WhatsApp's and Signal's chats and Gmail's mails share the mail table with Outlook's. */
const mailSource = (key: string): string => (key.startsWith("wa:") ? "whatsapp" : key.startsWith("sg:") ? "signal" : key.startsWith("gmail") ? "gmail" : "mail");

const DOC_PREFIX: [string, string][] = [
  ["zeff:jira:", "jira"],
  ["zeff:teams:", "teams"],
  ["zeff:gitlab:", "gitlab"],
  ["zeff:todo:", "todos"],
  ["zeff:branchctx:", "todos"],
  ["zeff:report:", "reports"],
  ["zeff:week:", "time"],
  ["zeff:recap:", "recaps"],
  ["zeff:context:", "notes"],
  ["zeff:fact:", "facts"],
  ["zeff:doc:", "documents"],
  ["zeff:bank:", "bank"],
];

/** The source of a page of the knowledge export (its id); null: none of the sources' (a collection's item — its collection's label). */
export function docSourceKey(id: string): string | null {
  if (id.startsWith("zeff:mail:")) return mailSource(id.slice("zeff:mail:".length));
  return DOC_PREFIX.find(([p]) => id.startsWith(p))?.[1] ?? null;
}

/** The source of a retrieval's reference ([mail:…], [teams:…], RG-1, T-12 …); null: none (a page — its database's label; the knowledge). */
export function refSourceKey(ref: string): string | null {
  const i = ref.indexOf(":");
  const head = i > 0 ? ref.slice(0, i) : "";
  const rest = i > 0 ? ref.slice(i + 1) : ref;
  if (head === "mail") return mailSource(rest);
  const byHead: Record<string, string> = { teams: "teams", gitlab: "gitlab", "jira-comment": "jira", context: "notes", fact: "facts", doc: "documents", person: "people" };
  if (byHead[head]) return byHead[head];
  if (/^T-\d+$/.test(ref)) return "todos";
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(ref)) return "jira";
  return null;
}

/** The knowledge export's spaces of the sources (plugins/knowledge/export.ts) — a search hit of the knowledge server names its space. */
export const SPACE_SOURCES: Record<string, string> = {
  "Zeff · Jira": "jira",
  "Zeff · Teams": "teams",
  "Zeff · Mail": "mail",
  "Zeff · WhatsApp": "whatsapp",
  "Zeff · Signal": "signal",
  "Zeff · GitLab": "gitlab",
  "Zeff · Todos": "todos",
  "Zeff · Branch-Kontext": "todos",
  "Zeff · Berichte": "reports",
  "Zeff · Zeiterfassung": "time",
  "Zeff · Tagesrückblick": "recaps",
  "Zeff · Notizen": "notes",
  "Zeff · Fakten": "facts",
  "Zeff · Documents": "documents",
  "Zeff · Konto": "bank",
};

/** The MCP tools that read one source only: they follow its label. */
export const TOOL_SOURCES: Record<string, string> = {
  gmail_find: "gmail",
  gmail_labels: "gmail",
  gmail_filters: "gmail",
  list_time_entries: "time",
  get_weekly_report: "time",
  mr_comments: "gitlab",
  list_todos: "todos",
  todo_context: "todos",
  todo_attachment: "todos",
};

/** Where data leaves its place: the knowledge server, the briefing (the Lage), agents and workers, AI steps sent out, the web. */
export const EXITS = ["knowledge", "briefing", "agents", "ai", "web"] as const;
export type Exit = (typeof EXITS)[number];

/** What flows into an exit: yes; no (the label stops it); off (a switch of its own is off); only with an agent's permission. */
export type Flow = "yes" | "no" | "off" | "permission";

/**
 * What flows into `exit` from data with this label. `knowledge`/`briefing`: a database's own switches (false: off); a
 * source has none. Secret flows nowhere; personal reaches agents (and the web through their searches) only with permission.
 */
export function flowOf(label: Label, exit: Exit, switches: { knowledge?: boolean; briefing?: boolean } = {}): Flow {
  if (label === "secret") return "no";
  if (exit === "knowledge" && switches.knowledge === false) return "off";
  if (exit === "briefing" && switches.briefing === false) return "off";
  if ((exit === "agents" || exit === "web") && label === "personal") return "permission";
  return "yes";
}

/** What flows into every exit, for a row of the settings' matrix. */
export const flowsOf = (label: Label, switches: { knowledge?: boolean; briefing?: boolean } = {}): Record<Exit, Flow> =>
  Object.fromEntries(EXITS.map((e) => [e, flowOf(label, e, switches)])) as Record<Exit, Flow>;

/** The names that make a database personal when it has no label of its own — its own, or a parent page's. */
const PERSONAL_NAMES = /journal|tagebuch|diary|gesundheit|health|arzt|medizin|medical|stimmung|mood|finanz|financ|\bbank|\bkonto|schulden|debts?\b|vorgäng|whatsapp|signal|privat|private/i;
/** The sources that make a database personal (one a sync keeps). */
const PERSONAL_SOURCES = new Set(["whatsapp", "signal", "revolut", "finances", "bank"]);

/** A database's label when you have set none: personal when it (or a page above it) is named like a journal, health, money or a private chat — else open. */
export function defaultDatabaseLabel(names: string[], source: string | null): Label {
  if (source && PERSONAL_SOURCES.has(source)) return "personal";
  return names.some((n) => PERSONAL_NAMES.test(n)) ? "personal" : "open";
}

// ---------------------------------------------------------------------------
// Leaving secret text out
// ---------------------------------------------------------------------------

/** What stands where secret text was left out (the prompts are German). */
export const REDACTED = "[ausgelassen: geheim]";
/** Shorter lines can't be told apart from ordinary words: they are kept. */
const MIN = 12;
/** A line cut short in a prompt is left out when at least this much of it matches. */
const CLIPPED = 40;

const lines = (texts: string[]): string[] => [...new Set(texts.flatMap((t) => t.split(/\r?\n/)).map((l) => l.replace(/[ \t]+/g, " ").replace(/^[-*#>\s]+/, "").trim()).filter((l) => l.length >= MIN))];

/** The secret texts prepared for `redact`: their lines, by their first characters. */
export type SecretIndex = Map<string, string[]>;
export function secretIndex(texts: string[]): SecretIndex {
  const idx: SecretIndex = new Map();
  for (const l of lines(texts)) {
    const k = l.slice(0, MIN);
    idx.set(k, [...(idx.get(k) ?? []), l]);
  }
  return idx;
}

/**
 * The text with every line of the secret texts left out — whole, or cut short (a prompt clips long texts: at least 40
 * characters of the line match). Lines shorter than 12 characters are kept. One pass over the text.
 */
export function redact(text: string, secrets: string[] | SecretIndex): string {
  const idx = Array.isArray(secrets) ? secretIndex(secrets) : secrets;
  if (!idx.size) return text;
  let out = "";
  let from = 0;
  for (let i = 0; i <= text.length - MIN; ) {
    const cands = idx.get(text.slice(i, i + MIN));
    let best = 0;
    for (const s of cands ?? []) {
      let n = MIN;
      while (n < s.length && text[i + n] === s[n]) n++;
      if ((n === s.length || n >= CLIPPED) && n > best) best = n;
    }
    if (best) {
      out += `${text.slice(from, i)}${REDACTED}`;
      i += best;
      from = i;
    } else i++;
  }
  return out + text.slice(from);
}
