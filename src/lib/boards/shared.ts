/**
 * The Boards tab — your tickets gone through the Claude CLI: what happened, what's to do. The
 * parts pages, the MCP server and the run share (client-safe: no DB access here).
 */
// Split and moved: the runs' parts to @/lib/runs/shared, the todos' to @/lib/todos/shared; kept for the importers outside this repo.
export { TODO_KINDS, TODO_KIND_LABELS, todoKindLabels, isTodoKind, DELIVERY_OP_TYPES, TODO_OP_TYPES, opLabel, opTitle, opsSettle, asksForApproval, opsButton, opNote, cleanOps, OP_CATALOG, TODO_OPS_SCHEMA, opPlugin, setOpsDictionaryExtras, opsDictionary, noteSyncState, cleanPlan, planLine, AGENT_INSTRUCTION_DEFAULTS, todoRef, parseTodoRef, sourceKey, sourcesOf, jiraCommentUrl, dueDay, mergeJiraNotes } from "@/lib/todos/shared";
export type { TodoKind, TodoStatus, TodoOpMap, TodoOp, TodoView, TodoAlternative, TodoStep, TodoUserNote, TodoLinks, TodoPath, JiraCommentView, SyncedComment, TodoSource } from "@/lib/todos/shared";
export { ATTENTIONS, attentionLabels, isAttention, TICKET_ACTION_TYPES, BOARD_RESULT_SCHEMA } from "@/lib/runs/shared";
export type { Attention, BoardTicket, TicketAction, TicketQuestion, BoardResult, BoardRunView } from "@/lib/runs/shared";
