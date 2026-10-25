import { entityWhoWhen } from "@/lib/entities-shared";
import { t } from "@/lib/i18n/server";
import { todoSources } from "./sources";
import { daysUntil, repeatNotYet } from "./due-shared";
import { sourcesOf, type TodoSource, type TodoView } from "./shared";

/** How long a todo you put down stays down, unless something new happens on it. */
const DOWN_DAYS = 3;

// When and from whom: the same for every kind of source (Jira, Teams, GitLab, mail).
const sourceAt = (s: TodoSource) => entityWhoWhen(s).at ?? "";
const sourceWho = (s: TodoSource) => entityWhoWhen(s).author ?? t("someone");
const time = (at: string) => Date.parse(at && !at.includes("T") ? `${at.replace(" ", "T")}Z` : at);

/**
 * The todos you put to the bottom: still down — or back up, and why: an agent asks you something,
 * something new in what it came from (a reply, a comment), a note, or it's been down long enough. A repeat (the next rate) stays down
 * until a week before its due day — not after three days — and comes up then saying when it is due.
 */
export function deferral(list: TodoView[]): Record<number, { deferred: boolean; bubbledUp?: string }> {
  const down = list.filter((x) => x.status === "open" && x.deferredAt);
  if (!down.length) return {};
  const sources = todoSources(down, []);
  const out: Record<number, { deferred: boolean; bubbledUp?: string }> = {};
  for (const todo of down) {
    const since = time(todo.deferredAt!);
    const fresh = sourcesOf(todo.refs, sources)
      .filter((s) => time(sourceAt(s)) > since)
      .sort((a, b) => time(sourceAt(b)) - time(sourceAt(a)))[0];
    const noteBy = todo.userNotes.findLast((n) => time(n.at) > since)?.by;
    const why = todo.needsInput
      ? t("an agent asks you")
      : fresh
        ? t("new from {who}", { who: sourceWho(fresh) })
        : todo.userNotes.some((n) => time(n.at) > since)
          ? noteBy
            ? t("new note from {who}", { who: noteBy })
            : t("new note")
          : todo.recurrence && todo.due
            ? repeatNotYet(todo) === null
              ? t("due in {n} days", { n: Math.max(0, daysUntil(todo.due.slice(0, 10))) })
              : undefined
            : Date.now() - since > DOWN_DAYS * 864e5
              ? t("put down {n} days ago", { n: DOWN_DAYS })
              : undefined;
    out[todo.id] = why ? { deferred: false, bubbledUp: why } : { deferred: true };
  }
  return out;
}
