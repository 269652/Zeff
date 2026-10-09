import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";

const { teamsMessages, resolvedJiraComments, gitlabItems } = schema;

/**
 * Done marks on what colleagues wrote — Jira comments, Teams messages, GitLab comments — by hand
 * or with the todo they led to. Boards runs make no new todos from them (nor from GitLab
 * comments whose thread is resolved in GitLab).
 */

/** Which of these Jira comments are marked done. */
export function resolvedCommentIds(ids: string[]): Set<string> {
  if (!ids.length) return new Set();
  return new Set(
    getDb()
      .select({ id: resolvedJiraComments.commentId })
      .from(resolvedJiraComments)
      .where(inArray(resolvedJiraComments.commentId, ids))
      .all()
      .map((r) => r.id),
  );
}

export function setJiraCommentResolved(commentId: string, ticket: string, resolved: boolean): void {
  const db = getDb();
  if (resolved) db.insert(resolvedJiraComments).values({ commentId, ticket: ticket.toUpperCase() }).onConflictDoNothing().run();
  else db.delete(resolvedJiraComments).where(eq(resolvedJiraComments.commentId, commentId)).run();
}

export function setTeamsResolved(key: string, resolved: boolean): void {
  getDb()
    .update(teamsMessages)
    .set({ resolvedAt: resolved ? new Date().toISOString() : null })
    .where(eq(teamsMessages.key, key))
    .run();
}

/** A GitLab comment ("note:<id>") marked done here, or not (GitLab's own resolved state stays as synced). */
export function setGitlabResolved(key: string, resolved: boolean): void {
  getDb()
    .update(gitlabItems)
    .set({ resolvedAt: resolved ? new Date().toISOString() : null })
    .where(and(eq(gitlabItems.key, key), eq(gitlabItems.kind, "comment")))
    .run();
}

/** A todo opened again: the comments and messages it came from are open again too. */
export function unresolveRefs(refs: string[], ticket: string): void {
  for (const ref of refs) {
    const m = /^(jira-comment|teams|gitlab):(.+)$/.exec(ref.trim());
    if (!m) continue;
    if (m[1] === "jira-comment") setJiraCommentResolved(m[2], ticket, false);
    else if (m[1] === "teams") setTeamsResolved(m[2], false);
    else setGitlabResolved(m[2], false);
  }
}

/**
 * A todo settled: the comments and messages it came from ("jira-comment:<id>", "teams:<key>",
 * "gitlab:note:<id>") are done too.
 */
export function resolveRefs(refs: string[], ticket: string): void {
  for (const ref of refs) {
    const m = /^(jira-comment|teams|gitlab):(.+)$/.exec(ref.trim());
    if (!m) continue;
    if (m[1] === "jira-comment") setJiraCommentResolved(m[2], ticket, true);
    else if (m[1] === "teams") setTeamsResolved(m[2], true);
    else setGitlabResolved(m[2], true);
  }
}
