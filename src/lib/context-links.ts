import { mailKeyOfLink } from "./mail/shared";
import { mailsByKeys } from "./mail/store";
import { todoSources } from "./boards/sources";
import { lastGoodRun, todosByIds } from "./boards/store";
import { sourcesOf } from "./boards/shared";
import { jiraLinkOf, todoIdOfLink, workIdOfLink, type EntityMap, type WorkRunBrief } from "./entities-shared";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { gitlabLinkKey } from "./gitlab/shared";
import { gitlabItemsByKeys } from "./gitlab/store";
import { commentsByIds } from "./jira/comments";
import { getJiraTicket } from "./jira/store";
import { resolvedCommentIds } from "./resolved";
import { teamsLinkKey } from "./teams/shared";
import { teamsMessagesByKeys } from "./teams/store";

/** Runs (an agent's, a worker's) by id, as evidence. */
function workRuns(ids: number[]): Map<number, WorkRunBrief> {
  if (!ids.length) return new Map();
  const rows = getDb().select().from(schema.workRuns).where(inArray(schema.workRuns.id, ids)).all();
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        ref: `W-${r.id}`,
        agent: r.model ?? r.provider,
        todoId: r.todoId,
        ticket: r.ticket,
        status: r.status,
        outcome: r.outcome,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        minutes: r.durationMs ? Math.round(r.durationMs / 60000) : null,
        entryLine: r.entryLine,
        summary: r.summary,
        branch: r.branch,
      },
    ]),
  );
}

/**
 * Which of these links point at a synced Teams message, a GitLab item, a Jira comment or ticket
 * or a board todo — that message / item / ticket / todo, by link (a todo with what it came from).
 */
export function resolveLinks(urls: string[]): EntityMap {
  const list = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  const teams = teamsMessagesByKeys(list.map((u) => teamsLinkKey(u) ?? ""));
  const gitlab = gitlabItemsByKeys(list.map((u) => gitlabLinkKey(u) ?? ""));
  const mails = mailsByKeys(list.map((u) => mailKeyOfLink(u) ?? ""));
  const todos = todosByIds(list.flatMap((u) => todoIdOfLink(u) ?? []));
  const from = todos.size ? todoSources([...todos.values()], lastGoodRun()?.tickets ?? []) : {};
  const jira = new Map(list.flatMap((u) => { const j = jiraLinkOf(u); return j ? [[u, j] as const] : []; }));
  const kept = commentsByIds([...jira.values()].flatMap((j) => (j.commentId ? [j.commentId] : [])));
  const done = resolvedCommentIds([...kept.keys()]);
  const runs = workRuns(list.flatMap((u) => workIdOfLink(u) ?? []));
  const out: EntityMap = {};
  for (const u of list) {
    const run = runs.get(workIdOfLink(u) ?? -1);
    if (run) {
      out[u] = { source: "work", run };
      continue;
    }
    const t = teams.get(teamsLinkKey(u) ?? "");
    if (t) {
      out[u] = { source: "teams", teams: t };
      continue;
    }
    const g = gitlab.get(gitlabLinkKey(u) ?? "");
    if (g) {
      out[u] = { source: "gitlab", gitlab: g };
      continue;
    }
    const mail = mails.get(mailKeyOfLink(u) ?? "");
    if (mail) {
      out[u] = { source: "mail", mail };
      continue;
    }
    const todo = todos.get(todoIdOfLink(u) ?? -1);
    if (todo) {
      out[u] = { source: "todo", todo, from: sourcesOf(todo.refs, from) };
      continue;
    }
    const j = jira.get(u);
    if (j?.commentId) {
      const c = kept.get(j.commentId);
      out[u] = { source: "jira-comment", comment: { id: j.commentId, ticket: c?.ticket ?? j.ticket, author: c?.author ?? "", at: c?.at ?? "", text: c?.body ?? "", url: u, resolved: done.has(j.commentId) } };
      continue;
    }
    const tk = j && getJiraTicket(j.ticket);
    if (tk) out[u] = { source: "jira", ticket: { key: tk.key, summary: tk.summary, status: tk.status, assignee: tk.assignee, description: tk.description, url: tk.url ?? u } };
  }
  return out;
}
