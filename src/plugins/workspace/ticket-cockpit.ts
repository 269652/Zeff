import { newId, newProperty, newView, type Property, type View } from "./model";
import { daysSinceFormula } from "./formula";
import { relationSources, sourceTable } from "./source-table";
import { createPage } from "./store";

/**
 * The ticket cockpit: a database whose rows are tickets (the title is the key, PROJ-12) and whose figures are joined live from what Zeff
 * knows — booked hours, open merge requests, open todos, worker runs, the last Jira comment and the days it has been quiet. A gallery
 * view draws every ticket as one card; a table view shows the same. A source whose plugin is off is left out.
 */
export function createTicketCockpit(parentId: number | null): number {
  const have = new Set(relationSources().map((s) => s.id));
  const col = (src: string, name: string) => sourceTable(src)?.schema.properties.find((p) => p.name === name);
  const props: Property[] = [{ ...newProperty("Summary", "text") }];
  const relation = (src: string, label: string): Property | null => {
    const ticket = col(src, "Ticket");
    if (!have.has(src) || !ticket) return null;
    return { id: newId("p"), name: label, type: "relation", relationSource: src, match: { from: "title", to: ticket.id } };
  };
  const rollup = (name: string, rel: Property | null, property: string, fn: "count" | "sum" | "latest", filter?: { prop: string; value: string }): Property | null =>
    rel ? { id: newId("p"), name, type: "rollup", rollup: { relation: rel.id, property, fn, ...(filter ? { filter: { op: "and" as const, rules: [{ prop: filter.prop, cond: "is" as const, value: filter.value }] } } : {}) } } : null;

  const time = relation("time", "Bookings");
  const mrs = relation("mrs", "Merge requests");
  const todos = relation("todos", "Todos");
  const runs = relation("runs", "Worker runs");
  const comments = relation("jira-comments", "Jira comments");
  const rolls = [
    rollup("Hours", time, col("time", "Hours")?.id ?? "title", "sum"),
    rollup("Open MRs", mrs, "title", "count", col("mrs", "State") ? { prop: col("mrs", "State")!.id, value: "opened" } : undefined),
    rollup("Open todos", todos, "title", "count", col("todos", "Status") ? { prop: col("todos", "Status")!.id, value: "open" } : undefined),
    rollup("Workers", runs, "title", "count"),
    rollup("Last comment", comments, col("jira-comments", "Date")?.id ?? "title", "latest"),
  ].filter((p): p is Property => !!p);
  const quiet: Property[] = rolls.some((p) => p.name === "Last comment") ? [{ id: newId("p"), name: "Quiet days", type: "formula", formula: daysSinceFormula("Last comment") }] : [];

  const has = (n: string) => rolls.some((p) => p.name === n) || quiet.some((p) => p.name === n);
  const line = (n: string, tpl: string) => (has(n) ? tpl : "");
  const card = [
    "<row><b>{{ title }}</b><grow/>" + (has("Hours") ? "{{ Hours | hours }}" : "") + "</row>",
    "{{ Summary | clamp(2) }}",
    "<row gap=1>" + [line("Open MRs", "{{#if [Open MRs] > 0}}<badge>{{ [Open MRs] }} MR</badge>{{/if}}"), line("Open todos", "{{#if [Open todos] > 0}}<badge>{{ [Open todos] }} todos</badge>{{/if}}"), line("Workers", "{{#if Workers > 0}}<badge>{{ Workers }} runs</badge>{{/if}}")].filter(Boolean).join(" ") + "</row>",
    line("Quiet days", "{{#if [Quiet days] > 3}}<small>{{ [Quiet days] }} days without a comment</small>{{/if}}"),
  ].filter(Boolean).join("\n");

  const views: View[] = [
    { ...newView("Cockpit", "gallery"), card, sorts: has("Open todos") ? [{ prop: rolls.find((p) => p.name === "Open todos")!.id, dir: "desc" as const }] : [] },
    newView("All tickets", "table"),
  ];
  return createPage({
    parentId,
    kind: "database",
    title: "Ticket cockpit",
    icon: "🧭",
    schema: { titleName: "Ticket", properties: [...props, ...[time, mrs, todos, runs, comments].filter((p): p is Property => !!p), ...rolls, ...quiet], views },
  });
}
