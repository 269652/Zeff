/**
 * The Workspace's tools for agents (over the MCP): search pages, read one, write one, append to one, query a
 * database, add a row. The pages are the user's notes and wiki — an agent finds what was decided, and leaves
 * what it learned where the user will look. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isInstalled } from "@/plugins/state";
import { docToMarkdown, markdownToDoc } from "./doc";
import { cellText, isComputed, sortRows, TITLE, type Row } from "./model";
import "./routine-agent"; // (registers an agent routine's permissions as a guard of its worker's requests)
import { asAgent } from "./agent-scope";
import * as store from "./store";
import { registerWorkspaceDbTools, valuesToCells } from "./mcp-db";
import { registerMetricTools } from "./mcp-metrics";
import { registerFlowTools } from "./flows/mcp";
import { registerWidgetTools } from "./mcp-widgets";
import { registerBlockTools } from "./mcp-blocks";
import { registerFunctionTools } from "./mcp-functions";
import { registerPackageTools } from "./mcp-packages";
import { mayRead, refusal } from "@/lib/boundaries";
import { labelResolver, pageLabel } from "./sensitivity";

type Result = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };
export type Helpers = { run: (fn: () => Promise<Result> | Result) => Promise<Result>; ok: (text: string) => Result; fail: (text: string) => Result };

/** The body of a tool that runs only while the Workspace is there (the guard every tool starts with). */
export const guarded = (h: Helpers, fn: () => Promise<Result> | Result): Promise<Result> => h.run(async () => off(h) ?? fn());

export const off = (h: Helpers): Result | null => (isInstalled("workspace") ? null : h.fail("The Workspace is not installed in Zeff (Menu → Plugins) — this tool isn't available."));

/**
 * A page by id ("12", "#12") or by its title (exact, then the closest). One the caller may not read (lib/boundaries: a
 * secret database's, or a personal one's for an agent without personal data) throws — every tool that names a page
 * passes here, so none reads or writes past the boundary.
 */
export function findPage(ref: string | number): store.Page | null {
  const s = String(ref).trim();
  const id = /^#?(\d+)$/.exec(s);
  const readable = (p: store.Page | null) => {
    const label = p ? pageLabel(p.id) : "open";
    if (!mayRead(label)) throw new Error(refusal(label, `Page ${p!.id}`));
    return p;
  };
  if (id) return readable(store.getPage(Number(id[1])));
  const labels = labelResolver();
  const hits = store.suggestPages(s, 5).filter((h) => mayRead(labels.page(h.id)));
  const exact = hits.find((h) => h.title.toLowerCase() === s.toLowerCase());
  const pick = exact ?? hits[0];
  return pick ? readable(store.getPage(pick.id)) : null;
}

const MAX_CHARS = 14000;

/** A page as text for an agent: where it is, its text, what links here. */
function describePage(p: store.Page): string {
  const crumbs = store.breadcrumbs(p.id).map((c) => c.title || "Untitled");
  const head = [`# ${p.title || "Untitled"}`, `(page ${p.id}${crumbs.length ? ` · in ${crumbs.join(" / ")}` : ""}${p.dbId ? ` · row of database ${p.dbId}` : ""} · edited ${p.updatedAt.slice(0, 16).replace("T", " ")})`];
  if (p.kind === "database") {
    const d = store.rowsOf(p.id);
    if (!d) return head.join("\n");
    const labels = store.labelFns({ people: {}, personHref: {}, pages: {}, todos: {} });
    const props = d.schema.properties;
    head.push(`Database with ${d.rows.length} rows. Properties: ${[d.schema.titleName, ...props.map((x) => `${x.name} (${x.type})`)].join(", ")}.`);
    head.push("", `| ${[d.schema.titleName, ...props.map((x) => x.name)].join(" | ")} |`, `| ${["---", ...props.map(() => "---")].join(" | ")} |`);
    for (const r of d.rows.slice(0, 60)) head.push(`| ${[`[${r.id}] ${r.title}`, ...props.map((x) => cellText(x, r.cells[x.id], labels).replace(/\|/g, "/"))].join(" | ")} |`);
    return head.join("\n");
  }
  const props = p.dbId ? store.getDatabase(p.dbId) : null;
  if (props) {
    for (const q of props.schema.properties) if (!isComputed(q)) head.push(`- ${q.name}: ${cellText(q, p.props[q.id]) || "—"}`);
  }
  head.push("", docToMarkdown(p.content).slice(0, MAX_CHARS));
  const back = store.backlinks(p.id);
  if (back.length) head.push("", `Linked from: ${back.map((b) => `${b.title || "Untitled"} (${b.id})`).join(", ")}`);
  return head.join("\n");
}

