import { listTodoTimes } from "@/lib/work/todo-time";
import { desc, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { commentsOfTickets } from "@/lib/jira/comments";
import { getJiraTicket, myJiraName } from "@/lib/jira/store";
import { getTodoDisplayOff } from "@/lib/todo-display-store";
import { gitlabItemsByKeys } from "@/lib/gitlab/store";
import { listRepos } from "@/lib/repos";
import { t } from "@/lib/i18n/server";
import { todoLinks } from "./links";
import { relatedNotes } from "./related-notes";
import { deferral } from "./deferral";
import type { TodoAlternative, TodoView } from "./shared";

/** "Rico Clemen" → "rico clemen" (no accents), for matching a Jira username. */
const plainName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Whether a Jira username is this person's — the house pattern: first three letters of the first
 * name, then the last name's start (riccleme = Rico Clemen, chrlorenz1 = Christopher Lorenz).
 */
function isUserOf(user: string, name: string): boolean {
  const u = user.toLowerCase().replace(/\d+$/, "");
  const parts = plainName(name).split(/\s+/).filter(Boolean);
  if (parts.length < 2 || u.length < 5) return false;
  const [first, last] = [parts[0], parts[parts.length - 1]];
  const rest = u.slice(3);
  return (
    u.startsWith(first.slice(0, 3)) && rest.length >= 3 && last.startsWith(rest)
  );
}

/** "Rico Clemen"-like name pairs in a text. */
const namesIn = (text: string) =>
  [
    ...text.matchAll(
      /\b([A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?)\s+([A-ZÄÖÜ][a-zäöüß]+)\b/g,
    ),
  ].map((m) => `${m[1]} ${m[2]}`);

/**
 * Other ways to settle each open todo with operations, one click each (no AI):
 * - a Jira comment that @-mentions someone: assign the ticket to them ("Rico zuweisen") — on its own;
 * - a delivery step (push, open a merge request): merge straight into the default branch instead.
 */
export function todoAlternatives(
  list: TodoView[],
): Record<number, TodoAlternative[]> {
  const open = list.filter((t) => t.status === "open" && t.ops.length);
  if (!open.length) return {};
  const me = myJiraName();
  const authors = commentsOfTickets(
    open.flatMap((t) =>
      t.ops.flatMap((o) => (o.type === "jira-comment" ? [o.ticket] : [])),
    ),
  );
  // Assignments already made from a todo (its follow-ups, by their words — their operations are
  // emptied once run): not offered again.
  const made = new Set(
    getDb()
      .select({
        parentId: schema.todos.parentId,
        text: schema.todos.text,
        status: schema.todos.status,
      })
      .from(schema.todos)
      .where(
        inArray(
          schema.todos.parentId,
          open.map((t) => t.id),
        ),
      )
      .all()
      .filter((r) => r.status !== "dismissed")
      .map((r) => `${r.parentId}|${r.text}`),
  );
  const out: Record<number, TodoAlternative[]> = {};
  for (const todo of open) {
    const alts: TodoAlternative[] = [];
    for (const o of todo.ops) {
      if (o.type === "jira-comment") {
        const names = [
          ...new Set([
            ...(authors.get(o.ticket.toUpperCase()) ?? []).map((c) => c.author),
            ...namesIn(`${todo.text} ${o.body}`),
          ]),
        ];
        for (const user of new Set(
          [...o.body.matchAll(/\[~([^\]\s]+)\]/g)].map((m) => m[1]),
        )) {
          const name = names.find((n) => isUserOf(user, n));
          if (me && name && plainName(name) === plainName(me)) continue;
          if (
            todo.ops.some(
              (x) =>
                x.type === "jira-assign" &&
                x.ticket === o.ticket &&
                x.assignee === user,
            )
          )
            continue;
          const who = name ?? user;
          const title = `${o.ticket} ${name ?? user} zuweisen`;
          if (made.has(`${todo.id}|${title}`)) continue;
          const assignee = getJiraTicket(o.ticket)?.assignee;
          if (assignee && name && plainName(assignee) === plainName(name))
            continue;
          alts.push({
            label: t("Assign {name}", { name: who.split(" ")[0] }),
            title,
            ops: [{ type: "jira-assign", ticket: o.ticket, assignee: user }],
            also: true,
          });
        }
      }
    }
    // A delivery: the other way, whole — merge into main instead of the merge request, or the
    // merge request instead of merging (the commit, when there's one, first either way).
    const commit = todo.ops.find((o) => o.type === "git-commit-branch");
    const push = todo.ops.find((o) => o.type === "git-push");
    const mr = todo.ops.find((o) => o.type === "gitlab-open-mr");
    const merge = todo.ops.find((o) => o.type === "git-merge-main");
    const repo = commit?.repo ?? push?.repo ?? mr?.repo ?? merge?.repo;
    if (repo && (push || mr) && !merge) {
      const target = (mr ?? push)!.target;
      const branch = commit ? commit.branch : push ? push.branch : `origin/${mr!.source}`;
      const name = branch.replace(/^origin\//, "");
      alts.push({
        label: t("Merge into {target}", { target }),
        title: commit
          ? t("Instead of a merge request: commit, then merge {name} straight into {target} (in a worktree of its own) and push", { name, target })
          : t("Instead of a merge request: merge {name} straight into {target} (in a worktree of its own) and push", { name, target }),
        ops: [...(commit ? [commit] : []), { type: "git-merge-main", repo, branch, target }],
        text: `Merge ${name} into ${target} and push`,
      });
    } else if (merge && !push && !mr) {
      const project = listRepos().find((r) => r.path === merge.repo)?.gitlabProject;
      const name = (commit?.branch ?? merge.branch).replace(/^origin\//, "");
      if (project && name !== merge.target) {
        const local = !!commit || !merge.branch.startsWith("origin/");
        alts.push({
          label: t("Open MR"),
          // (A commit is local: pushed too.)
          title: commit
            ? t("Instead of merging straight away: commit, push, open merge request {name} → {target}", { name, target: merge.target })
            : local
              ? t("Instead of merging straight away: push, open merge request {name} → {target}", { name, target: merge.target })
              : t("Instead of merging straight away: open merge request {name} → {target}", { name, target: merge.target }),
          ops: [
            ...(commit ? [commit] : []),
            ...(local ? [{ type: "git-push" as const, repo: merge.repo, branch: name, remote: name, target: merge.target, title: commit?.message ?? name, description: "" }] : []),
            { type: "gitlab-open-mr", repo: merge.repo, project, source: name, target: merge.target, title: commit?.message ?? name, description: "" },
          ],
          text: `Open merge request ${name} → ${merge.target}`,
        });
      }
    }
    if (alts.length) out[todo.id] = alts;
  }
  return out;
}

/**
 * Why a todo's operations can't run yet, from what the GitLab sync knows: a merge of a merge
 * request that isn't approved (or is merged or closed already). No AI — the MR's state.
 */
export function blockedBy(list: TodoView[]): Record<number, string> {
  const merges = list.flatMap((todo) => (todo.status === "open" ? todo.ops.flatMap((o) => (o.type === "gitlab-merge" ? [{ todo, key: `mr:${o.project}!${o.iid}`, iid: o.iid }] : [])) : []));
  if (!merges.length) return {};
  const items = gitlabItemsByKeys(merges.map((m) => m.key));
  const out: Record<number, string> = {};
  // The merge waits for the approval unless that is switched off (Settings → Todos).
  const gate = !getTodoDisplayOff().includes("mergeGate");
  for (const m of merges) {
    const state = items.get(m.key)?.state ?? "";
    if (/merged/.test(state)) out[m.todo.id] = t("!{iid} is merged already", { iid: m.iid });
    else if (/closed/.test(state)) out[m.todo.id] = t("!{iid} is closed", { iid: m.iid });
    else if (gate && !/approved/.test(state))
      out[m.todo.id] = state ? t("!{iid} isn't approved yet", { iid: m.iid }) : t("!{iid} isn't approved yet (unknown to the GitLab sync)", { iid: m.iid });
  }
  return out;
}

/** Open todos whose last run failed: why (its error, first lines). */
function lastErrors(list: TodoView[]): Record<number, { text: string; run: number }> {
  const open = list.filter((t) => t.status === "open").map((t) => t.id);
  if (!open.length) return {};
  const out: Record<number, { text: string; run: number }> = {};
  const seen = new Set<number>();
  for (const r of getDb()
    .select({ id: schema.workRuns.id, todoId: schema.workRuns.todoId, status: schema.workRuns.status, error: schema.workRuns.error, seen: schema.workRuns.errorSeenAt })
    .from(schema.workRuns)
    .where(inArray(schema.workRuns.todoId, open))
    .orderBy(desc(schema.workRuns.id))
    .all()) {
    if (seen.has(r.todoId)) continue; // only its latest run counts
    seen.add(r.todoId);
    if ((r.status === "failed" || r.status === "interrupted") && r.error && !r.seen)
      out[r.todoId] = { text: r.error.split("\n").slice(0, 2).join(" ").replace(/\s+/g, " ").slice(0, 300), run: r.id };
  }
  return out;
}

/** The time records of each todo that has any. */
function todoTimes(list: TodoView[]): Record<number, import("@/lib/work/shared").TimeRecord[]> {
  const out: Record<number, import("@/lib/work/shared").TimeRecord[]> = {};
  for (const r of listTodoTimes(list.map((t) => t.id))) (out[r.todoId] ??= []).push(r);
  return out;
}

/** The todos, each with its alternatives — what keeps its operations from running yet, and why its last run failed. */
export const withAlternatives = (list: TodoView[]): TodoView[] => {
  // Each enricher: what it adds to the todos it has something for (by id) — merged into each todo.
  const parts: Record<number, Partial<TodoView>>[] = [
    each(todoAlternatives(list), (alternatives) => ({ alternatives })),
    each(blockedBy(list), (blockedBy) => ({ blockedBy })),
    each(lastErrors(list), (e) => ({ lastError: e.text, lastErrorRun: e.run })),
    each(todoLinks(list), (links) => ({ links })),
    each(relatedNotes(list), (relatedNotes) => ({ relatedNotes })),
    each(todoTimes(list), (time) => ({ time })),
    deferral(list),
  ];
  return list.map((t) => {
    const extra = Object.assign({}, ...parts.map((p) => p[t.id] ?? {})) as Partial<TodoView>;
    return Object.keys(extra).length ? { ...t, ...extra } : t;
  });
};

/** A by-id record of values as by-id partial todos. */
const each = <V>(byId: Record<number, V>, as: (v: V) => Partial<TodoView>): Record<number, Partial<TodoView>> =>
  Object.fromEntries(Object.entries(byId).map(([id, v]) => [id, as(v)]));
