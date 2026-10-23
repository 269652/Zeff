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
 * Whether two todo texts say the same: mostly the same words — or one is a part of the other (all the words of
 * the shorter among the longer's: "die Darstellung auf Live prüfen" in "… prüfen und Jens Bescheid geben").
 */
export function similarText(a: string, b: string): boolean {
  if (wordOverlap(a, b) >= 0.5) return true;
  const x = wordsOf(a);
  const y = wordsOf(b);
  const small = x.size <= y.size ? x : y;
  const big = small === x ? y : x;
  return small.size >= 4 && [...small].filter((w) => big.has(w)).length / small.size >= 0.85;
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
    return similarText(f.text, t.text);
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
  return open.find((t) => repeatsByRecord(c, t) || similarText(c.text, t.text));
}

/** The case numbers (Aktenzeichen) in a text — "DR II 456/26", "AG 55/26", "12 O 345/26" — normalized; none for dates, fractions and invoice numbers. */
export function caseRefs(text: string): string[] {
  const found = [...text.matchAll(/(?<![\p{L}\p{N}])(?:\d{1,2}\s)?[A-ZÄÖÜ]{1,4}(?:\s[IVX]{1,4})?\s\d{1,6}\/\d{2,4}(?![\p{L}\p{N}\/])/gu)].map((m) => m[0].replace(/\s+/g, " ").toUpperCase());
  return [...new Set(found)];
}

/** Whether two texts are about the same case: they name one case number alike. */
export function sameCase(a: string, b: string): boolean {
  const x = caseRefs(a);
  return x.length > 0 && caseRefs(b).some((r) => x.includes(r));
}

/** By what's on record, not the words: the same message to the same one, or the same long numbers (comments, merge requests) — on any ticket. */
export function repeatsByRecord(c: { text: string; ops: TodoOp[] }, t: TodoView): boolean {
  if (sameCase(c.text, t.text)) return true; // the same case (Aktenzeichen): one todo, whatever the words
  const mine = c.ops.map(messageOf).filter((m): m is { to: string; body: string } => !!m);
  for (const m of mine) for (const o of t.ops.map(messageOf)) if (o && o.to === m.to && wordOverlap(o.body, m.body) >= 0.6) return true;
  const ids = [...idsOf({ text: c.text, ops: c.ops })].filter((x) => !x.startsWith("!"));
  const theirs = idsOf({ text: t.text, ops: t.ops });
  return ids.length > 0 && ids.every((x) => theirs.has(x));
}

/** Whether two operations do the same: identical, or the same message to the same one in nearly the same words. */
export function sameOp(a: TodoOp, b: TodoOp): boolean {
  if (JSON.stringify(a) === JSON.stringify(b)) return true;
  const x = messageOf(a);
  const y = messageOf(b);
  return !!x && !!y && x.to === y.to && wordOverlap(x.body, y.body) >= 0.6;
}
