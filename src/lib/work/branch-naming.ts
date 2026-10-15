/**
 * Naming branches, in one place. What a worker (or an agent) is told when it names a branch: the rule with its limits,
 * your own words (Prompts → Branch names), and the knowledge artifacts tagged `branch-naming` of the ticket — nothing
 * else. The brief, the MCP's start_todo and the name Zeff gives a worker's branch all come from here. Server only.
 */
import type { TodoView } from "@/lib/boards/shared";
import { getContextPrefs } from "@/lib/boards/context-prefs";
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
 * The block a worker (or an agent) gets when it names a branch: the rule with its limits, your own words, and the
 * artifacts of the ticket (what a message asked to change, how colleagues said branches are named). Empty without a ticket.
 */
export function namingBlock(todo: Pick<TodoView, "ticket">): string {
  if (!todo.ticket) return "";
  const s = namingSettings();
  const kept = artifactsFor(todo.ticket);
  return `\n\n## Branch-Benennung (Tag ${BRANCH_TAG}, ${todo.ticket})\nDer Branch-Name: ${namingRuleLine(s)}. So sieht man schon in der Commit-History, was der eigentliche Change war.${s.extra ? `\n${s.extra}` : ""}${kept.length ? `\n\nFestgehalten (aus den Nachrichten gelesen — gilt auch, wenn die Nachricht nicht mehr im Kontext steht):\n${kept.map(line).join("\n")}` : ""}`;
}

/**
 * The name for the branch a worker starts on — feature/PROJ-306-footer-link (fix/ for a fix): the ticket key and the short
 * name of the newest "change" artifact of the ticket, as long as the settings say. Null: none kept (the worker's own
 * zeff/… name stays, and it is told the rule).
 */
export function proposeBranchName(todo: Pick<TodoView, "ticket" | "kind">): string | null {
  if (!todo.ticket) return null;
  const s = namingSettings();
  const change = artifactsFor(todo.ticket, 50).find((a) => a.kind === "change");
  const slug = change ? suggestSlug(change.text, s.maxChars, s.words) : "";
  return slug ? `${todo.kind === "fix" ? "fix" : "feature"}/${todo.ticket.toUpperCase()}-${slug}` : null;
}
