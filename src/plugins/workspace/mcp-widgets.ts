/**
 * The assistant's widget tools: workspace_widget_docs (how to write one — lib/widgets/guide.ts) and workspace_widget (show
 * one in the answer — the Workspace assistant draws it, chat-embed.ts — and/or put it into a page as a block). What it
 * asks to write to is only asked: the user allows it on the widget (widget-bridge.ts). Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { WIDGET_GUIDE } from "@/lib/widgets/guide";
import { wantsOf, widgetKey } from "@/lib/widgets/bridge";
import { WIDGET_LIBS } from "@/lib/widgets/sandbox";
import { withEmbeds, type WidgetEmbed } from "./chat-embed";
import { findPage, off, type Helpers } from "./mcp";
import { widgetProblem } from "./widget-make";
import * as store from "./store";

export function registerWidgetTools(server: McpServer, h: Helpers): void {
  server.registerTool(
    "workspace_widget_outputs",
    {
      title: "Values widgets published",
      description:
        "What widgets published for the whole of Zeff (zeff.publish): numbers, texts, lists, tables — results a calculator, a simulation or a form worked out. Without name: the list (name, kind, unit, which widget, when); with name: that value whole. Numbers are Kennzahlen too (kennzahl(\"name\") in formulas).",
      inputSchema: z.object({ name: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ name }: { name?: string }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const o = await import("./widget-outputs");
        if (name) {
          const v = o.getOutput(name);
          return v ? h.ok(`${v.label} (${v.kind}${v.unit ? `, ${v.unit}` : ""}; from „${v.widget || "a widget"}“${v.pageId ? ` on page ${v.pageId}` : ""}, ${v.updatedAt}):\n${JSON.stringify(v.value, null, 2).slice(0, 40000)}`) : h.fail(`No value "${name}" published.`);
        }
        const all = o.listOutputs({ values: false });
        return h.ok(all.length ? all.map((v) => `- ${v.key}${v.label !== v.key ? ` „${v.label}“` : ""} — ${v.kind}${v.unit ? ` (${v.unit})` : ""}, from „${v.widget || "a widget"}“${v.pageId ? ` (page ${v.pageId})` : ""}, ${v.updatedAt}`).join("\n") : "No widget published a value yet.");
      }),
  );

  server.registerTool(
    "workspace_output_to_database",
    {
      title: "Pour a published table into a database",
      description:
        "Adds the rows of a table a widget published (a list of objects — workspace_widget_outputs) to a database: each object a row, its keys the fields by name (the title under \"title\", \"Name\" or the database's title name). map renames keys first: { \"key in the table\": \"Field\" }. Missing fields are named back, not made.",
      inputSchema: z.object({ name: z.string(), database: z.union([z.number().int(), z.string()]), map: z.record(z.string(), z.string()).optional(), limit: z.number().int().min(1).max(2000).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ name, database, map, limit }: { name: string; database: number | string; map?: Record<string, string>; limit?: number }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const o = await import("./widget-outputs");
        const v = o.getOutput(name);
        if (!v) return h.fail(`No value "${name}" published.`);
        const rows = o.tableRows(v.value).slice(0, limit ?? 2000);
        if (!rows.length) return h.fail(`"${v.label}" is a ${v.kind}, not a table (a list of rows).`);
        const p = findPage(database);
        const d = p?.kind === "database" ? store.getDatabase(p.id) : null;
        if (!p || !d) return h.fail(`No database "${database}".`);
        const { valuesToCells } = await import("./mcp-db");
        let schema = d.schema;
        const notes = new Set<string>();
        let added = 0;
        for (const raw of rows) {
          const r = Object.fromEntries(Object.entries(raw).map(([k, x]) => [map?.[k] ?? k, x]));
          const titleKey = Object.keys(r).find((k) => ["title", "name", schema.titleName.toLowerCase()].includes(k.toLowerCase()));
          const title = titleKey ? String(r[titleKey] ?? "") : "";
          const rest = Object.fromEntries(Object.entries(r).filter(([k]) => k !== titleKey).map(([k, x]) => [k, x && typeof x === "object" && !Array.isArray(x) ? JSON.stringify(x) : x]));
          const c = await valuesToCells(schema, rest);
          if (c.schema !== schema) schema = store.updateSchema(p.id, c.schema);
          c.notes.forEach((x) => notes.add(x));
          store.addRow(p.id, { title, cells: c.cells });
          added++;
        }
        return h.ok(`Added ${added} row(s) from „${v.label}“ to „${p.title}“.${notes.size ? ` Left out: ${[...notes].slice(0, 10).join("; ")}.` : ""}`);
      }),
  );

  server.registerTool(
    "workspace_widget_docs",
    {
      title: "How to write a widget",
      description:
        "Read this before workspace_widget: how a widget (a small interactive app — a form that writes into a database, a live table, a chart, a calculator, a quiz) is written — its sandbox, Zeff's data bridge (zeff.db.rows / add / update, zeff.state, zeff.ai), the kit's ready parts (ZeffKit.form, ZeffKit.table, ZeffKit.stats) and the libraries.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => h.run(() => off(h) ?? h.ok(WIDGET_GUIDE)),
  );

  server.registerTool(
    "workspace_widget",
    {
      title: "Show or place a widget",
      description:
        "Build a widget (read workspace_widget_docs first): one HTML fragment with its script, run in a sandbox with Zeff's data bridge. It is shown under your answer in the Workspace assistant; with page it is also put into that page as a block (at the end) so it stays. " +
        "writes: the databases (ids or titles) it adds rows to or changes — the user is asked once to allow it; ai: whether it calls zeff.ai. Use it when an interactive thing helps more than text: a form that fills a database, a calculator, a chart of a table, a tracker.",
      inputSchema: z.object({
        title: z.string().min(1).max(80),
        html: z.string().min(1).max(300000),
        libs: z.array(z.enum(Object.keys(WIDGET_LIBS) as [string, ...string[]])).max(4).optional(),
        writes: z.array(z.union([z.number().int(), z.string()])).max(10).optional(),
        ai: z.boolean().optional(),
        flows: z.array(z.string()).max(20).optional().describe("The flows it runs (zeff.flow.run) — the user allows them."),
        page: z.union([z.number().int(), z.string()]).optional().describe("A page (id or title) to put it into as a block."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ title, html, libs, writes, ai, flows, page }: { title: string; html: string; libs?: string[]; writes?: (number | string)[]; ai?: boolean; flows?: string[]; page?: number | string }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const ids: number[] = [];
        for (const w of writes ?? []) {
          const p = findPage(w);
          if (!p || p.kind !== "database") return h.fail(`writes: no database "${w}".`);
          ids.push(p.id);
        }
        const problem = widgetProblem({ html, writes: ids });
        if (problem) return h.fail(`The widget can't run: ${problem}.`);
        const wants = wantsOf(ids, ai, flows);
        const { flowByName } = await import("./flows/store");
        const noFlow = (wants.flows ?? []).filter((f) => !flowByName(f));
        if (noFlow.length) return h.fail(`flows: there is no flow ${noFlow.join(", ")}.`);
        let placed = "";
        let pageId: number | null = null;
        if (page !== undefined) {
          const p = findPage(page);
          if (!p || p.kind === "database") return h.fail(`No page "${page}" (a database's widget goes on a page or a row).`);
          if (p.locked) return h.fail("That page is locked by the user.");
          const keep = p.content.content.filter((n, i, all) => !(i === all.length - 1 && n.type === "paragraph" && !n.content));
          const node = { type: "zeffApp", attrs: { title, prompt: "", html, libs: (libs ?? []).join(","), writes: wants.writes.join(","), ai: !!wants.ai, flows: (wants.flows ?? []).join(","), state: "" } };
          store.updatePage(p.id, { content: { type: "doc", content: [...keep, node] } });
          pageId = p.id;
          placed = ` Put into page ${p.id} "${p.title || "Untitled"}" as a block: /workspace/${p.id}.`;
        }
        const key = widgetKey(html);
        const embed: WidgetEmbed = { kind: "widget", href: `#widget-${key}`, title, html, libs: libs ?? [], writes: wants.writes, ai: !!wants.ai, ...(wants.flows ? { flows: wants.flows } : {}), pageId };
        const asks = wants.writes.length || wants.ai || wants.flows?.length ? " It asks the user to allow what it writes — they see an Allow button on it; until then its writes are refused." : "";
        return withEmbeds(h.ok(`Widget "${title}" ready.${placed}${asks} In the Workspace assistant the user sees it under your answer — don't describe its code.`), [embed]);
      }),
  );
}
