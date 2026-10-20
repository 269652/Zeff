import { t } from "@/lib/i18n/server";
import { listGitlabItems } from "@/lib/gitlab/store";
import type { WorkspaceSource } from "@/plugins/workspace/source-point";

/**
 * The merge requests as something a database can join — by ticket (found in the branch or the title): "Open MRs" per ticket, who is the author,
 * when one was last touched. Read only; a relation with a rollup over it, no database made of it.
 */
const F = { ticket: "mrticket", ref: "mrref", project: "mrproject", state: "mrstate", branch: "mrbranch", author: "mrauthor", updated: "mrupdated", url: "mrurl" };
const KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;
export const ticketIn = (...texts: (string | null | undefined)[]): string => {
  for (const s of texts) {
    const m = KEY.exec(s ?? "");
    if (m) return m[1];
  }
  return "";
};

export function mrRecords() {
  return listGitlabItems({ kind: "mr", limit: 500 }).map((m) => ({
    ref: `mr:${m.key}`,
    title: m.title,
    fields: {} as Record<string, string>,
    updatedAt: m.updatedAt ?? undefined,
    typed: [
      { id: F.ticket, name: "Ticket", type: "text" as const, value: ticketIn(m.branch, m.title) },
      { id: F.ref, name: "MR", type: "text" as const, value: m.ref },
      { id: F.project, name: "Project", type: "text" as const, value: m.project },
      { id: F.state, name: "State", type: "text" as const, value: m.state ?? "" },
      { id: F.branch, name: "Branch", type: "text" as const, value: m.branch ?? "" },
      { id: F.author, name: "Author", type: "text" as const, value: m.author ?? "" },
      { id: F.updated, name: "Updated", type: "date" as const, value: (m.updatedAt ?? "").slice(0, 10) },
      { id: F.url, name: "Link", type: "url" as const, value: m.url },
    ],
  }));
}

export const MRS_SOURCE: WorkspaceSource = {
  id: "mrs",
  get label() {
    return t("Merge requests");
  },
  icon: "🔀",
  get hint() {
    return t("Your GitLab merge requests with their ticket, state and branch — tickets can count the open ones.");
  },
  columns: [
    { id: F.ticket, name: "Ticket", type: "text" },
    { id: F.ref, name: "MR", type: "text" },
    { id: F.project, name: "Project", type: "text" },
    { id: F.state, name: "State", type: "text" },
    { id: F.branch, name: "Branch", type: "text" },
    { id: F.author, name: "Author", type: "text" },
    { id: F.updated, name: "Updated", type: "date" },
    { id: F.url, name: "Link", type: "url" },
  ],
  count: () => listGitlabItems({ kind: "mr", limit: 500 }).length,
  read: mrRecords,
  table: mrRecords,
  relationOnly: true,
  noNewRows: true,
};
