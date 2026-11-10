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
        page: z.union([z.number().int(), z.string()]).optional().describe("A page (id or title) to put it into as a block."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ title, html, libs, writes, ai, page }: { title: string; html: string; libs?: string[]; writes?: (number | string)[]; ai?: boolean; page?: number | string }) =>
      h.run(() => {
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
        const wants = wantsOf(ids, ai);
        let placed = "";
        let pageId: number | null = null;
        if (page !== undefined) {
          const p = findPage(page);
          if (!p || p.kind === "database") return h.fail(`No page "${page}" (a database's widget goes on a page or a row).`);
          if (p.locked) return h.fail("That page is locked by the user.");
          const keep = p.content.content.filter((n, i, all) => !(i === all.length - 1 && n.type === "paragraph" && !n.content));
          const node = { type: "zeffApp", attrs: { title, prompt: "", html, libs: (libs ?? []).join(","), writes: wants.writes.join(","), ai: !!wants.ai, state: "" } };
          store.updatePage(p.id, { content: { type: "doc", content: [...keep, node] } });
          pageId = p.id;
          placed = ` Put into page ${p.id} "${p.title || "Untitled"}" as a block: /workspace/${p.id}.`;
        }
        const key = widgetKey(html);
        const embed: WidgetEmbed = { kind: "widget", href: `#widget-${key}`, title, html, libs: libs ?? [], writes: wants.writes, ai: !!wants.ai, pageId };
        const asks = wants.writes.length || wants.ai ? " It asks the user to allow what it writes — they see an Allow button on it; until then its writes are refused." : "";
        return withEmbeds(h.ok(`Widget "${title}" ready.${placed}${asks} In the Workspace assistant the user sees it under your answer — don't describe its code.`), [embed]);
      }),
  );
}
