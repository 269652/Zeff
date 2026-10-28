import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { off, type Helpers } from "./mcp";
import { defineFormulaMetric, formatMetric, getMetric, goalProgress, listMetrics, metricHistory, type Metric } from "./metrics";

/**
 * The Kennzahlen for agents: what there is (metric_list), one with how it is made and its history (metric_get), and a new one
 * from a formula (metric_define) — so an agent answers "how is my Sparquote?" from the number, not a guess, and can set one up
 * when asked. Reading is plain; defining changes the user's setup.
 */

const line = (m: Metric) => `- ${m.label} = ${formatMetric(m.value, m.unit)}${m.error ? ` (⚠ ${m.error})` : ""} — ${m.kind === "formula" ? `formula: ${m.formula}` : m.kind === "aggregate" ? `${m.agg} of ${m.sources?.length ?? 0} column(s)` : `from ${m.plugin}`}${m.what ? ` · ${m.what}` : ""}`;

export function registerMetricTools(server: McpServer, h: Helpers): void {
  server.registerTool(
    "metric_list",
    {
      title: "List the Kennzahlen",
      description:
        "The user's Kennzahlen (named numbers: Tilgungsrate, Sparquote, Stunden diese Woche, Offene Todos … and their own) with their value now, unit and how each is made. " +
        "Use them instead of working a number out yourself; in a page write [[metric:<key>|Label]] to show one live; in a database formula kennzahl(\"Name\").",
      inputSchema: z.object({ query: z.string().optional().describe("Only those whose name contains this.") }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query }) =>
      h.run(() => {
        const gone = off(h);
        if (gone) return gone;
        const q = (query ?? "").toLowerCase();
        const list = listMetrics().filter((m) => !q || m.label.toLowerCase().includes(q));
        return h.ok(list.length ? list.map(line).join("\n") : "No Kennzahlen yet.");
      }),
  );

  server.registerTool(
    "metric_get",
    {
      title: "Read a Kennzahl",
      description: "One Kennzahl by its name: its value now, how it is made (formula, columns, plugin), its goal and thresholds, and its value by day (history).",
      inputSchema: z.object({ name: z.string().min(1).describe("Its name, e.g. 'Sparquote'."), days: z.number().int().min(1).max(400).optional().describe("How many days of history (default 30).") }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ name, days }) =>
      h.run(() => {
        const gone = off(h);
        if (gone) return gone;
        const m = getMetric(name);
        if (!m) return h.fail(`No Kennzahl "${name}" — metric_list shows them.`);
        const g = goalProgress(m);
        const hist = metricHistory(m.key, days ?? 30);
        return h.ok(
          [
            line(m),
            m.sources?.length ? `Columns: ${m.sources.map((s) => `${s.text} (${s.value ?? "–"})`).join("; ")}` : "",
            m.goal ? `Goal: ${m.goal.dir === "atLeast" ? "at least" : "at most"} ${formatMetric(m.goal.target, m.unit)}${m.goal.by ? ` by ${m.goal.by}` : ""} — ${g ? (g.reached ? "reached" : `${formatMetric(g.gap, m.unit)} to go`) : "no value"}` : "",
            m.alert ? `Thresholds: ${[m.alert.below !== undefined ? `below ${m.alert.below}` : "", m.alert.above !== undefined ? `above ${m.alert.above}` : ""].filter(Boolean).join(", ")}` : "",
            hist.length ? `History: ${hist.map((x) => `${x.day} ${x.value}`).join(", ")}` : "No history yet (a value is kept each day).",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }),
  );

  server.registerTool(
    "metric_define",
    {
      title: "Make a Kennzahl from a formula",
      description:
        'A new Kennzahl made from others (and numbers) — e.g. name "Puffer in Monaten", formula (kennzahl("Ersparnisse") / kennzahl("Ausgaben")), unit "Monate". ' +
        "Only when the user asks for it. A column of a database becomes one in the table's ∑ row (Make available …), not here.",
      inputSchema: z.object({
        name: z.string().min(1).max(60),
        formula: z.string().min(1).describe('The formula — kennzahl("Name") reads another, + - * / and the functions of database formulas.'),
        unit: z.string().max(20).optional(),
        what: z.string().max(200).optional().describe("One line: what it is."),
      }),
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (args) =>
      h.run(() => {
        const gone = off(h);
        if (gone) return gone;
        const key = defineFormulaMetric({ label: args.name, formula: args.formula, unit: args.unit, what: args.what });
        const m = getMetric(key)!;
        return h.ok(`Kennzahl "${m.label}" made: ${formatMetric(m.value, m.unit)}${m.error ? ` (⚠ ${m.error})` : ""}. In a page: [[metric:${m.key}|${m.label}]].`);
      }),
  );
}
