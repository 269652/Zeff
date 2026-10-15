/**
 * Ticket keys: Jira's (PROJ-123) and your own — Kanban's cards (KB-12, also once moved into the
 * Workspace) and Workspace rows (WS-7) — the same shape, so they flow alike into todos, the Lage,
 * entries; but only Jira's go to Jira.
 */
export const isKanbanKey = (k: string | null | undefined) => !!k && /^KB-\d+$/i.test(k.trim());
export const isTicketKey = (k: string | null | undefined) => !!k && /^[A-Z][A-Z0-9]+-\d+$/i.test(k.trim());
export const isWorkspaceKey = (k: string | null | undefined) => !!k && /^WS-\d+$/i.test(k.trim());
/** One of your own tickets in Zeff (a card or a row), not Jira's. */
export const isOwnKey = (k: string | null | undefined) => isKanbanKey(k) || isWorkspaceKey(k);
export const isJiraKey = (k: string | null | undefined) => isTicketKey(k) && !isOwnKey(k);
