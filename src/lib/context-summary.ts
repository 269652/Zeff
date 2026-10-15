import { mergeJiraNotes, type TodoSource, type TodoUserNote } from "@/lib/boards/shared";

/**
 * What a table row needs of its todos' context to show the toggle — how much of each kind there is — without the context itself
 * (every message, every report in full). The toggle fetches the rest when it is opened. Client-safe.
 */
export type ContextSummary = { n: number; groups: Record<string, number>; remote: boolean };

/** A source's kind (Teams, Jira comment, mail, GitLab comment, MR, branch). A chat's message counts as WhatsApp (Signal), not as mail. */
export function sourceKindOf(s: TodoSource): string {
  return s.source === "gitlab" ? `gitlab-${s.gitlab.kind}` : s.source === "mail" && s.mail.folder === "WhatsApp" ? "whatsapp" : s.source === "mail" && s.mail.folder === "Signal" ? "signal" : s.source;
}

/** A kind's group in the toggle's icons: GitLab's and Jira's kinds count together. */
export const groupOfKind = (kind: string) => (kind.startsWith("gitlab") ? "gitlab" : kind.startsWith("jira") ? "jira" : kind);

/** The sources and notes of a context, counted by kind (the note of a Jira comment Zeff wrote is one entry with it). */
export function summarizeContext(sources: TodoSource[], notes: TodoUserNote[]): ContextSummary {
  const merged = mergeJiraNotes(sources, notes);
  const groups: Record<string, number> = {};
  const add = (kind: string) => {
    const g = groupOfKind(kind);
    groups[g] = (groups[g] ?? 0) + 1;
  };
  for (const s of merged.sources) add(sourceKindOf(s));
  for (const m of merged.notes) add(m.n.by ? "report" : "note");
  const remote = merged.sources.some((s) => s.source === "gitlab" && s.gitlab.kind === "branch" && s.gitlab.state !== "not pushed");
  return { n: merged.sources.length + merged.notes.length, groups, remote };
}
