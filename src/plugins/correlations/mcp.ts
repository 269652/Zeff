import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isInstalled } from "@/plugins/state";

type Helpers = {
  run: (fn: () => unknown) => Promise<never>;
  ok: (text: string) => never;
  fail: (text: string) => never;
};

/**
 * The Correlations plugin's MCP tool: `correlations` — what goes with a series (a journal's energy or mood) in the user's days, as
 * computed numbers, so an agent (the journal's weekly and monthly reviews) quotes findings instead of guessing them. One pair can be
 * asked for too, and is answered whether it holds or not.
 */
export function registerCorrelationTools(server: McpServer, h: Helpers): void {
  server.registerTool(
    "correlations",
    {
      title: "Correlations in the user's days",
      description:
        "What goes with a daily series in the user's data — e.g. a journal's Energy or Mood against meeting hours, booked hours, messages received/sent, todos, spending, first/last activity and the other fields of their Workspace databases, same day and the day after. " +
        "Computed in code (Spearman/Pearson, group comparisons, a permutation test with Benjamini–Hochberg); only findings that hold are listed, each as a sentence with n, ρ and the groups' means — quote them as they are. " +
        "No findings means nothing reliable: say so, don't invent patterns. Give `other` to ask about one pair (answered whether it holds or not).",
      inputSchema: z.object({
        database: z.string().optional().describe("The Workspace database's name, e.g. 'Einträge' or 'Journal' (leave out for Zeff's own series like 'Meeting hours')."),
        field: z.string().min(1).describe("The field (property) of that database, e.g. 'Energy' or 'Mood'; a tag as 'Tags: Family'; or a series id."),
        days: z.number().int().min(14).max(3650).optional().describe("The period: the last N days up to `to` (default 90)."),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start day (YYYY-MM-DD) instead of days."),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End day (YYYY-MM-DD), default today."),
        other: z.string().optional().describe("One other series to compare with (its label, e.g. 'Meeting hours' or 'Journal › Tags: Work', or its id)."),
        limit: z.number().int().min(1).max(20).optional().describe("How many findings at most (default 8)."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ database, field, days, from, to, other, limit }) =>
      h.run(async () => {
        if (!isInstalled("correlations")) return h.fail("Correlations is not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const { correlationReport, comparePair, findSeries, pairText, period, reportText, targetChoices } = await import("./report");
        const p = period({ days, from, to });
        const res = await correlationReport({ database, field }, p, { limit });
        if ("error" in res) {
          const names = targetChoices(res.all).map((s) => s.label);
          return h.fail(`${res.error} ${names.length ? `Series with values from ${p.from} to ${p.to}: ${names.join("; ")}.` : "No series has values in this period."}`);
        }
        if (other) {
          const x = findSeries(res.all, { field: other });
          if (!x) return h.fail(`There is no series “${other}”. Series: ${targetChoices(res.all).map((s) => s.label).join("; ")}.`);
          const y = findSeries(res.all, { database, field })!;
          const inPeriod = (s: typeof y) => ({ ...s, values: new Map([...s.values].filter(([d]) => d >= p.from && d <= p.to)) });
          return h.ok([0, 1].map((lag) => pairText(x, y, lag as 0 | 1, comparePair(lag ? x : inPeriod(x), inPeriod(y), lag as 0 | 1))).join("\n"));
        }
        return h.ok(reportText(res.report));
      }),
  );
}