export function registerWorkspaceTools(real: McpServer, h: Helpers): void {
  // Whatever a tool does, it does as the AI: system pages are read-only there (agent-scope.ts).
  const server = { registerTool: (name: string, meta: unknown, handler: (...a: never[]) => unknown) => (real.registerTool as (...x: unknown[]) => unknown)(name, meta, asAgent(handler, `AI: ${name}`)) } as unknown as McpServer;
  server.registerTool(
    "workspace_search",
    {
      title: "Search the workspace",
      description:
        "Search the user's workspace pages (notes, wiki, meeting notes, decisions, databases) by words — titles count more than text. Hits come with the page id: read one with workspace_read_page. " +
        "Look here before guessing what was decided or how something works, and before asking the user.",
      inputSchema: z.object({ query: z.string().min(2).describe("Words that stand in the pages."), limit: z.number().int().min(1).max(20).optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, limit }) =>
      h.run(() => {
        const gone = off(h);
        if (gone) return gone;
        const labels = labelResolver();
        const hits = store.search(query, limit ?? 8).filter((x) => mayRead(labels.page(x.id)));
        return h.ok(hits.length ? hits.map((x) => `- [${x.id}] ${x.icon} ${x.title || "Untitled"}${x.path ? ` — ${x.path}` : ""}${x.snippet ? `\n  ${x.snippet}` : ""}`).join("\n") : `Nothing found for "${query}".`);
      }),
  );

  server.registerTool(
    "workspace_read_page",
    {
      title: "Read a workspace page",
      description: "A page's text as Markdown (a database: its properties and rows), with where it sits and which pages link to it. page: the id from a search, or its title.",
      inputSchema: z.object({ page: z.union([z.number().int(), z.string()]).describe("The page's id (12) or its title.") }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ page }) =>
      h.run(() => {
        const gone = off(h);
        if (gone) return gone;
        const p = findPage(page);
        return p ? h.ok(describePage(p)) : h.fail(`No page "${page}" — try workspace_search.`);
      }),
  );

  server.registerTool(
    "workspace_create_page",
    {
      title: "Create a workspace page",
      description:
        "Make a page in the user's workspace: a title and its text as Markdown (headings, lists, - [ ] tasks, tables, code, **bold**, links). parent: the page it goes under (id or title; none = the top). " +
        "Use it to leave notes, summaries or findings where the user will look — not for secrets.",
      inputSchema: z.object({ title: z.string().min(1).max(300), markdown: z.string().max(200000).optional(), parent: z.union([z.number().int(), z.string()]).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ title, markdown, parent }) =>
      h.run(() => {
        const gone = off(h);
        if (gone) return gone;
        const up = parent !== undefined ? findPage(parent) : null;
        if (parent !== undefined && !up) return h.fail(`No parent page "${parent}".`);
        const id = store.createPage({ title, parentId: up?.id ?? null, content: markdown ? markdownToDoc(markdown) : undefined });
        return h.ok(`Created page ${id} "${title}"${up ? ` under "${up.title || "Untitled"}"` : ""}. Open: /workspace/${id}`);
      }),
  );

  server.registerTool(
    "workspace_append",
    {
      title: "Append to a workspace page",
      description: "Add Markdown at the end of a page (e.g. a log entry, a finding, a task list). The existing text stays.",
      inputSchema: z.object({ page: z.union([z.number().int(), z.string()]), markdown: z.string().min(1).max(200000) }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ page, markdown }) =>
      h.run(() => {
        const gone = off(h);
        if (gone) return gone;
        const p = findPage(page);
        if (!p || p.kind !== "page") return h.fail(`No page "${page}".`);
        if (p.locked) return h.fail("That page is locked by the user.");
        const add = markdownToDoc(markdown).content;
        const keep = p.content.content.filter((n, i, all) => !(i === all.length - 1 && n.type === "paragraph" && !n.content));
        store.updatePage(p.id, { content: { type: "doc", content: [...keep, ...add] } });
        return h.ok(`Appended to page ${p.id} "${p.title || "Untitled"}".`);
      }),
  );

  server.registerTool(
    "workspace_update_page",
    {
      title: "Replace a workspace page's text",
      description: "Replace a page's whole text (and optionally its title) — read it first with workspace_read_page and keep what should stay. A version of the old text is kept in the page's history.",
      inputSchema: z.object({ page: z.union([z.number().int(), z.string()]), markdown: z.string().max(200000).optional(), title: z.string().max(300).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ page, markdown, title }) =>
      h.run(() => {
        const gone = off(h);
        if (gone) return gone;
        const p = findPage(page);
        if (!p || p.kind !== "page") return h.fail(`No page "${page}".`);
        if (p.locked) return h.fail("That page is locked by the user.");
        store.updatePage(p.id, { ...(title !== undefined ? { title } : {}), ...(markdown !== undefined ? { content: markdownToDoc(markdown) } : {}) });
        return h.ok(`Updated page ${p.id}.`);
      }),
  );

  server.registerTool(
    "workspace_query_database",
    {
      title: "Query a workspace database",
      description:
        "The rows of a database (Notion-style table in the workspace): optionally those whose cells contain some text, sorted by a property. Every row is a page: read one with workspace_read_page. database: its id or title.",
      inputSchema: z.object({
        database: z.union([z.number().int(), z.string()]),
        contains: z.string().optional().describe("Only rows where the title or any cell contains this."),
        sortBy: z.string().optional().describe("A property's name (or the title's)."),
        descending: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ database, contains, sortBy, descending, limit }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const p = findPage(database);
        const d = p && p.kind === "database" ? store.rowsOf(p.id) : null;
        if (!p || !d) return h.fail(`No database "${database}".`);
        const labels = store.labelFns(await store.labelsFor(d.schema, d.rows));
        const props = d.schema.properties;
        let rows: Row[] = d.rows;
        if (contains) {
          const w = contains.toLowerCase();
          rows = rows.filter((r) => r.title.toLowerCase().includes(w) || props.some((q) => cellText(q, r.cells[q.id], labels).toLowerCase().includes(w)));
        }
        const sortProp = sortBy ? (props.find((q) => q.name.toLowerCase() === sortBy.toLowerCase())?.id ?? (sortBy.toLowerCase() === d.schema.titleName.toLowerCase() ? TITLE : undefined)) : undefined;
        if (sortProp) rows = sortRows(rows, [{ prop: sortProp, dir: descending ? "desc" : "asc" }], props);
        const shown = rows.slice(0, limit ?? 50);
        const lines = [`${p.title || "Database"} — ${rows.length} rows${rows.length > shown.length ? ` (first ${shown.length})` : ""}`, `| ${[d.schema.titleName, ...props.map((q) => q.name)].join(" | ")} |`, `| ${["---", ...props.map(() => "---")].join(" | ")} |`];
        for (const r of shown) lines.push(`| ${[`[${r.id}] ${r.title}`, ...props.map((q) => cellText(q, r.cells[q.id], labels).replace(/\|/g, "/"))].join(" | ")} |`);
        return h.ok(lines.join("\n"));
      }),
  );

  server.registerTool(
    "workspace_add_row_from_url",
    {
      title: "Add a document from the web as a row",
      description: "Add the web page or PDF at a public address to a database as one row: it is read directly, its whole text becomes the row's page, its title the row's, the address goes into the first url property. An address already there adds nothing. You don't pass the text on yourself. database: its id or title.",
      inputSchema: z.object({ database: z.union([z.number().int(), z.string()]), url: z.string().url() }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ database, url }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const p = findPage(database);
        if (!p || p.kind !== "database") return h.fail(`No database "${database}".`);
        const r = await (await import("./from-url")).addRowFromUrl(p.id, url);
        return h.ok(r.existed ? `Already there: row ${r.id} "${r.title}".` : `Added row ${r.id} "${r.title}": ${r.chars} characters of text${r.cut ? " (cut off)" : ""}.`);
      }),
  );

  server.registerTool(
    "workspace_ask_database",
    {
      title: "Ask a database's rows",
      description: "A question answered only from the rows of a database (its fields and page text), each statement naming the row it comes from. For a collection of sources. database: its id or title.",
      inputSchema: z.object({ database: z.union([z.number().int(), z.string()]), question: z.string().min(3).max(1000) }),
      annotations: { readOnlyHint: true },
    },
    async ({ database, question }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const p = findPage(database);
        if (!p || p.kind !== "database") return h.fail(`No database "${database}".`);
        const r = await (await import("./dossier")).askDatabase(p.id, question);
        if (!r.answer) return h.ok("Nothing in this database fits the question.");
        return h.ok(`${r.answer}\n\nSources (the rows, as data):\n${r.sources.map((s) => `[${s.n}] row ${s.id}: ${s.title}`).join("\n")}`);
      }),
  );

  server.registerTool(
    "workspace_database_dossier",
    {
      title: "Read a database's dossier",
      description: "What the rows of a database say together, as compiled, and whether it is up to date. database: its id or title.",
      inputSchema: z.object({ database: z.union([z.number().int(), z.string()]) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ database }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const p = findPage(database);
        if (!p || p.kind !== "database") return h.fail(`No database "${database}".`);
        const d = (await import("./dossier")).dossierOf(p.id);
        if (!d.markdown) return h.ok(`No dossier yet (${d.rows} rows). It is compiled with the button of a <dossier> in a view, or by a routine calling workspace.dossier.compile.`);
        return h.ok(`${d.stale ? `(Not up to date: ${d.pending} rows not read yet.)\n\n` : ""}${d.markdown}`);
      }),
  );

  server.registerTool(
    "workspace_add_row",
    {
      title: "Add a row to a workspace database",
      description:
        "Add a row to a database: a title and values by property name — select/status by option name (a new name makes the option), multi-select as a list of names, dates as YYYY-MM-DD, numbers, checkboxes as true/false, people by name, ticket keys. Computed properties can't be set.",
      inputSchema: z.object({ database: z.union([z.number().int(), z.string()]), title: z.string().max(300), values: z.record(z.string(), z.unknown()).optional(), markdown: z.string().max(200000).optional().describe("The row page's text.") }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ database, title, values, markdown }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const p = findPage(database);
        const d = p && p.kind === "database" ? store.getDatabase(p.id) : null;
        if (!p || !d) return h.fail(`No database "${database}".`);
        const { cells, schema, notes } = await valuesToCells(d.schema, values ?? {});
        if (schema !== d.schema) store.updateSchema(p.id, schema);
        const id = store.addRow(p.id, { title, cells });
        if (markdown) store.updatePage(id, { content: markdownToDoc(markdown) });
        // A row of a two-way source (an appointment) is made there now.
        await (await import("./pipeline")).syncAfterEdit(id).catch(() => null);
        return h.ok(`Added row ${id} "${title}" to "${p.title || "Untitled"}"${notes.length ? ` (ignored: ${notes.join("; ")})` : ""}. Open: /workspace/${id}`);
      }),
  );

  // Routines: automations (steps) and agents (an LLM run on a page's instructions).
  server.registerTool(
    "workspace_routines",
    {
      title: "List the workspace's routines",
      description: "The routines of the user's workspace — automations (deterministic steps) and agents (a worker on a page's instructions) — with their page id, whether they are switched on and when they run. Run one with workspace_run_routine.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const { listRoutines } = await import("./routines");
        const list = listRoutines();
        return h.ok(list.length ? list.map((r) => `- [${r.pageId}] ${r.title || "Untitled"} — ${r.kind}, ${r.enabled ? "on" : "off"}, runs: ${r.triggers.map((t) => t.kind).join(", ")}`).join("\n") : "No routines yet.");
      }),
  );

  server.registerTool(
    "workspace_run_routine",
    {
      title: "Run a workspace routine",
      description: "Run a routine now: an automation runs through its steps and reports how it ended; an agent routine starts a worker of its own (it shows in Zeff's Code tab) and goes on in the background. routine: its page id or title. row: optionally a row's id the routine is about. It runs with your own permissions: an agent that may only change its own page cannot give a routine more.",
      inputSchema: z.object({ routine: z.union([z.number().int(), z.string()]), row: z.number().int().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ routine, row }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const { getRoutine } = await import("./routines");
        const p = findPage(routine);
        if (!p || !getRoutine(p.id)) return h.fail(`No routine "${routine}" — see workspace_routines.`);
        const { runRoutine } = await import("./routine-run");
        const r = await runRoutine(p.id, { kind: "called" }, { row });
        return h.ok(`Routine "${p.title || "Untitled"}" (${p.id}): ${r.status}${r.error ? ` — ${r.error}` : ""}${r.runId ? ` (run ${r.runId})` : ""}.`);
      }),
  );

  server.registerTool(
    "workspace_routine_runs",
    {
      title: "The runs of a workspace routine",
      description: "What a routine did lately: its newest runs with how they ended and what each step did. routine: its page id or title.",
      inputSchema: z.object({ routine: z.union([z.number().int(), z.string()]), limit: z.number().int().min(1).max(20).optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ routine, limit }) =>
      h.run(async () => {
        const gone = off(h);
        if (gone) return gone;
        const { getRoutine, routineRuns } = await import("./routines");
        const p = findPage(routine);
        if (!p || !getRoutine(p.id)) return h.fail(`No routine "${routine}" — see workspace_routines.`);
        const runs = routineRuns(p.id, limit ?? 5);
        return h.ok(runs.length ? runs.map((r) => `- run ${r.id} ${r.startedAt.slice(0, 16)} (${r.trigger.kind}): ${r.status}${r.error ? ` — ${r.error}` : ""}\n${r.log.map((l) => `    ${l.status} ${l.kind}: ${l.note}`).join("\n")}`).join("\n") : "No runs yet.");
      }),
  );

  registerWorkspaceDbTools(server, h);
  registerFlowTools(server, h);
  // Widgets: small apps the assistant builds — shown in its answer, put into a page.
  registerWidgetTools(server, h);
  registerBlockTools(server, h);
  // The server functions plugins bring.
  registerFunctionTools(server, h);
  // Packages that live: installed, on offer, install, update in place, history, roll back, tests.
  registerPackageTools(server, h);
  // The Kennzahlen (named numbers) — read, and made from a formula.
  registerMetricTools(server, h);
}
