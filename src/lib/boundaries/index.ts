import { AsyncLocalStorage } from "node:async_hooks";
import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { labelResolver, secretRowTexts } from "@/plugins/workspace/sensitivity";
import { allows, BOUNDARY_SOURCES, defaultSourceLabel, flowsOf, docSourceKey, isLabel, redact, refSourceKey, secretIndex, SPACE_SOURCES, type Clearance, type Exit, type Flow, type Label, type SecretIndex } from "./shared";

/**
 * The data boundaries at work (server only): the sources' labels as you set them, the clearance of whoever reads right
 * now (an agent's worker over the MCP: open data only, or personal too when its routine allows it), and the guard of the
 * AI exit — the text of secret sources and databases left out of every prompt sent to an AI. The labels of the Workspace's
 * databases are kept by the Workspace (plugins/workspace/sensitivity.ts).
 */

export * from "./shared";

const PREF = "boundaries.sources";

/** The labels you set, by source. */
const own = (): Record<string, Label> => Object.fromEntries(Object.entries(getPref<Record<string, unknown>>(PREF, {})).filter((e): e is [string, Label] => isLabel(e[1])));

/** A source's label: yours, else its default. */
export const sourceLabel = (key: string): Label => own()[key] ?? defaultSourceLabel(key);

/** A source's label set (null: back to its default). */
export function setSourceLabel(key: string, label: Label | null): void {
  const next = { ...own() };
  if (label && isLabel(label)) next[key] = label;
  else delete next[key];
  setPref(PREF, next);
}

/** Whether you set a source's label yourself. */
export const hasOwnSourceLabel = (key: string): boolean => key in own();

// ---------------------------------------------------------------------------
// Who reads: the clearance
// ---------------------------------------------------------------------------

const g = globalThis as { __zeffClearance?: AsyncLocalStorage<Clearance> };
const clearanceStore = (g.__zeffClearance ??= new AsyncLocalStorage<Clearance>());

/** `fn` run as a reader with this clearance (the MCP server sets it per request). */
export const withClearance = <T>(c: Clearance, fn: () => T): T => clearanceStore.run(c, fn);

/** The clearance of the code running: what the MCP server set, else personal (you, Zeff's own steps — secret stays closed). */
export const currentClearance = (): Clearance => clearanceStore.getStore() ?? "personal";

/** Whether the code running may read data with this label. */
export const mayRead = (label: Label): boolean => allows(currentClearance(), label);

/** What a refusal says (for an agent; English like the MCP's other answers). */
export const refusal = (label: Label, what = "That"): string =>
  label === "secret"
    ? `${what} is marked secret (Settings → Data boundaries) — it never leaves Zeff, not to agents, workers or any AI.`
    : `${what} is personal data (Settings → Data boundaries) — this agent's permissions don't allow personal data (the Permissions tab of its page: "May read personal data").`;

/** A label resolver for a batch of references: a page's by its databases, the rest by their source; null-source refs (the knowledge) are open. */
export function refLabels(): (ref: string) => Label {
  const pages = labelResolver();
  return (ref) => {
    const page = /^page:(\d+)$/.exec(ref);
    if (page) return pages.page(Number(page[1]));
    const src = refSourceKey(ref);
    return src ? sourceLabel(src) : "open";
  };
}

/** A labeller of the knowledge server's spaces: a source's space by its source, a collection's by its sensitivity, the rest (Confluence …) open. */
export async function spaceLabels(): Promise<(space: string) => Label> {
  const { listCollections } = await import("@/lib/items");
  const cols = new Map(listCollections().map((c) => [c.space ?? c.name, c.sensitivity ?? "open"] as const));
  return (space) => (SPACE_SOURCES[space] ? sourceLabel(SPACE_SOURCES[space]) : (cols.get(space) ?? "open"));
}

/** A knowledge page's label: its source's, else (a collection's item) what the caller knows of its collection. */
export const docLabel = (id: string): Label | null => {
  const src = docSourceKey(id);
  return src ? sourceLabel(src) : null;
};

// ---------------------------------------------------------------------------
// The AI exit: secret text left out of prompts
// ---------------------------------------------------------------------------

