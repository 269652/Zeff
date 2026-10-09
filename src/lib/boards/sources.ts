import { mailsByKeys } from "@/lib/mail/store";
import { isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { gitlabLinkKey } from "@/lib/gitlab/shared";
import { conversationsOf, gitlabItemsByKeys } from "@/lib/gitlab/store";
import { commentsByIds } from "@/lib/jira/comments";
import { getJiraTicket } from "@/lib/jira/store";
import { resolvedCommentIds } from "@/lib/resolved";
import { teamsLinkKey } from "@/lib/teams/shared";
import { teamsMessagesByKeys } from "@/lib/teams/store";
import {
  jiraCommentUrl,
  type BoardTicket,
  type SyncedComment,
  type TodoSource,
  type TodoView,
} from "./shared";

/**
 * The Teams messages and GitLab items Zeff posted to Jira itself (a context item's "Sync to
 * Jira"): by the comment ("<id>" → its original, as "teams:<key>" / "gitlab:<key>") and by the
 * original (its comment) — the comment is only a copy.
 */
export function syncedContexts(): {
  byComment: Map<string, { ref: string; ticket: string | null }>;
  byRef: Map<string, { commentId: string; ticket: string | null }>;
} {
  const byComment = new Map<string, { ref: string; ticket: string | null }>();
  const byRef = new Map<string, { commentId: string; ticket: string | null }>();
  const rows = getDb()
    .select({
      commentId: schema.contexts.jiraCommentId,
      links: schema.contexts.links,
      ticket: schema.contexts.ticket,
    })
    .from(schema.contexts)
    .where(isNotNull(schema.contexts.jiraCommentId))
    .all();
  for (const r of rows) {
    if (!r.commentId) continue;
    let urls: string[] = [];
    try {
      urls = (JSON.parse(r.links) as { url: string }[]).map((l) => l.url);
    } catch {
      continue;
    }
    const teams = urls.map((u) => teamsLinkKey(u)).find(Boolean);
    const gitlab = urls.map((u) => gitlabLinkKey(u)).find(Boolean);
    const ref = teams ? `teams:${teams}` : gitlab ? `gitlab:${gitlab}` : null;
    if (!ref) continue;
    byComment.set(r.commentId, { ref, ticket: r.ticket });
    if (!byRef.has(ref))
      byRef.set(ref, { commentId: r.commentId, ticket: r.ticket });
  }
  return { byComment, byRef };
}

/**
 * What these todos came from, by ref: Jira comments as the run read them (an older one only by
 * its link), Teams messages and GitLab comments as synced — with whether each is marked done. A
 * Jira comment Zeff posted from a Teams message (or GitLab item) is that message, marked as
 * synced to Jira; so is the message itself, when a todo names it. Refs that point at nothing
 * known are left out.
 */
export function todoSources(
  todos: TodoView[],
  tickets: BoardTicket[],
): Record<string, TodoSource> {
  const out: Record<string, TodoSource> = {};
  const refs = [...new Set(todos.flatMap((t) => t.refs))];
  const of = (prefix: string) =>
    refs.filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length));
  const { byComment, byRef } = syncedContexts();

  const ticketUrl = new Map(tickets.map((t) => [t.key, t.url]));
  const urlOf = (ticket: string | null | undefined) =>
    ticket
      ? (ticketUrl.get(ticket) ?? getJiraTicket(ticket)?.url ?? null)
      : null;
  const ids = of("jira-comment:");
  // Copies of messages: the originals stand in for them (looked up with the others below).
  const originals = ids.flatMap((id) =>
    byComment.has(id) ? [byComment.get(id)!.ref] : [],
  );
  const teams = teamsMessagesByKeys([
    ...of("teams:"),
    ...originals.filter((r) => r.startsWith("teams:")).map((r) => r.slice(6)),
  ]);
  const mails = mailsByKeys(of("mail:"));
  const gitlab = gitlabItemsByKeys([
    ...of("gitlab:"),
    ...originals.filter((r) => r.startsWith("gitlab:")).map((r) => r.slice(7)),
  ]);
  const done = resolvedCommentIds([
    ...ids,
    ...[...byRef.values()].map((s) => s.commentId),
  ]);
  // A GitLab comment comes with its merge request's conversation (what the others wrote too).
  const conversations = conversationsOf(
    [...gitlab.values()].flatMap((g) =>
      g.kind === "comment" && g.parent ? [g.parent] : [],
    ),
  );
  const conversationOf = (
    g: typeof gitlab extends Map<string, infer V> ? V : never,
  ) => {
    const list = g.parent ? (conversations.get(g.parent) ?? []) : [];
    return list.some((x) => x.key === g.key)
      ? list
      : [...list, g].sort((a, b) =>
          (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
        );
  };
  const syncedOf = (ref: string): SyncedComment | undefined => {
    const s = byRef.get(ref);
    if (!s) return undefined;
    const url = urlOf(s.ticket);
    return {
      commentId: s.commentId,
      ticket: s.ticket,
      url: url ? jiraCommentUrl(url, s.commentId) : null,
      resolved: done.has(s.commentId),
    };
  };
  const entity = (ref: string): TodoSource | null => {
    if (ref.startsWith("mail:")) {
      const m = mails.get(ref.slice(5));
      return m ? { source: "mail", mail: m, synced: syncedOf(ref) } : null;
    }
    if (ref.startsWith("teams:")) {
      const m = teams.get(ref.slice(6));
      return m ? { source: "teams", teams: m, synced: syncedOf(ref) } : null;
    }
    if (ref.startsWith("gitlab:")) {
      const g = gitlab.get(ref.slice(7));
      return g
        ? {
            source: "gitlab",
            gitlab: g,
            synced: syncedOf(ref),
            thread: g.kind === "comment" ? conversationOf(g) : undefined,
          }
        : null;
    }
    return null;
  };

  const kept = commentsByIds(ids);
  const read = new Map(
    tickets.flatMap((t) =>
      (t.recent ?? []).map((c) => [c.id, { ...c, ticket: t.key }] as const),
    ),
  );
  for (const id of ids) {
    const copy = byComment.get(id);
    const original = copy ? entity(copy.ref) : null;
    if (original) {
      out[`jira-comment:${id}`] = original;
      continue;
    }
    const c =
      read.get(id) ??
      (kept.has(id)
        ? { ...kept.get(id)!, text: kept.get(id)!.body }
        : undefined);
    const ticket =
      c?.ticket ??
      todos.find((t) => t.refs.includes(`jira-comment:${id}`))?.ticket ??
      "";
    const url = urlOf(ticket);
    const comment = {
      id,
      ticket,
      author: c?.author ?? "",
      at: c?.at ?? "",
      text: c?.text ?? "",
      url: url ? jiraCommentUrl(url, id) : null,
      resolved: done.has(id),
    };
    // Just the comment — the Ticket-Lage picks the ones that matter (by content), not the whole ticket.
    out[`jira-comment:${id}`] = { source: "jira-comment", comment };
  }
  // Everything else a ref can name (Teams, GitLab, mail): entity() knows each kind — no list of its own here.
  for (const ref of refs) {
    if (ref.startsWith("jira-comment:") || out[ref]) continue;
    const e = entity(ref);
    if (e) out[ref] = e;
  }
  return out;
}

/** The comments by these ids that are copies Zeff posted (see syncedContexts), with their originals' refs. */
export function commentCopies(ids: string[]): Map<string, string> {
  const { byComment } = syncedContexts();
  return new Map(
    ids.flatMap((id) =>
      byComment.has(id) ? [[id, byComment.get(id)!.ref] as const] : [],
    ),
  );
}
