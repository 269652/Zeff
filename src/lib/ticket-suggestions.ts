import { jobNumbersByTicket, listWeekTickets, type TicketSuggestion } from "./entries";
import { jobsByNumber } from "./jobs";
import { ticketSuggestions as jiraTicketSuggestions } from "./jira/store";
import type { WeekInfo } from "./week";

/**
 * Ticket suggestions for the entry form: the week's booked tickets first (they
 * carry a real job + description), then open Jira tickets not already listed.
 * Each carries the job to auto-select (linked job, else booking history).
 */
export function getEntryTicketSuggestions(week: WeekInfo): TicketSuggestion[] {
  const byKey = new Map<string, TicketSuggestion>();
  for (const t of listWeekTickets(week)) byKey.set(t.ticket.toLowerCase(), t);
  let history: Map<string, string> | undefined;
  const jobs = jobsByNumber();
  for (const j of jiraTicketSuggestions()) {
    const key = j.ticket.toLowerCase();
    if (byKey.has(key)) continue;
    const jobNumber = j.jobNumber ?? (history ??= jobNumbersByTicket()).get(j.ticket.trim().toLowerCase());
    const job = jobNumber ? jobs.get(jobNumber.trim().toLowerCase()) : undefined;
    byKey.set(key, {
      ticket: j.ticket,
      jobId: job?.id ?? 0,
      jobNumber: jobNumber ?? "",
      jobName: job?.name ?? "",
      description: j.summary,
      assignee: j.assignee,
      mine: j.mine,
    });
  }
  return [...byKey.values()].sort((a, b) => a.ticket.localeCompare(b.ticket, undefined, { numeric: true }));
}
