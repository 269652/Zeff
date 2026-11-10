/**
 * The assistant's tools for blocks of your own (blocks.ts): how one is made (workspace_block_docs), which there are
 * (workspace_blocks), making or changing one with its flows (workspace_save_block — checked before anything is kept), removing
 * one. What its flows may reach is only asked for, as with any flow: the user grants it in the Studio. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { blockFlowName, blockSignature, BLOCK_PARAM_TYPES } from "./blocks";
import { findPage, off, type Helpers } from "./mcp";

const node = z.record(z.string(), z.unknown());

export function registerBlockTools(server: McpServer, h: Helpers): void {
  server.registerTool(
    "workspace_block_docs",
    {
      title: "How to make a block",
      description:
        "Read this before workspace_save_block: how a block of your own is made — a reusable building block of the view language (parameters, a template, its own state per use, slots) with flows for what it does on the server; and the blocks there are. The view language itself: workspace_view_template_docs.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const { blockReference } = await import("./view-template");
        return h.ok(blockReference((await import("./block-store")).listBlocks()));
      }),
  );

  server.registerTool(
    "workspace_blocks",
    {
      title: "The blocks of your own",
      description: "The blocks there are (how each is used: <use block=… …/>, what it is) — or one block by its name: its whole definition (params, template, example) and its flows.",
      inputSchema: z.object({ name: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ name }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const s = await import("./block-store");
        if (name) {
          const b = s.getBlock(name);
          if (!b) return h.fail(`There is no block “${name}”.`);
          const flows = await s.blockFlows(b.name);
          return h.ok(`${JSON.stringify(b, null, 2)}\n\nFLOWS: ${flows.length ? flows.map((f) => `${f.name} (page ${f.pageId}) — run="@${f.name.slice(blockFlowName(b.name, "").length)}"`).join(", ") : "none"}`);
        }
        const all = s.listBlocks();
        return h.ok(all.length ? all.map((b) => `- ${blockSignature(b)} — ${b.description || b.title || ""}`).join("\n") : "No blocks yet — workspace_block_docs tells how to make one.");
      }),
  );

  server.registerTool(
    "workspace_save_block",
    {
      title: "Make or change a block",
      description:
        "Makes a block of your own or replaces one (by its name) — read workspace_block_docs first. It is drawn as it would be used (its example, on `database`'s rows when given) and kept only without mistakes: each is named by line. " +
        "flows: its server side, saved with it as block.<name>.<flow> (called from its template as run=\"@flow\" / <data flow=\"@flow\">); their permissions are only asked for — the user grants them in the Studio. Then use it in a view: <use block=\"name\" …/> (workspace_update_database, a view's template).",
      inputSchema: z.object({
        name: z.string(),
        title: z.string().optional(),
        description: z.string().describe("One line: what it shows or does."),
        icon: z.string().optional(),
        params: z
          .array(z.object({ name: z.string(), type: z.enum(BLOCK_PARAM_TYPES).optional(), required: z.boolean().optional(), default: z.string().optional(), help: z.string().optional(), options: z.array(z.string()).optional() }))
          .optional(),
        template: z.string().describe("The view language; props.<param>, <slot/>, run=\"@flow\"."),
        example: z.string().optional().describe('How it is used: <use block="name" …/> (in a <list> when it is made for a row) — it is drawn so to check it.'),
        flows: z.array(node).optional().describe("Its flows: { name (short: \"search\"), title, inputs, nodes, output, permissions } as in workspace_save_flow."),
        database: z.union([z.number().int(), z.string()]).optional().describe("A database (id or title) to check it on: its rows and fields."),
      }),
    },
    async (v) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        let dbId: number | undefined;
        if (v.database !== undefined) {
          const p = findPage(v.database);
          if (!p || p.kind !== "database") return h.fail(`database: there is no database “${v.database}”.`);
          dbId = p.id;
        }
        const { checkBlock } = await import("./block-check");
        const { database: _db, flows: rawFlows, ...def } = v;
        void _db;
        const r = checkBlock(def, { dbId });
        if (r.errors.length) return h.fail(`Not saved — ${r.errors.map((e) => (e.line ? `line ${e.line}: ${e.message}` : e.message)).join(" · ")}`);
        // Its flows checked, all of them, before anything is kept.
        const fs = await import("./flows/store");
        const { normalizeFlow } = await import("./flows/types");
        const { checkFlow } = await import("./flows/check");
        const flows = [];
        for (const raw of rawFlows ?? []) {
          const short = String(raw.name ?? "").trim().toLowerCase().replace(new RegExp(`^${blockFlowName(r.block.name, "").replace(/\./g, "\\.")}`), "");
          const name = blockFlowName(r.block.name, short);
          const cur = fs.flowByName(name);
          let def;
          try {
            // The AI asks; what is granted stays the user's.
            def = normalizeFlow({ ...raw, name, permissions: cur?.permissions ?? {}, requested: raw.permissions ?? cur?.requested });
          } catch (e) {
            return h.fail(`Not saved — flow “${short}”: ${(e as Error).message}`);
          }
          const problems = checkFlow(def);
          if (problems.length) return h.fail(`Not saved — flow “${short}”: ${problems.join(" · ")}`);
          flows.push({ def, cur });
        }
        const bs = await import("./block-store");
        const block = bs.saveBlock(r.block);
        const asks: string[] = [];
        const folder = flows.some((f) => !f.cur) ? await bs.blocksFolder() : null;
        for (const { def, cur } of flows) {
          const saved = cur ? fs.saveFlow(cur.pageId, def) : fs.createFlow(def, folder);
          const missing = saved.requested ? Object.keys(saved.requested).filter((k) => JSON.stringify(saved.requested![k as keyof typeof saved.requested]) !== JSON.stringify(saved.permissions[k as keyof typeof saved.permissions])) : [];
          if (missing.length) asks.push(`${saved.name} asks for ${missing.join(", ")}`);
        }
        const have = new Set((await (await import("./block-store")).blockFlows(block.name)).map((f) => f.name));
        const absent = r.flowsUsed.filter((f) => !have.has(blockFlowName(block.name, f)));
        return h.ok(
          [
            `Saved the block “${block.name}”: ${blockSignature(block)}`,
            flows.length ? `Its flows: ${flows.map((f) => f.def.name).join(", ")}.` : "",
            asks.length ? `Permissions only asked for (${asks.join("; ")}) — the user grants them in the Studio (the flow's page); until then those nodes fail.` : "",
            absent.length ? `Its template calls flows it hasn't got yet: ${absent.map((f) => `@${f}`).join(", ")} — give them in flows.` : "",
            dbId ? "" : "Checked without a database: names of fields are checked where it is used (name `database` to check them now).",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }),
  );

  server.registerTool(
    "workspace_delete_block",
    {
      title: "Remove a block",
      description: "Removes a block of your own (views that use it then say “There is no block”); flows: true removes its flows too.",
      inputSchema: z.object({ name: z.string(), flows: z.boolean().optional() }),
      annotations: { destructiveHint: true },
    },
    async ({ name, flows }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const ok = await (await import("./block-store")).deleteBlock(name, { flows: flows === true });
        return ok ? h.ok(`Removed the block “${name}”${flows ? " and its flows" : ""}.`) : h.fail(`There is no block “${name}”.`);
      }),
  );
}
