/** Structured questions: what an answer brings, as the chat shows it (client-safe). */

/** A query as it ran: its view, the filters as checked, its grouping, aggregation and measure. */
export type QuerySpec = {
  view: string;
  filters: Record<string, unknown>;
  groupBy?: string;
  aggregate: string;
  measure?: string;
  order: "desc" | "asc";
  limit: number;
};

/** One group of a grouped query: its key (a ticket, a month …), its aggregate and how many items are in it. */
export type QueryGroup = { key: string; value: number | string | null; count: number };

/** A row behind a result: when, what, its entity ref and its link (null: none in Zeff), its measure, its group. */
export type QueryRow = { at: string; title: string; ref: string; href: string | null; value?: number; group?: string };

/** A query's result: the query, "how it was computed" in one line, the total, the groups (the first `limit`) and the rows behind them. */
export type QueryResultView = {
  query: QuerySpec;
  explain: string;
  total: { count: number; value: number | string | null };
  groups: QueryGroup[];
  /** How many groups there were (more than shown: `groups` is cut at the query's limit). */
  groupsTotal: number;
  rows: QueryRow[];
};

/** A cited row of an answer: its number in the text ([1]), title, link and where it is from. */
export type StructuredSource = { n: number; title: string; url: string; heading: string; excerpt: string };

/** An answer from the data: the text (citing [n]), the rows cited, and the queries it was computed from. */
export type StructuredAnswer = { answer: string; sources: StructuredSource[]; queries: QueryResultView[]; model: string | null; durationMs: number | null };
