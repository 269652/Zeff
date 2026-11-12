import { listGitlabItems } from "@/lib/gitlab/store";
import { gitlabMarkdown } from "@/lib/gitlab/shared";
import type { WorkspaceSource } from "@/plugins/workspace/source-point";
import { ticketIn } from "./workspace-source";

/**
 * The synced GitLab items — merge requests, their comments, your branches — as the source of GitLab's own database in the Workspace: the rows
 * its app view shows (view-template.meta.ts), the text of each as Markdown. Read only: what is done in GitLab are the flows gitlab.reply,
 * gitlab.resolve, gitlab.merge.
 */
const F = { key: "glkey", kind: "glkind", project: "glproject", ref: "glref", author: "glauthor", state: "glstate", branch: "glbranch", ticket: "glticket", at: "glat", updated: "glupdated", context: "glcontext", link: "gllink", body: "glbody" };

export function itemRecords() {
  return listGitlabItems({ limit: 500 }).map((i) => {
    const at = i.kind === "comment" ? i.createdAt : i.updatedAt;
    return {
      ref: `gitlab:${i.key}`,
      title: i.title || i.ref,
      fields: {} as Record<string, string>,
      url: i.url,
      text: gitlabMarkdown(i),
      updatedAt: `${i.updatedAt ?? ""}|${i.state ?? ""}|${i.resolvedAt ?? ""}|${i.inContext ? 1 : 0}`,
      dataType: "gitlab" as const,
      typed: [
        { id: F.key, name: "Item", type: "text" as const, value: i.key },
        { id: F.kind, name: "Kind", type: "text" as const, value: i.kind },
        { id: F.project, name: "Project", type: "text" as const, value: i.project },
        { id: F.ref, name: "Ref", type: "text" as const, value: i.ref },
        { id: F.author, name: "Author", type: "text" as const, value: i.author ?? "" },
        { id: F.state, name: "State", type: "text" as const, value: i.state ?? "" },
        { id: F.branch, name: "Branch", type: "text" as const, value: i.branch ?? "" },
        { id: F.ticket, name: "Ticket", type: "text" as const, value: ticketIn(i.branch, i.title) },
        { id: F.at, name: "When", type: "text" as const, value: at ?? "" },
        { id: F.updated, name: "Updated", type: "date" as const, value: at ? at.slice(0, 10) : null },
        { id: F.context, name: "In context", type: "checkbox" as const, value: i.inContext || null },
        { id: F.link, name: "Link", type: "url" as const, value: i.url },
        { id: F.body, name: "Body", type: "text" as const, value: gitlabMarkdown(i) },
      ],
    };
  });
}

export const GITLAB_ITEMS_SOURCE: WorkspaceSource = {
  id: "gitlab-items",
  label: "GitLab",
  icon: "🦊",
  dataType: "gitlab",
  hint: "Your merge requests, their comments and your branches, synced from GitLab — GitLab's app in the Workspace.",
  read: itemRecords,
  count: () => listGitlabItems({ limit: 500 }).length,
  noNewRows: true,
  lockedFields: Object.values(F),
};
