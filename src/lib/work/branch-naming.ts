/**
 * Naming branches, in one place. What a worker (or an agent) is told when it names a branch — the rule, how
 * short, and the context that goes with it: the conventions colleagues gave (branch-rules.ts), the knowledge kept
 * about the ticket (branch-knowledge.ts), the Jira ticket and its comments, the todo, the branches already there —
 * is set under Auswerten → "Branch names" (which sources, how short, your own words). The brief, the MCP's
 * start_todo and the name Zeff gives a worker's branch all come from here; the same `namingContext` is what the
 * settings page shows as the preview. Server only.
 */
import { getSqlite } from "@/db";
import type { TodoView } from "@/lib/boards/shared";
import { getContextPrefs } from "@/lib/boards/context-prefs";
import { getJiraTicket } from "@/lib/jira/store";
import { isInstalled } from "@/plugins/state";
import { branchKnowledgeFor, ensureBranchKnowledge, snapshotTodo, suggestSlug, BRANCH_TAG, type BranchArtifact } from "./branch-knowledge";
import { linkedBranchesOf } from "./branch-context";
import { rulesFor } from "./branch-rules";

export type NamingSettings = { maxChars: number; words: number; comments: number; artifacts: number; sources: Record<string, boolean>; extra: string };

/** The settings (Auswerten → Branch names), the defaults where nothing is set. */
export function namingSettings(): NamingSettings {
  const p = getContextPrefs().branchname;
  return { maxChars: p.numbers.maxChars, words: p.numbers.words, comments: p.numbers.comments, artifacts: p.numbers.artifacts, sources: p.sources, extra: p.extra.trim() };
}

/** How the words after the ticket key are to be: in German (for the worker's brief) and English (for agents over the MCP). */
export function namingLimits(s = namingSettings()): { de: string; en: string } {
  const de = s.words <= 1 ? "1 kleingeschriebenes Wort" : s.words === 2 ? "2 kleingeschriebene Wörter" : `2–${s.words} kleingeschriebene Wörter`;
  const en = s.words <= 1 ? "1 lowercase word" : s.words === 2 ? "2 lowercase words" : `2–${s.words} lowercase words`;
  return { de: `${de}, höchstens ${s.maxChars} Zeichen`, en: `${en}, max ${s.maxChars} characters` };
}

/** The rule in a line: what the name consists of and what the short name says. */
export function namingRuleLine(s = namingSettings()): string {
  return `feature/ bzw. fix/, dann der Ticket-Key, dann <short-change> = ${namingLimits(s).de} für die Codeänderung, die du machst — nicht der Titel von Ticket oder Todo, nicht der Kundenname`;
}

/** One kind of context: what it is, whether the settings let it in, and its lines. */
export type ContextItem = { key: string; label: string; included: boolean; lines: string[] };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, " ").trim();

/**
 * Everything that could go into the naming of a todo's branch, by source, each marked as in or out by the
 * settings — what the worker gets (the included ones' lines) and what the settings page shows.
 */
