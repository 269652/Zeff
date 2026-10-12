import { contextFileOnDisk, getContextItem, markContextSynced, markFilesSynced } from "@/lib/contexts";
import { resolveLinks } from "@/lib/context-links";
import { contextHeadline, jiraCommentMarkdown, jiraSyncHash, jiraSyncState, type ContextItem } from "@/lib/contexts-shared";
import { entitySourceLabel, entityText, entityWhoWhen } from "@/lib/entities-shared";
import { gitlabHeadline, gitlabMarkdown } from "@/lib/gitlab/shared";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { resultToPayload, runStdioSession } from "./mcp-client";
import { getJiraSyncConfig } from "./sync";

export type ContextSyncResult = {
  /** Posted as a new comment. */
  posted: string[];
  /** Its comment edited (the item changed since). */
  updated: string[];
  /** Already on the ticket as it is. */
  unchanged: string[];
  /** Files attached. */
  files: string[];
  /** Left out (no ticket). */
  skipped: string[];
  errors: string[];
};

/** An item's links to synced Teams messages / GitLab items, each with a "who · where · when" heading and its words — for the comment. */
function linkedWords(c: ContextItem): Record<string, { heading: string; text: string }> {
  const entities = resolveLinks(c.links.map((l) => l.url));
  const out: Record<string, { heading: string; text: string }> = {};
  for (const [url, e] of Object.entries(entities)) {
    const { author, at } = entityWhoWhen(e);
    const when = at ? new Date(at).toLocaleString("de-DE", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    const where =
      e.source === "teams"
        ? e.teams.place
        : e.source === "todo"
          ? `${e.todo.ref}${e.todo.status === "done" ? " erledigt" : ""}`
          : e.source === "gitlab"
            ? `${e.gitlab.project.split("/").pop()} ${gitlabHeadline(e.gitlab)}`
            : e.source === "jira"
              ? e.ticket.key
              : e.source === "mail"
                ? `„${e.mail.subject}“`
                : e.source === "time"
                  ? `${e.time.todo}, ${e.time.minutes} min`
                  : e.source === "work"
                  ? `${e.run.ref}${e.run.todoId ? ` an T-${e.run.todoId}` : ""}${e.run.minutes != null ? `, ${e.run.minutes} min` : ""}`
                  : e.comment.ticket;
    out[url] = {
      heading: `**${author ?? entitySourceLabel(e)}** — ${[entitySourceLabel(e), where, when].filter(Boolean).join(" · ")}`,
      text: e.source === "gitlab" ? gitlabMarkdown(e.gitlab) : entityText(e),
    };
  }
  return out;
}

/** The comment id in jira_add_comment's answer ({ comment: { id } }, { id }, …), if any. */
function commentIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  for (const v of [o.comment, o.result, o.data]) {
    const id = commentIdOf(v);
    if (id) return id;
  }
  return typeof o.id === "string" || typeof o.id === "number" ? String(o.id) : null;
}

/**
 * Put context items on their Jira tickets through the Jira MCP server: each item is one
 * comment — posted the first time, edited when the item changed since — and its files not
 * yet attached are uploaded to the ticket. Items without a ticket are skipped. `dryRun`
 * reports what it would do without writing to Jira.
 */
export async function syncContextsToJira(ids: number[], opts: { dryRun?: boolean } = {}): Promise<ContextSyncResult> {
  const res: ContextSyncResult = { posted: [], updated: [], unchanged: [], files: [], skipped: [], errors: [] };
  const items = [...new Set(ids)].map((id) => getContextItem(id)).filter((c): c is ContextItem => !!c);
  const todo = items.filter((c) => {
    if (!c.ticket) res.skipped.push(t("“{title}” has no Jira ticket", { title: contextHeadline(c, t) }));
    else if (jiraSyncState(c) === "no-ticket") res.skipped.push(t("“{title}” is in Jira already", { title: contextHeadline(c, t) }));
    return jiraSyncState(c) !== "no-ticket";
  });
  if (!todo.length) return res;
  const cfg = getJiraSyncConfig();
  if (!cfg.configured || !cfg.command) throw new Error(t("Jira isn't set up — see the Jira tab."));

  await runStdioSession(
    { command: cfg.command, args: cfg.args, env: cfg.env, label: "Jira" },
    async (call) => {
      for (const c of todo) {
        const where = `${c.ticket} · ${contextHeadline(c, t)}`;
        try {
          // Files first: the comment shows pasted images inline by their attachment name.
          const pending = c.files.filter((f) => !f.jiraSyncedAt);
          if (pending.length) {
            const paths = pending.map((f) => contextFileOnDisk(f.id)?.absPath).filter((p): p is string => !!p);
            if (!opts.dryRun) {
              await call("jira_update_issue", { issue_key: c.ticket, fields: "{}", attachments: JSON.stringify(paths) });
              markFilesSynced(pending.map((f) => f.id));
            }
            res.files.push(...pending.map((f) => `${c.ticket} · ${f.name}`));
          }
          const body = jiraCommentMarkdown(c, linkedWords(c));
          const hash = jiraSyncHash(c);
          let commentId = c.jiraCommentId;
          if (!commentId) {
            if (!opts.dryRun) commentId = commentIdOf(resultToPayload(await call("jira_add_comment", { issue_key: c.ticket, body })));
            res.posted.push(where);
          } else if (c.jiraSyncedHash !== hash) {
            if (!opts.dryRun) await call("jira_edit_comment", { issue_key: c.ticket, comment_id: commentId, body });
            res.updated.push(where);
          } else {
            res.unchanged.push(where);
          }
          if (!opts.dryRun) markContextSynced(c.id, commentId, hash);
        } catch (e) {
          res.errors.push(`${where}: ${errorMessage(e).slice(0, 200)}`);
        }
      }
    },
    300000,
  );
  return res;
}
