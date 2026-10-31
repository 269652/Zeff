import type { DbSchema, DetailModule } from "./schema";

// ---------------------------------------------------------------------------
// A row's detail view: the modules its database shows
// ---------------------------------------------------------------------------

/**
 * What a row's detail view shows, in order: the database's choice — else by its kind: a database a sync keeps from Jira the
 * briefing panel as Jira Lage had it; a board its cards' briefing and todos; any other its properties and page.
 */
export function detailModules(schema: DbSchema, source: string | null | undefined): DetailModule[] {
  if (schema.detail) return schema.detail;
  // A plugin's custom view of the rows (a person) is a block of the row's own page.
  if (schema.dataType === "people" || schema.dataType === "cases") return ["page"];
  // An appointment of the calendar database: what you should know before it, first.
  if (schema.dataType === "calendar") return ["properties", "know", "page"];
  if (source === "jira") return ["properties", "know", "briefing", "todos", "questions", "actions", "flags", "context", "chat", "timeline"];
  // A database that receives rows from others: the linked ticket first, then what Zeff knows of it (by the key the copy carries).
  if (schema.receive) return ["properties", "source", "briefing", "todos", "context", "page"];
  const status = schema.properties.find((p) => p.type === "status");
  const board = !!status && schema.views.some((v) => v.type === "board" && v.groupBy === status.id);
  // Subtasks: on a board (as Kanban had them), and wherever rows have a parent already.
  const parents = schema.properties.some((p) => p.type === "relation" && p.relationDb !== undefined && !p.backOf && p.name === "Parent");
  return board ? ["properties", "subtasks", "briefing", "todos", "page"] : parents ? ["properties", "subtasks", "page"] : ["properties", "page"];
}

/** A module shown (at the end) or not any more. */
export const toggleDetail = (list: DetailModule[], m: DetailModule): DetailModule[] => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);

/** A module one place up (-1) or down (1). */
export function moveDetail(list: DetailModule[], m: DetailModule, dir: -1 | 1): DetailModule[] {
  const i = list.indexOf(m);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