/** The texts of a secret source, from Zeff's tables (the newest first; a source without a table here: none). */
const SOURCE_TEXTS: Record<string, string> = {
  mail: "select coalesce(subject, '') || char(10) || coalesce(preview, '') as t from emails where key not like 'wa:%' and key not like 'sg:%' and key not like 'gmail%' order by received_at desc limit 20000",
  gmail: "select coalesce(subject, '') || char(10) || coalesce(preview, '') as t from emails where key like 'gmail%' order by received_at desc limit 20000",
  whatsapp: "select coalesce(preview, '') as t from emails where key like 'wa:%' order by received_at desc limit 20000",
  signal: "select coalesce(preview, '') as t from emails where key like 'sg:%' order by received_at desc limit 20000",
  teams: "select coalesce(text, '') as t from teams_messages order by sent_at desc limit 20000",
  jira: "select summary || char(10) || coalesce(description, '') as t from jira_tickets union all select body from jira_comments",
  gitlab: "select coalesce(title, '') || char(10) || coalesce(body, '') as t from gitlab_items",
  notes: "select coalesce(body, '') as t from contexts",
  facts: "select text as t from facts",
  todos: "select text || char(10) || coalesce(note, '') as t from todos",
  reports: "select body as t from work_reports",
};

const cache = globalThis as { __zeffSecretIndex?: { key: string; at: number; idx: SecretIndex } };
const TTL_MS = 30000;

/** Every secret text as an index for `redact` — remembered a while (and made again when a label changes). */
function secretTexts(): SecretIndex {
  const secretSources = Object.entries(own()).flatMap(([k, l]) => (l === "secret" ? [k] : []));
  const rows = secretRowTexts();
  const key = JSON.stringify([secretSources, rows.length, rows[0] ?? ""]);
  const hit = cache.__zeffSecretIndex;
  if (hit && hit.key === key && Date.now() - hit.at < TTL_MS) return hit.idx;
  const texts = [...rows];
  for (const s of secretSources) {
    const sql = SOURCE_TEXTS[s];
    if (!sql) continue;
    try {
      texts.push(...(getSqlite().prepare(sql).all() as { t: string | null }[]).map((r) => r.t ?? ""));
    } catch {
      // (a table not made yet)
    }
  }
  const idx = secretIndex(texts);
  cache.__zeffSecretIndex = { key, at: Date.now(), idx };
  return idx;
}

/** A prompt as it may go to an AI: every line of a secret source or database left out. Nothing secret: unchanged (and cheap). */
export function guardPrompt(text: string): string {
  return redact(text, secretTexts());
}

// ---------------------------------------------------------------------------
// The matrix: what flows where today (Settings → Data boundaries)
// ---------------------------------------------------------------------------

export type BoundaryRow = { kind: "source" | "database"; key: string; name: string; label: Label; own: boolean; flows: Record<Exit, Flow>; href?: string };

/**
 * Every source of an installed plugin (those without a plugin always) and every Workspace database, with its label (yours
 * or its default) and what flows into each exit today — a database's briefing switch counts (the knowledge server picks
 * for itself what it reads of what is offered).
 */
export async function boundaryMatrix(): Promise<BoundaryRow[]> {
  const { isInstalled } = await import("@/plugins/state");
  const sources: BoundaryRow[] = BOUNDARY_SOURCES.filter((s) => !s.plugin || isInstalled(s.plugin)).map((s) => {
    const label = sourceLabel(s.key);
    return { kind: "source", key: s.key, name: s.name, label, own: hasOwnSourceLabel(s.key), flows: flowsOf(label) };
  });
  if (!isInstalled("workspace")) return sources;
  const { listCollections } = await import("@/lib/items");
  const { getPref: pref } = await import("@/lib/prefs");
  const switches = pref<{ briefing?: number[] }>("workspace.collections", {});
  const { hasOwnLabel } = await import("@/plugins/workspace/sensitivity");
  const dbs: BoundaryRow[] = listCollections({ plugin: "workspace" }).map((c) => {
    const id = Number(c.id.slice("workspace:".length));
    const label = c.sensitivity ?? "open";
    return { kind: "database", key: String(id), name: c.name, label, own: hasOwnLabel(id), flows: flowsOf(label, { briefing: (switches.briefing ?? []).includes(id) }), href: c.href };
  });
  return [...sources, ...dbs];
}
