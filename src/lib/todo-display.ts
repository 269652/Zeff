/** What a todo shows under its text — which toggles, and which kinds of knowledge — as settings. Shared by server and client. */

export const AREAS = ["context", "actions", "knowledge"] as const;
export type Area = (typeof AREAS)[number];

/**
 * The kinds of page the knowledge base holds. Confluence, Keep and the facts are knowledge; the rest is Zeff's own
 * data (the todos, mails, tickets … — a todo shows those as its context already), so it is off until switched on.
 */
export const KNOWLEDGE_KINDS = ["confluence", "keep", "fact", "doc", "todo", "jira", "mail", "gitlab", "work"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
const KINDS_ON: KnowledgeKind[] = ["confluence", "keep", "fact"];

/** The kind of a knowledge page: from its id (Zeff's own sources are "zeff:<kind>:…"), else Keep, else Confluence. */
export function kindOfPage(p: { id: string; space?: string }): KnowledgeKind {
  const m = /^zeff:([a-z-]+):/.exec(p.id);
  if (m) {
    const k = m[1];
    if (k === "fact" || k === "context") return "fact";
    if (k === "doc") return "doc";
    if (k === "todo" || k === "open") return "todo";
    if (k === "jira") return "jira";
    if (k === "mail" || k === "teams") return "mail";
    if (k === "gitlab") return "gitlab";
    return "work"; // time, work, recap, week …
  }
  if (p.id.startsWith("keep:") || /^(Keep · |Google Keep$)/.test(p.space ?? "")) return "keep";
  return "confluence";
}

/** What is switched off, as ids: "area:context", "kind:mail", "entities", "links". */
export const DEFAULT_OFF: string[] = KNOWLEDGE_KINDS.filter((k) => !KINDS_ON.includes(k)).map((k) => `kind:${k}`);

export const areaOn = (off: readonly string[], a: Area) => !off.includes(`area:${a}`);
export const kindOn = (off: readonly string[], k: KnowledgeKind) => !off.includes(`kind:${k}`);
