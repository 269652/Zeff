/** Structured questions: the shapes of the query layer's views and queries (views.ts), and the views' text helpers. Server only. */

/** Who asks — the knowledge chat, an agent over the MCP, a test. Handed to the sensitivity hook and to every view. */
export type QueryContext = { via: "chat" | "mcp" | "ui" | "test"; agent?: string; now?: Date };

export const AGGREGATES = ["count", "sum", "avg", "min", "max", "first", "last", "count_days", "list"] as const;
export type Aggregate = (typeof AGGREGATES)[number];

/** The groupings every view has: by the item's time. */
export const TIME_DIMS = ["day", "week", "month", "year", "weekday"] as const;

/**
 * A filter's type: date (YYYY-MM-DD; a year or a month stand for their first or last day), text (a part of it, any case),
 * texts (any of several parts), number, enum (one of `values`), boolean, conditions (a Workspace database's property
 * conditions: [{ prop, op, value }]).
 */
export type FilterType = "date" | "text" | "texts" | "number" | "enum" | "boolean" | "conditions";
export type FilterSpec = { type: FilterType; description: string; values?: readonly string[]; required?: boolean };

/** One thing a view holds, as the aggregation sees it: its time, its title, its ref (and link), its numbers and its groupable texts. */
export type Item = { at: string; title: string; ref: string; href?: string | null; values: Record<string, number>; dims: Record<string, string> };

export type Condition = { prop: string; op: "contains" | "is" | "is_not" | "gt" | "lt" | "gte" | "lte" | "empty" | "not_empty"; value?: string };
export type Filters = Record<string, string | string[] | number | boolean | Condition[]>;

export type QueryView = {
  name: string;
  /** For the AI: what it holds and what it answers (German or English — the planner reads both). */
  description: string;
  /** Offered only while this plugin is installed. */
  plugin?: string;
  filters: Record<string, FilterSpec>;
  /** What its items can be grouped by, besides the time (TIME_DIMS). */
  dims: string[];
  /** What can be added up: name → what it is. The first is the default. */
  measures: Record<string, string>;
  /** Its dims and measures are the items' own (a Workspace database's properties) — checked when it runs. */
  dynamic?: boolean;
  items: (filters: Filters, ctx: QueryContext) => Item[] | Promise<Item[]>;
};

export type Query = { view: string; filters: Filters; groupBy?: string; aggregate: Aggregate; measure?: string; order: "desc" | "asc"; limit: number };

/** Text helpers for the views: a part of a text, any case; any of several. */
export const has = (text: string | null | undefined, part: string): boolean => String(text ?? "").toLowerCase().includes(part.toLowerCase());
export const hasAny = (text: string | null | undefined, parts: string[]): boolean => parts.some((p) => has(text, p));