export function namingContext(todo: Pick<TodoView, "id" | "ticket" | "kind" | "text" | "note" | "ref" | "refs" | "mailRefs" | "byWorker">, s = namingSettings()): ContextItem[] {
  try {
    ensureBranchKnowledge();
    snapshotTodo(todo as TodoView);
  } catch {
    // from what is kept
  }
  const on = (k: string) => s.sources[k] !== false;
  const items: ContextItem[] = [];

  items.push({
    key: "rules",
    label: "Rules",
    included: on("rules"),
    lines: rulesFor(todo.ticket).map((r) => `${r.text}${r.sources.length ? ` — ${r.sources.map((x) => `${x.label}: „${clip(x.text, 260)}“`).join("; ")}` : ""}`),
  });

  const kept = branchKnowledgeFor({ ticket: todo.ticket, todoIds: [todo.id], limit: s.artifacts });
  items.push({
    key: "knowledge",
    label: "Kept knowledge of the ticket",
    included: on("knowledge"),
    lines: kept.map((a) => `${a.title}${a.slug ? ` — Kurzname-Vorschlag: \`${a.slug}\`` : ""}${a.sources.map((x) => `\n  - ${x.label}: „${clip(x.text, 300)}“`).join("")}`),
  });

  if (todo.ticket) {
    const jira = isInstalled("jira") ? getJiraTicket(todo.ticket) : undefined;
    items.push({ key: "ticket", label: "The Jira ticket", included: on("ticket"), lines: jira ? [`${jira.key}: ${jira.summary}${jira.status ? ` (${jira.status})` : ""} — der Titel ist nicht zwingend die Codeänderung`] : [] });
    let comments: { author: string; at: string; body: string }[] = [];
    try {
      comments = getSqlite().prepare("select author, at, body from jira_comments where upper(ticket) = ? order by at desc limit ?").all(todo.ticket.toUpperCase(), s.comments) as typeof comments;
    } catch {
      // no comments synced
    }
    items.push({ key: "comments", label: "Jira comments", included: on("comments"), lines: comments.map((c) => `${c.author}, ${c.at.slice(0, 10)}: „${clip(c.body, 300)}“`) });
  }

  items.push({ key: "todo", label: "The todo", included: on("todo"), lines: [`${todo.ref}: ${clip(todo.text, 200)}${todo.note ? ` — ${clip(todo.note, 200)}` : ""}`] });

  let linked: string[] = [];
  try {
    linked = linkedBranchesOf(todo as TodoView).map((b) => `${b.branch} (${b.label})`);
  } catch {
    // none known
  }
  items.push({ key: "branches", label: "Branches already there", included: on("branches"), lines: linked });
  return items;
}

/**
 * The block a worker (or an agent) gets when it names a branch: the rule with its limits, your own words,
 * and the included context. Empty when there is nothing but the rule to say and no ticket.
 */
export function namingBlock(todo: Parameters<typeof namingContext>[0]): string {
  const s = namingSettings();
  const items = namingContext(todo, s).filter((i) => i.included && i.lines.length);
  const rule = `Der Branch-Name: ${namingRuleLine(s)}. So sieht man schon in der Commit-History, was der eigentliche Change war.`;
  const head = `\n\n## Branch-Benennung (Tag ${BRANCH_TAG}${todo.ticket ? `, ${todo.ticket}` : ""})\n${rule}${s.extra ? `\n${s.extra}` : ""}`;
  if (!items.length) return todo.ticket ? head : "";
  const labels: Record<string, string> = { rules: "Regeln (von Kollegen)", knowledge: "Festgehaltenes zum Ticket — auch von erledigten Todos und Nachrichten, die nicht mehr im Kontext stehen", ticket: "Jira-Ticket", comments: "Jira-Kommentare", todo: "Das Todo", branches: "Schon vorhandene Branches" };
  return `${head}\n${items.map((i) => `\n### ${labels[i.key] ?? i.label}\n${i.lines.map((l) => (i.lines.length > 1 || i.key !== "todo" ? `- ${l}` : l)).join("\n")}`).join("\n")}`;
}

/**
 * The name for the branch a worker starts on — feature/PROJ-306-footer-link (fix/ for a fix): the ticket key and the
 * short name from the kept knowledge, as long as the settings say. The todo the words name ("T-165") counts most, then
 * the todos with a Jira comment or a message behind them; a session's placeholder says little. Null: nothing to say
 * short (the worker's own zeff/… name stays).
 */
export function proposeBranchName(todo: Pick<TodoView, "id" | "ticket" | "kind" | "text" | "refs" | "mailRefs" | "ref" | "note" | "byWorker">): string | null {
  if (!todo.ticket) return null;
  try {
    ensureBranchKnowledge();
    snapshotTodo(todo as TodoView);
  } catch {
    // from what is kept
  }
  const s = namingSettings();
  const named = new Set([...todo.text.matchAll(/\bT-(\d+)\b/gi)].map((m) => Number(m[1])));
  const list = branchKnowledgeFor({ ticket: todo.ticket, todoIds: [todo.id], limit: 30 }).filter((a) => a.slug);
  if (!list.length) return null;
  const score = (a: BranchArtifact) => {
    let n = 0;
    if (named.has(a.todoId)) n += 10;
    if (a.sources.length) n += 2;
    if (a.sources.some((x) => x.ref.startsWith("jira-comment:"))) n += 1;
    if (a.todoId === todo.id && todo.byWorker) n -= 3;
    return n;
  };
  const best = [...list].sort((a, b) => score(b) - score(a) || b.updatedAt.localeCompare(a.updatedAt))[0];
  // The slug again for the lengths set now (the kept one was made with the defaults).
  const text = /^Todo \S+ zu \S+: (.*)$/m.exec(best.body)?.[1] ?? "";
  const slug = suggestSlug(text, s.maxChars, s.words) || best.slug.slice(0, s.maxChars).replace(/-+$/, "");
  const kind = todo.kind === "fix" || best.tags.includes("fix") ? "fix" : "feature";
  return `${kind}/${todo.ticket.toUpperCase()}-${slug}`;
}
