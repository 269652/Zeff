import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { errorMessage } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";
import type { QueryResultView } from "./shared";

type Helpers = {
  run: (fn: () => unknown) => Promise<never>;
  ok: (text: string) => never;
  fail: (text: string) => never;
};

/** A result as an agent reads it: how it was computed, the total, the groups, the rows with their refs and links. */
export function resultText(r: QueryResultView): string {
  const lines = [`Query: ${r.explain}`, `Total: ${r.query.aggregate}${r.query.measure ? `(${r.query.measure})` : ""} = ${r.total.value ?? "—"} over ${r.total.count} rows`];
  if (r.groups.length) {
    lines.push(`Groups (${r.groupsTotal}${r.groupsTotal > r.groups.length ? `, first ${r.groups.length}` : ""}):`);
    for (const g of r.groups) lines.push(`- ${g.key}: ${g.value ?? "—"} (${g.count})`);
  }
  if (r.rows.length) {
    lines.push("Rows:");
    for (const x of r.rows) lines.push(`- ${x.at.slice(0, 16).replace("T", " ")} · ${x.title}${x.value !== undefined ? ` · ${x.value}` : ""} · ${x.ref}${x.href ? ` ${x.href}` : ""}`);
  }
  return lines.join("\n");
}

/**
 * Structured questions over the MCP: ask_structured — a question answered from the user's data by the AI (plan, run,
 * phrase), or a query an agent writes itself (run as it is, no AI), or, with nothing, the views it can ask. Registered
 * where Zeff's other tools are; while the plugin isn't installed it says so.
 */
export function registerQuestionTools(server: McpServer, h: Helpers): void {
  server.registerTool(
    "ask_structured",
    {
      title: "Ask the user's own data (numbers and dates)",
      description:
        "Questions about numbers and dates in the user's own data — booked hours per ticket/project/week, bank transactions per counterparty/month, calendar events (how often, when last), todos, mails and messages per person/date, Workspace databases. " +
        "Either `question` (in words; Zeff's AI plans the query, runs it and answers citing the rows) or `query` (you write it: { view, filters: { name: value }, groupBy?, aggregate: count|sum|avg|min|max|first|last|count_days|list, measure?, order?, limit? } — runs as it is, no AI). " +
        "Call it with neither to list the views with their filters, groupings and measures. Read-only; every answer shows the query it was computed from.",
      inputSchema: z.object({
        question: z.string().max(2000).optional(),
        query: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ question, query }: { question?: string; query?: Record<string, unknown> }) =>
      h.run(async () => {
        if (!isInstalled("questions")) return h.fail("Structured questions are not installed in Zeff (Menu → Plugins) — this tool isn't available.");
        const ctx = { via: "mcp" as const };
        const { listViews, runQuery } = await import("./views");
        if (query) {
          try {
            return h.ok(resultText(await runQuery(query, ctx)));
          } catch (err) {
            return h.fail(errorMessage(err));
          }
        }
        if (question?.trim()) {
          const { askStructured } = await import("./ask");
          const r = await askStructured(question.trim(), [], { context: ctx });
          if (r.kind === "text") return h.ok(`That isn't a question about the data${r.why ? ` (${r.why})` : ""} — try search_knowledge.`);
          const src = r.answer.sources.map((s) => `[${s.n}] ${s.title}${s.url ? ` ${s.url}` : ""}`);
          return h.ok([r.answer.answer, src.length ? `\nSources:\n${src.join("\n")}` : "", "", ...r.answer.queries.map(resultText)].join("\n"));
        }
        const views = listViews(ctx).map((v) => {
          const f = Object.entries(v.filters).map(([k, s]) => `${k} (${s.type}${s.values ? `: ${s.values.join("|")}` : ""}${s.required ? ", required" : ""})`);
          return `## ${v.name}\n${v.description}\nfilters: ${f.join(", ") || "none"}\ngroupBy: ${v.dynamic ? "the database's property names, " : v.dims.join(", ") + ", "}day, week, month, year, weekday\nmeasures: ${v.dynamic ? "the database's number properties" : Object.keys(v.measures).join(", ") || "none (count)"}`;
        });
        return h.ok(views.join("\n\n"));
      }),
  );
}
