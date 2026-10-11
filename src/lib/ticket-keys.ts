/**
 * Ticket keys: Jira's (PROJ-123) and Kanban's own cards (KB-12) — the same shape, so they flow
 * alike into todos, the Lage, entries; but only Jira's go to Jira.
 */
export const isKanbanKey = (k: string | null | undefined) => !!k && /^KB-\d+$/i.test(k.trim());
export const isTicketKey = (k: string | null | undefined) => !!k && /^[A-Z][A-Z0-9]+-\d+$/i.test(k.trim());
export const isJiraKey = (k: string | null | undefined) => isTicketKey(k) && !isKanbanKey(k);
