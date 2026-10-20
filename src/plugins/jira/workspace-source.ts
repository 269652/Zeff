import { getDb, schema } from "@/db";
import { t } from "@/lib/i18n/server";
import type { WorkspaceSource } from "@/plugins/workspace/source-point";

/**
 * The comments on Jira tickets as something a database can join, by ticket: the date of the last comment (days since the customer wrote),
 * how many there are, who wrote them. Read only.
 */
const F = { ticket: "jcticket", author: "jcauthor", date: "jcdate" };

export function commentRecords() {
  return getDb()
    .select()
    .from(schema.jiraComments)
    .all()
    .map((c) => ({
      ref: `jira-comment:${c.id}`,
      title: c.body.replace(/\s+/g, " ").slice(0, 120),
      fields: {} as Record<string, string>,
      updatedAt: c.at,
      typed: [
        { id: F.ticket, name: "Ticket", type: "text" as const, value: c.ticket },
        { id: F.author, name: "Author", type: "text" as const, value: c.author },
        { id: F.date, name: "Date", type: "date" as const, value: c.at.slice(0, 10) },
      ],
    }));
}

export const JIRA_COMMENTS_SOURCE: WorkspaceSource = {
  id: "jira-comments",
  get label() {
    return t("Jira comments");
  },
  icon: "💬",
  get hint() {
    return t("The comments on your Jira tickets — tickets can show the date of the last one or count them.");
  },
  columns: [
    { id: F.ticket, name: "Ticket", type: "text" },
    { id: F.author, name: "Author", type: "text" },
    { id: F.date, name: "Date", type: "date" },
  ],
  count: () => getDb().select().from(schema.jiraComments).all().length,
  read: commentRecords,
  table: commentRecords,
  relationOnly: true,
  noNewRows: true,
};
