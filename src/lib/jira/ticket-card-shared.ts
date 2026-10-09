import type { JiraStatusCategory } from "@/db/schema";

/** What the ticket hover card shows — server-free, so client components can take it as a prop. */
export type TicketCard = {
  key: string;
  /** The ticket in Jira (stored browse URL, else derived from the other tickets' base URL). */
  url: string | null;
  /** Whether Zeff has the ticket from a Jira sync (else only the key and the link are known). */
  synced: boolean;
  summary: string;
  description: string | null;
  status: string;
  statusCategory: JiraStatusCategory;
  issueType: string | null;
  priority: string | null;
  assignee: string | null;
  openedAt: string | null;
  resolvedAt: string | null;
  /** The Zeff job the ticket books on, when set on the Jira tab. */
  jobNumber: string | null;
};
