/**
 * Naming branches, in one place: feature/PROJ-432-fileadmin-relations — fix/ for a fix, the ticket key, then a short name
 * of the code change. The short name comes from the newest change kept for the ticket (the briefing's AI writes those from
 * the messages it reads), else from the todo's words, else from the ticket's title; how long it may be and your own words
 * are set under Prompts → Branch names. A worker's branch gets this name when it starts, and its brief and the MCP's
 * start_todo carry the rule and what is kept. Server only.
 */
import type { TodoView } from "@/lib/boards/shared";
import { getContextPrefs } from "@/lib/boards/context-prefs";
import { getTodo } from "@/lib/boards/store";
import { getJiraTicket } from "@/lib/jira/store";
import { artifactsFor, BRANCH_TAG, suggestSlug, type BranchArtifact } from "./branch-knowledge";

export type NamingSettings = { maxChars: number; words: number; extra: string };

/** The settings (Prompts → Branch names), the defaults where nothing is set. */
export function namingSettings(): NamingSettings {
  const p = getContextPrefs().branchname;
  return { maxChars: p.numbers.maxChars, words: p.numbers.words, extra: p.extra.trim() };
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

const line = (a: BranchArtifact) => `- ${a.kind === "rule" ? "Regel" : "Code Change"}: ${a.text}${a.source ? ` — ${a.source.label}: „${a.source.text.slice(0, 300)}“` : ""}`;

/**
 * What a worker (or an agent) is told about naming the branch: the rule with its limits, your own words, and what is kept
 * for the ticket (a change a message asked for, how colleagues said branches are named). Empty without a ticket.
 */
export function namingBlock(todo: Pick<TodoView, "ticket">): string {
  if (!todo.ticket) return "";
  const s = namingSettings();
  const kept = artifactsFor(todo.ticket);
  return `\n\n## Branch-Benennung (Tag ${BRANCH_TAG}, ${todo.ticket})\nDer Branch-Name: ${namingRuleLine(s)}. So sieht man schon in der Commit-History, was der eigentliche Change war.${s.extra ? `\n${s.extra}` : ""}${kept.length ? `\n\nFestgehalten (aus den Nachrichten gelesen — gilt auch, wenn die Nachricht nicht mehr im Kontext steht):\n${kept.map(line).join("\n")}` : ""}`;
}

/** Where the short name comes from: a kept change, the todo's words, the ticket's title. */
export type NameFrom = "kept" | "todo" | "ticket";

/**
 * The branch name of a todo — feature/PROJ-432-fileadmin-relations — and the words it was made from. A session's
 * placeholder ("… T-165 vollständig abschließen") takes the words of the todo it names. Null only without a ticket or
 * without any words to make a name of.
 */
export function branchNameFor(todo: Pick<TodoView, "ticket" | "kind" | "text">): { name: string; from: NameFrom; text: string } | null {
  if (!todo.ticket.trim()) return null;
  const key = todo.ticket.trim().toUpperCase();
  const s = namingSettings();
  const named = /\bT-(\d+)\b/i.exec(todo.text);
  const candidates: [NameFrom, string][] = [
    ["kept", artifactsFor(key, 50).find((a) => a.kind === "change")?.text ?? ""],
    ["todo", (named ? getTodo(Number(named[1]))?.text : "") || todo.text],
    ["ticket", getJiraTicket(key)?.summary ?? ""],
  ];
  for (const [from, text] of candidates) {
    const slug = suggestSlug(text, s.maxChars, s.words);
    if (slug) return { name: `${todo.kind === "fix" ? "fix" : "feature"}/${key}-${slug}`, from, text };
  }
  return null;
}

/** Just the name (see branchNameFor). */
export const proposeBranchName = (todo: Pick<TodoView, "ticket" | "kind" | "text">): string | null => branchNameFor(todo)?.name ?? null;
