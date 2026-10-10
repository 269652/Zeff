import { entityWhoWhen } from "@/lib/entities-shared";
import { todoSources } from "./sources";
import { sourcesOf, type TodoSource, type TodoView } from "./shared";

/** How long a todo you put down stays down, unless something new happens on it. */
const DOWN_DAYS = 3;

// When and from whom: the same for every kind of source (Jira, Teams, GitLab, mail).
const sourceAt = (s: TodoSource) => entityWhoWhen(s).at ?? "";
const sourceWho = (s: TodoSource) => entityWhoWhen(s).author ?? "someone";
const time = (at: string) => Date.parse(at && !at.includes("T") ? `${at.replace(" ", "T")}Z` : at);

/**
 * The todos you put to the bottom: still down — or back up, and why: an agent asks you something,
 * something new in what it came from (a reply, a comment), a note, or it's been down long enough.
 */
export function deferral(list: TodoView[]): Record<number, { deferred: boolean; bubbledUp?: string }> {
  const down = list.filter((t) => t.status === "open" && t.deferredAt);
  if (!down.length) return {};
  const sources = todoSources(down, []);
  const out: Record<number, { deferred: boolean; bubbledUp?: string }> = {};
  for (const t of down) {
    const since = time(t.deferredAt!);
    const fresh = sourcesOf(t.refs, sources)
      .filter((s) => time(sourceAt(s)) > since)
      .sort((a, b) => time(sourceAt(b)) - time(sourceAt(a)))[0];
    const why = t.needsInput
      ? "an agent asks you"
      : fresh
        ? `new from ${sourceWho(fresh)}`
        : t.userNotes.some((n) => time(n.at) > since)
          ? `new note${t.userNotes.findLast((n) => time(n.at) > since)?.by ? ` from ${t.userNotes.findLast((n) => time(n.at) > since)!.by}` : ""}`
          : Date.now() - since > DOWN_DAYS * 864e5
            ? `put down ${DOWN_DAYS} days ago`
            : undefined;
    out[t.id] = why ? { deferred: false, bubbledUp: why } : { deferred: true };
  }
  return out;
}
