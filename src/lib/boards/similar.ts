import type { TodoOp, TodoView } from "./shared";

/** The numbers a todo is about (GitLab comment ids, merge requests, commits): in its text, target, refs and operations. */
function idsOf(v: { text: string; target?: string | null; refs?: string[]; ops?: unknown }): Set<string> {
  const all = `${v.text} ${v.target ?? ""} ${(v.refs ?? []).join(" ")} ${JSON.stringify(v.ops ?? [])}`;
  return new Set([...(all.match(/\d{5,}/g) ?? []), ...[...all.matchAll(/!(\d+)/g)].map((m) => `!${m[1]}`)]);
}

const wordsOf = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((w) => w.length >= 4),
  );

/** How alike two texts are, by their words (0–1). */
export function wordOverlap(a: string, b: string): number {
  const x = wordsOf(a);
  const y = wordsOf(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared || 1);
}

/**
 * An open todo a follow-up only repeats: about the same comments (all its long ids among the
 * other's — the !168 alone isn't enough), or mostly the same words.
 */
export function sameTodo(f: { text: string; target?: string | null; ops?: unknown }, open: TodoView[]): TodoView | undefined {
  const ids = [...idsOf(f)].filter((x) => !x.startsWith("!"));
  return open.find((t) => {
    const theirs = idsOf(t);
    if (ids.length && ids.every((x) => theirs.has(x))) return true;
    return wordOverlap(f.text, t.text) >= 0.5;
  });
}

/** A message operation's addressee and words (a Teams message, a Jira comment, a GitLab reply). */
const messageOf = (o: TodoOp): { to: string; body: string } | null =>
  o.type === "teams-message" ? { to: `teams:${o.to.toLowerCase()}`, body: o.body } : o.type === "jira-comment" ? { to: `jira:${o.ticket}`, body: o.body } : o.type === "gitlab-reply" ? { to: `gitlab:${o.note}`, body: o.body } : null;

/**
 * An open todo — on any ticket — a new one from the Ticket-Lage would repeat: the same message to
 * the same one (nearly the same words), the same numbers in its text and operations (not merely
 * the same source: two todos can come from one message), or mostly the same words.
 */
export function duplicateTodo(c: { text: string; ops: TodoOp[] }, open: TodoView[]): TodoView | undefined {
  const mine = c.ops.map(messageOf).filter((m): m is { to: string; body: string } => !!m);
  const ids = [...idsOf({ text: c.text, ops: c.ops })].filter((x) => !x.startsWith("!"));
  return open.find((t) => {
    for (const m of mine) for (const o of t.ops.map(messageOf)) if (o && o.to === m.to && wordOverlap(o.body, m.body) >= 0.6) return true;
    const theirs = idsOf({ text: t.text, ops: t.ops });
    if (ids.length && ids.every((x) => theirs.has(x))) return true;
    return wordOverlap(c.text, t.text) >= 0.5;
  });
}
