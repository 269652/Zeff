import { jiraCommentUrl } from "@/lib/boards/shared";
import { getTodo, markNoteSynced } from "@/lib/boards/store";
import { ValidationError, errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { jiraNoteBody, linkJiraAccounts } from "@/plugins/people/accounts";
import { resultToPayload, runStdioSession } from "./mcp-client";
import { getJiraTicket } from "./store";
import { getJiraSyncConfig } from "./sync";

/** posted: a new comment · updated: the note changed, the comment with it · synced: nothing changed, the comment was written again as it should be · reposted: the comment was gone from Jira, made again. */
export type NoteSyncResult = { state: "posted" | "updated" | "synced" | "reposted"; commentId: string; url: string | null; noAccount: string[] };

/** What Jira says about a comment that isn't there (any more). */
const GONE = /not found|does not exist|doesn'?t exist|no such|404|existiert nicht|nicht gefunden/i;

/** What the sync needs from Jira: one comment posted (its id back), one edited. */
export type NoteSyncDeps = {
  post: (ticket: string, body: string) => Promise<string | null>;
  edit: (ticket: string, commentId: string, body: string) => Promise<void>;
};

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

/** Jira through its MCP server: the calls of one sync in one session. */
async function viaJira<T>(fn: (deps: NoteSyncDeps) => Promise<T>): Promise<T> {
  const cfg = getJiraSyncConfig();
  if (!cfg.configured || !cfg.command) throw new ValidationError(t("Jira isn't set up — see the Jira tab."));
  let out!: T;
  await runStdioSession(
    { command: cfg.command, args: cfg.args, env: cfg.env, label: "Jira" },
    async (call) => {
      out = await fn({
        post: async (ticket, body) => commentIdOf(resultToPayload(await call("jira_add_comment", { issue_key: ticket, body }))),
        edit: async (ticket, commentId, body) => void (await call("jira_edit_comment", { issue_key: ticket, comment_id: commentId, body })),
      });
    },
    120000,
  );
  return out;
}

/**
 * Put your note on a todo on its Jira ticket as a comment: people you tagged (@Name) become Jira
 * mentions of the same person (their linked Jira account). Posted the first time; edited
 * when the note changed since; nothing when it's there as it is. The ticket has to be one Zeff has from
 * a Jira board. `deps`: Jira's calls (default: the Jira MCP server).
 */
export async function syncNoteToJira(todoId: number, at: string, deps?: NoteSyncDeps): Promise<NoteSyncResult> {
  const todo = getTodo(todoId);
  if (!todo) throw new ValidationError(t("Todo {ref} not found.", { ref: `T-${todoId}` }));
  const note = todo.userNotes.find((n) => n.at === at);
  if (!note) throw new ValidationError(t("That note isn't there any more."));
  if (note.by || note.kind === "instruction") throw new ValidationError(t("Only your own notes are synced to Jira."));
  if (!todo.ticket) throw new ValidationError(t("{ref} has no ticket — there's nothing to comment on.", { ref: todo.ref }));
  const ticket = getJiraTicket(todo.ticket);
  if (!ticket || ticket.boardId == null) throw new ValidationError(t("{ticket} isn't on a Jira board Zeff syncs.", { ticket: todo.ticket }));
  // Jira users Zeff knows by name but hasn't tied to a profile yet: tied now, so a tag becomes a real mention.
  try {
    linkJiraAccounts();
  } catch {
    // without the link, the name is written out
  }
  const { text, hash, noAccount } = jiraNoteBody(note.text);
  const sync = async (d: NoteSyncDeps): Promise<NoteSyncResult> => {
    const post = async () => {
      const id = await d.post(ticket.key, text);
      if (!id) throw new ValidationError(t("Jira didn't say which comment it made — nothing is marked as synced."));
      return id;
    };
    let commentId = note.jiraCommentId ?? null;
    let state: NoteSyncResult["state"];
    if (!commentId) {
      commentId = await post();
      state = "posted";
    } else {
      // Always written again (idempotent): that repairs a comment that was posted wrong, edited on Jira, or never finished.
      try {
        await d.edit(ticket.key, commentId, text);
        state = note.jiraHash === hash ? "synced" : "updated";
      } catch (e) {
        if (!GONE.test(errorMessage(e))) throw e;
        commentId = await post(); // deleted on Jira: made again
        state = "reposted";
      }
    }
    const url = ticket.url ? jiraCommentUrl(ticket.url, commentId) : null;
    markNoteSynced(todoId, at, { commentId, hash, url, text: note.text });
    return { state, commentId, url, noAccount };
  };
  try {
    return deps ? await sync(deps) : await viaJira(sync);
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(t("Jira: {error}", { error: errorMessage(e).slice(0, 300) }));
  }
}
