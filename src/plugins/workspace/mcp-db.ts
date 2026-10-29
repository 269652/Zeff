/**
 * The Workspace's tools for agents, part two: shaping it - the page tree, ready-made templates, making a database with
 * its properties and views, changing them by name, changing and removing rows, moving, archiving, restoring and
 * dressing pages (icon, cover, width). With the read/write tools of mcp.ts an agent can build and keep whole wikis and
 * databases. Server only.
 */
import { sourceTable } from "./source-table";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { docToMarkdown, markdownToDoc } from "./doc";
import { applyOps, type DbOp, type PropIn, type ViewIn } from "./schema-ops";
import { cellText, isComputed, PROP_TYPES, ROLLUP_FNS, VIEW_TYPES, type DbSchema } from "./model";
import * as store from "./store";
import { findPage, off, type Helpers } from "./mcp";
import { mayRead } from "@/lib/boundaries";
import { labelResolver } from "./sensitivity";

const ref = z.union([z.number().int(), z.string()]);

/** Values by property name as an agent gives them → cells by property id (a new option name makes the option). */
export async function valuesToCells(schema: DbSchema, values: Record<string, unknown>): Promise<{ cells: Record<string, unknown>; schema: DbSchema; notes: string[] }> {
  let next = schema;
  const cells: Record<string, unknown> = {};
  const notes: string[] = [];
  for (const [name, raw] of Object.entries(values)) {
    const q = next.properties.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!q) {
      notes.push(`no property "${name}"`);
      continue;
    }
    if (isComputed(q)) {
      notes.push(`"${q.name}" is computed`);
      continue;
    }
    if (q.type === "select" || q.type === "status" || q.type === "multi_select") {
      const ids: string[] = [];
      for (const n of (Array.isArray(raw) ? raw : [raw]).map(String)) {
        let o = q.options?.find((x) => x.name.toLowerCase() === n.toLowerCase());
        if (!o) {
          o = { id: `o${Math.random().toString(36).slice(2, 8)}`, name: n, color: "gray", group: q.type === "status" ? "todo" : undefined };
          next = { ...next, properties: next.properties.map((x) => (x.id === q.id ? { ...x, options: [...(x.options ?? []), o!] } : x)) };
        }
        ids.push(o.id);
      }
      cells[q.id] = q.type === "multi_select" ? ids : ids[0];
    } else if (q.type === "person") {
      const { listPeople } = await import("@/plugins/people/store");
      const all = listPeople();
      cells[q.id] = (Array.isArray(raw) ? raw : [raw]).map((n) => all.find((x) => x.name.toLowerCase() === String(n).toLowerCase() || x.aliases.some((a) => a.toLowerCase() === String(n).toLowerCase()))?.id).filter((x): x is number => !!x);
    } else if (q.type === "relation") {
      // Pages of the related database by title (or id).
      const out: number[] = [];
      for (const n of Array.isArray(raw) ? raw : [raw]) {
        const p = findPage(n as string | number);
        if (p) out.push(p.id);
        else notes.push(`no page "${String(n)}" for "${q.name}"`);
      }
      cells[q.id] = out;
    } else cells[q.id] = raw;
  }
  return { cells, schema: next, notes };
}

const propSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(PROP_TYPES).optional().describe(`One of: ${PROP_TYPES.join(", ")}. Default text.`),
  options: z.array(z.union([z.string(), z.object({ name: z.string(), color: z.string().optional(), group: z.enum(["todo", "doing", "done"]).optional() })])).optional().describe("select / multi_select / status: the choices (a status's group: todo, doing, done)."),
  formula: z.string().optional().describe('formula: e.g. prop("Hours") * 80 — functions are listed in the editor; prop("Name") reads a property.'),
  custom: z.string().optional().describe("custom: the field type - workspace.rating (1-5 stars), workspace.progress (0-100 %), or a plugin's \"plugin.what\"; its entries are checked by the type."),
  aiPrompt: z.string().optional().describe("ai: what the AI fills the cell by, from the row's other cells."),
  format: z.enum(["number", "percent", "euro", "dollar", "hours", "unit"]).optional(),
  unit: z.string().max(12).optional().describe("number, format unit: what comes after the number — mg, ml, km, Stück."),
  includeTime: z.boolean().optional().describe("date: with a time."),
  relation: z.object({ database: z.number().int().optional(), source: z.string().optional(), twoWay: z.boolean().optional(), match: z.object({ from: z.string(), to: z.string() }).optional() }).optional().describe("relation: the id of the related database (the database's page id). match: link the rows by themselves — this row's `from` property (or \"title\") equals the related row's `to` property (case-insensitive); read-only, computed. With the \"Time booked\" database (source: time) and match {from: \"title\", to: \"Ticket\"} plus a rollup (sum of Hours) a ticket database totals the booked time."),
  rollup: z.object({ relation: z.string(), property: z.string(), fn: z.enum(ROLLUP_FNS), filter: z.array(z.object({ property: z.string(), cond: z.string(), value: z.unknown().optional() })).optional().describe("Only the related rows that pass these rules count (e.g. [{property: \"Date\", cond: \"this_month\"}]).") }).optional().describe("rollup: through one of this database's relations, a property (name, or \"title\") of the related rows, calculated by fn."),
});

const viewShape = {
  type: z.enum(VIEW_TYPES).optional().describe("table, board (columns by groupBy), list, gallery, calendar (by dateProp), timeline (bars from dateProp to endProp, or the end of the date range), chart (the rows by groupBy as chartKind, counting rows or the sum/average of chartProp)."),
  groupBy: z.string().nullable().optional().describe("A select/status/multi-select/person/checkbox/relation property: the board's columns, or the groups of a table or list."),
  dateProp: z.string().nullable().optional().describe("The date property a calendar is laid out by (a timeline: where a bar starts)."),
  endProp: z.string().nullable().optional().describe("Timeline: the date property where a bar ends."),
  chartKind: z.enum(["bar", "column", "line", "pie"]).optional().describe("Chart view: how it is drawn."),
  chartCalc: z.enum(["count", "sum", "avg"]).optional().describe("Chart view: count rows, or the sum / average of chartProp."),
  chartProp: z.string().nullable().optional().describe("Chart view: the number property summed or averaged."),
  card: z.string().nullable().optional().describe("Board / gallery view: how a card looks — a template: tags <row gap=2> <col> <grow/> <b> <muted> <small> <clamp lines=3> <chip> <bar value=.. max=..> <img src=.. h=..> <a href=..>, values {{ title }} {{ key }} {{ Property }} ({{ [Name with spaces] }}), filters {{ Status | chip }} {{ Due | date }} {{ Due | relative }} {{ Hours | hours }} {{ x | truncate(40) }} {{ x | default(\"–\") }}, and {{#if Due < today()}}…{{#else}}…{{/if}} / {{#each Labels}}{{ this }}{{/each}}. Null or empty: the automatic card."),
  hidden: z.array(z.string()).optional().describe("Properties this view does not show."),
  order: z.array(z.string()).optional().describe('The columns in order, property names; "title" is the title column and may be anywhere.'),
  sorts: z.array(z.object({ property: z.string(), dir: z.enum(["asc", "desc"]).optional() })).optional(),
  filter: z.array(z.object({ property: z.string(), cond: z.string().describe("contains, not_contains, is, is_not, starts_with, ends_with, is_empty, not_empty, eq, neq, gt, lt, gte, lte, before, after, on_or_before, on_or_after, past_week, past_month, next_week, next_month, this_week, today, checked, unchecked"), value: z.unknown().optional() })).optional().describe("Rules that must all hold; select values by option name."),
  wrap: z.boolean().optional(),
};

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_property"), position: z.number().int().optional() }).extend(propSchema.shape),
  z.object({ op: z.literal("update_property"), property: z.string() }).extend(propSchema.partial().shape),
  z.object({ op: z.literal("remove_property"), property: z.string() }),
  z.object({ op: z.literal("rename_title"), name: z.string().min(1) }),
  z.object({ op: z.literal("reorder_properties"), names: z.array(z.string()) }),
  z.object({ op: z.literal("add_view"), name: z.string().min(1) }).extend(viewShape),
  z.object({ op: z.literal("update_view"), view: z.string(), name: z.string().optional() }).extend(viewShape),
  z.object({ op: z.literal("remove_view"), view: z.string() }),
  z.object({ op: z.literal("order_columns"), view: z.string().optional(), order: z.array(z.string()) }),
]);

/** A database as text: its properties (with options, formulas, relations), its views. */
function describeSchema(p: store.Page, schema: DbSchema): string {
  const lines = [`Database "${p.title || "Untitled"}" (page ${p.id}) — title column "${schema.titleName}"`, "", "Properties:"];
  for (const q of schema.properties) {
    const bits: string[] = [q.type];
    if (q.options?.length) bits.push(`options: ${q.options.map((o) => o.name).join(", ")}`);
    if (q.formula) bits.push(`formula: ${q.formula}`);
    if (q.rollup) bits.push(`rollup: ${schema.properties.find((x) => x.id === q.rollup!.relation)?.name ?? "?"} → ${q.rollup.property} (${q.rollup.fn})`);
    if (q.relationSource !== undefined) bits.push(`relation to the source ${q.relationSource} (matching ${q.match?.from} = ${q.match?.to})`);
    else if (q.relationDb !== undefined) bits.push(`${q.backOf ? "back-relation of" : "relation to"} database ${q.relationDb}${q.match ? ` (matching ${q.match.from} = ${q.match.to})` : ""}`);
    if (q.aiPrompt) bits.push(`ai: ${q.aiPrompt}`);
    lines.push(`- ${q.name} (${bits.join("; ")})`);
  }
  lines.push("", "Views:");
  const name = (id?: string) => (id ? (schema.properties.find((x) => x.id === id)?.name ?? id) : "");
  for (const v of schema.views) {
    const bits: string[] = [v.type];
    if (v.groupBy) bits.push(`grouped by ${name(v.groupBy)}`);
    if (v.dateProp) bits.push(`dates by ${name(v.dateProp)}`);
    if (v.sorts.length) bits.push(`sorted by ${v.sorts.map((s) => `${name(s.prop)} ${s.dir}`).join(", ")}`);
    if (v.filter.rules.length) bits.push(`${v.filter.rules.length} filter rule(s)`);
    if (v.hidden.length) bits.push(`hides ${v.hidden.map(name).join(", ")}`);
    lines.push(`- ${v.name} (${bits.join("; ")})`);
  }
  return lines.join("\n");
}

const related = (key: number | string): DbSchema | null => (typeof key === "string" ? sourceTable(key)?.schema ?? null : store.getDatabase(key)?.schema ?? null);

export function registerWorkspaceDbTools(server: McpServer, h: Helpers): void {
  const guard = <T extends object>(fn: (a: T) => Promise<ReturnType<Helpers["ok"]>> | ReturnType<Helpers["ok"]>) => (a: T) =>
    h.run(async () => {
      const gone = off(h);
      return gone ?? (await fn(a));
    });
  const rw = { readOnlyHint: false, destructiveHint: false };

  server.registerTool(
    "workspace_tree",
    {
      title: "List the workspace's pages",
      description: "The page tree: every page and database with its id, kind and where it sits (indented). parent: only below that page (id or title). Use it to see what exists before making or moving anything.",
      inputSchema: z.object({ parent: ref.optional(), depth: z.number().int().min(1).max(8).optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    guard(({ parent, depth }: { parent?: string | number; depth?: number }) => {
      // (What the caller may not read is not listed — nor what is under it: lib/boundaries.)
      const labels = labelResolver();
      const items = store.tree().filter((x) => mayRead(x.kind === "database" ? labels.database(x.id) : "open"));
      const root = parent !== undefined ? findPage(parent) : null;
      if (parent !== undefined && !root) return h.fail(`No page "${parent}".`);
      const out: string[] = [];
      const walk = (pid: number | null, level: number) => {
        if (level > (depth ?? 4)) return;
        for (const it of items.filter((x) => x.parentId === pid).sort((a, b) => a.position - b.position)) {
          out.push(`${"  ".repeat(level)}- [${it.id}] ${it.icon} ${it.title || "Untitled"}${it.kind === "database" ? " (database)" : it.kind === "form" ? " (form)" : ""}`);
          walk(it.id, level + 1);
        }
      };
      walk(root?.id ?? null, 0);
      return h.ok(out.length ? out.join("\n") : "No pages yet.");
    }),
  );

  server.registerTool(
    "workspace_templates",
    {
      title: "Ready-made workspace pages",
      description: "Without `create`: the templates (meeting notes, 1:1, project brief, weekly review, team wiki, tasks database tied to Zeff todos, decision log, reading list, projects with tasks …). With `create` (a key from the list): make that one, under `parent`.",
      inputSchema: z.object({ create: z.string().optional(), parent: ref.optional() }),
      annotations: rw,
    },
    guard(async ({ create, parent }: { create?: string; parent?: string | number }) => {
      const { templateMetas, fromTemplate } = await import("./templates");
      if (!create) return h.ok(templateMetas().map((x) => `- ${x.key}: ${x.icon} ${x.name} (${x.kind}) — ${x.description}`).join("\n"));
      const up = parent !== undefined ? findPage(parent) : null;
      if (parent !== undefined && !up) return h.fail(`No parent page "${parent}".`);
      const id = await fromTemplate(create, up?.id ?? null);
      return h.ok(`Made page ${id} from "${create}". Open: /workspace/${id}`);
    }),
  );

  server.registerTool(
    "workspace_create_database",
    {
      title: "Create a database in the workspace",
      description:
        "Make a Notion-style database: a title column, typed properties (text, number, select, multi_select, status, date, checkbox, url, email, phone, person, relation, rollup, formula, created_time, updated_time, todo = Zeff todo, ticket = Jira ticket, ai) and views (table, board, list, gallery, calendar). " +
        "Without properties it gets Status and Date; without views one table. Optionally rows (title + values by property name). Change it later with workspace_update_database.",
      inputSchema: z.object({
        title: z.string().min(1).max(300),
        parent: ref.optional(),
        icon: z.string().max(16).optional(),
        titleName: z.string().optional().describe('Name of the title column (default "Name").'),
        properties: z.array(propSchema).optional(),
        views: z.array(z.object({ name: z.string().min(1) }).extend(viewShape)).optional(),
        rows: z.array(z.object({ title: z.string(), values: z.record(z.string(), z.unknown()).optional(), markdown: z.string().max(100000).optional() })).max(500).optional(),
      }),
      annotations: rw,
    },
    guard(async (a: { title: string; parent?: string | number; icon?: string; titleName?: string; properties?: PropIn[]; views?: ({ name: string } & ViewIn)[]; rows?: { title: string; values?: Record<string, unknown>; markdown?: string }[] }) => {
      const up = a.parent !== undefined ? findPage(a.parent) : null;
      if (a.parent !== undefined && !up) return h.fail(`No parent page "${a.parent}".`);
      const id = store.createPage({ title: a.title, icon: a.icon, kind: "database", parentId: up?.id ?? null });
      try {
        let ops: DbOp[] = [];
        const base = store.getDatabase(id)!.schema;
        if (a.titleName) ops.push({ op: "rename_title", name: a.titleName });
        if (a.properties) {
          // Given properties replace the defaults (Status, Date).
          ops = [...base.properties.map((p): DbOp => ({ op: "remove_property", property: p.id })), ...ops, ...a.properties.map((p): DbOp => ({ op: "add_property", ...p, name: p.name ?? "Property" }))];
        }
        for (const v of a.views ?? []) ops.push({ op: "add_view", ...v });
        if (a.views?.length) ops.push({ op: "remove_view", view: base.views[0].id });
        const { schema, notes } = applyOps(base, ops, { related });
        const saved = store.saveSchema(id, schema);
        let made = 0;
        const skipped: string[] = [];
        let live = saved;
        for (const r of a.rows ?? []) {
          const c = await valuesToCells(live, r.values ?? {});
          if (c.schema !== live) live = store.updateSchema(id, c.schema);
          const rid = store.addRow(id, { title: r.title, cells: c.cells });
          if (r.markdown) store.updatePage(rid, { content: markdownToDoc(r.markdown) });
          made++;
          skipped.push(...c.notes);
        }
        return h.ok(`Created database ${id} "${a.title}" (${notes.length} change(s) to its schema${made ? `, ${made} rows` : ""})${skipped.length ? ` — ignored: ${[...new Set(skipped)].join("; ")}` : ""}. Open: /workspace/${id}\n\n${describeSchema(store.getPage(id)!, store.getDatabase(id)!.schema)}`);
      } catch (e) {
        // A database that could not be shaped is not left behind half made.
        store.deletePage(id);
        throw e;
      }
    }),
  );

  server.registerTool(
    "workspace_database_schema",
    {
      title: "Read a database's structure",
      description: "A database's properties (type, options, formula, relation, rollup) and views (type, grouping, sorts, filters). Read it before changing it.",
      inputSchema: z.object({ database: ref }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    guard(({ database }: { database: string | number }) => {
      const p = findPage(database);
      const d = p?.kind === "database" ? store.getDatabase(p.id) : null;
      return p && d ? h.ok(describeSchema(p, d.schema)) : h.fail(`No database "${database}".`);
    }),
  );

  server.registerTool(
    "workspace_relation_sources",
    {
      title: "What a database can join",
      description:
        "The sources of Zeff's own data a database can join live — the booked time, GitLab merge requests, Jira comments, todos, worker runs — with their properties, and how: a relation property with `source` and `match` (workspace_update_database add_property), then a rollup over it (count, sum, latest …, with a filter). Use it when someone asks for a table of tickets/projects with hours, open MRs, last comment, open todos or runs.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    guard(async () => h.ok((await import("./source-table")).relationSourceHelp())),
  );

  server.registerTool(
    "workspace_update_database",
    {
      title: "Change a database's properties and views",
      description:
        "Apply operations in order, by name: add_property (name, type, options, formula, relation, rollup …; position), update_property (property, + what to change), remove_property, rename_title, reorder_properties (names), " +
        "add_view (name, type, groupBy, dateProp, sorts, filter, hidden, order), update_view (view, + what to change; name renames), remove_view, order_columns (view, order — property names, \"title\" is the title column and may come first or anywhere). " +
        "All or nothing: if one fails nothing is saved and the error says which. Removing a property drops its values.",
      inputSchema: z.object({ database: ref, operations: z.array(opSchema).min(1).max(60) }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    guard(({ database, operations }: { database: string | number; operations: DbOp[] }) => {
      const p = findPage(database);
      const d = p?.kind === "database" ? store.getDatabase(p.id) : null;
      if (!p || !d) return h.fail(`No database "${database}".`);
      const { schema, notes } = applyOps(d.schema, operations, { related });
      const saved = store.saveSchema(p.id, schema);
      return h.ok(`Saved: ${notes.join("; ")}.\n\n${describeSchema(p, saved)}`);
    }),
  );

  server.registerTool(
    "workspace_update_row",
    {
      title: "Change a row of a workspace database",
      description: "Set a row's title and/or values (by property name; select/status by option name, new names make options; relations by page title or id; dates YYYY-MM-DD; checkboxes true/false), and/or replace the row page's text. row: its page id (from workspace_query_database).",
      inputSchema: z.object({ row: z.number().int(), title: z.string().max(300).optional(), values: z.record(z.string(), z.unknown()).optional(), markdown: z.string().max(200000).optional() }),
      annotations: rw,
    },
    guard(async ({ row, title, values, markdown }: { row: number; title?: string; values?: Record<string, unknown>; markdown?: string }) => {
      const r = store.getPage(row);
      const d = r?.dbId ? store.getDatabase(r.dbId) : null;
      if (!r || !d) return h.fail(`No row ${row}.`);
      const c = await valuesToCells(d.schema, values ?? {});
      if (c.schema !== d.schema) store.updateSchema(d.page.id, c.schema);
      for (const [k, v] of Object.entries(c.cells)) store.setCell(r.id, k, v);
      if (title !== undefined) store.updatePage(r.id, { title });
      if (markdown !== undefined) store.updatePage(r.id, { content: markdownToDoc(markdown) });
      // A row of a two-way source (an appointment): the change goes to where it comes from now.
      await (await import("./pipeline")).syncAfterEdit(r.id).catch(() => null);
      return h.ok(`Updated row ${r.id}${c.notes.length ? ` (ignored: ${c.notes.join("; ")})` : ""}.`);
    }),
  );

  server.registerTool(
    "workspace_set_page",
    {
      title: "Dress, move or file a workspace page",
      description:
        "Change a page's look and place: icon (an emoji), cover (an image address, \"\" removes it), title, favorite, full width, small text, locked; move it under another page (parent: id or title; \"root\" for the top; before: a sibling's id to sit in front of), " +
        "archive it (to the trash — a database or page with everything below; restorable) or restore it, or duplicate it. Rows move with their database, not on their own.",
      inputSchema: z.object({
        page: ref,
        title: z.string().max(300).optional(),
        icon: z.string().max(16).optional(),
        cover: z.string().max(2000).optional(),
        favorite: z.boolean().optional(),
        fullWidth: z.boolean().optional(),
        smallText: z.boolean().optional(),
        locked: z.boolean().optional(),
        parent: ref.optional(),
        before: z.number().int().optional(),
        archive: z.boolean().optional().describe("true: to the trash. false: restore from it."),
        duplicate: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    guard(async ({ page, parent, before, archive, duplicate, ...patch }: { page: string | number; parent?: string | number; before?: number; archive?: boolean; duplicate?: boolean; title?: string; icon?: string; cover?: string; favorite?: boolean; fullWidth?: boolean; smallText?: boolean; locked?: boolean }) => {
      const p = findPage(page) ?? (/^\d+$/.test(String(page)) ? store.trash().find((x) => x.id === Number(page)) && store.getPage(Number(page)) : null);
      if (!p) return h.fail(`No page "${page}".`);
      const did: string[] = [];
      if (archive === false) {
        store.restorePage(p.id);
        did.push("restored");
      }
      if (p.locked && (archive || parent !== undefined || Object.keys(patch).some((k) => k !== "locked" && (patch as Record<string, unknown>)[k] !== undefined))) return h.fail("That page is locked by the user.");
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length) {
        store.updatePage(p.id, clean);
        did.push(`set ${Object.keys(clean).join(", ")}`);
      }
      if (parent !== undefined || before !== undefined) {
        const up = parent === undefined ? undefined : /^root$/i.test(String(parent)) ? null : (findPage(parent)?.id ?? undefined);
        if (parent !== undefined && up === undefined) return h.fail(`No page "${parent}" to move it under.`);
        store.movePage(p.id, up === undefined ? p.parentId : up, before ?? null);
        did.push("moved");
      }
      if (duplicate) did.push(`duplicated as page ${store.duplicatePage(p.id, { suffix: true })}`);
      if (archive) {
        await (await import("./source-write")).removeFromSource(p.id);
        store.archivePage(p.id);
        did.push("archived");
      }
      return h.ok(did.length ? `Page ${p.id}: ${did.join("; ")}.` : "Nothing to change.");
    }),
  );

  server.registerTool(
    "workspace_write_page",
    {
      title: "Write a workspace page with full design",
      description:
        "Replace or append to a page's text in the extended Markdown the workspace reads and writes losslessly: # ## ### headings, lists, - [ ] tasks, tables, code fences, quotes, **bold**, *italic*, ~~strike~~, ==highlight==, [links](url), ![images](url), --- rules, " +
        "tabs `:::tabs` containing `:::tab Title` … `:::` for each tab (blocks inside) closed by `:::`, the entry's own blocks `:::block activity {\"limit\":12}` (who changed what) and `:::block belongs` (everything that belongs to the row: linked pages, related rows, todos, tickets), callouts `:::callout 💡 blue` … `:::` (tones: gray brown orange yellow green blue purple pink red), toggles `:::toggle Summary` … `:::` (blocks inside, they nest), a database shown in the page `:::database 12 Optional title` (on a line of its own), " +
        "to-do lists: a `:::list {\"id\":\"t1\",\"title\":\"Office\",\"engine\":true}` line directly before the `- [ ]` items names the list (keep it when you rewrite a page: it is how other pages, databases and the Todo engine find the list; engine: its open items are todos of the user's Todos tab), `:::todolist 12 t1` shows list t1 of page 12 here (ticked and written in place), `:::database 7` a database; "+
        "and mentions `[[page:12|Label]]`, `[[todo:5]]`, `[[ticket:PROJ-1]]`, `[[person:3|Name]]`, a Kennzahl with its value `[[metric:sparquote|Sparquote]]` (metric_list names them). workspace_read_page shows a page in the same syntax — read, change, write back. mode: replace (default; the old text is kept in the history) or append.",
      inputSchema: z.object({ page: ref, markdown: z.string().max(300000), mode: z.enum(["replace", "append"]).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    guard(({ page, markdown, mode }: { page: string | number; markdown: string; mode?: "replace" | "append" }) => {
      const p = findPage(page);
      if (!p || p.kind !== "page") return h.fail(`No page "${page}".`);
      if (p.locked) return h.fail("That page is locked by the user.");
      const add = markdownToDoc(markdown).content;
      const keep = p.content.content.filter((n, i, all) => !(i === all.length - 1 && n.type === "paragraph" && !n.content));
      store.updatePage(p.id, { content: { type: "doc", content: mode === "append" ? [...keep, ...add] : add } });
      return h.ok(`${mode === "append" ? "Appended to" : "Wrote"} page ${p.id} "${p.title || "Untitled"}" (${docToMarkdown(store.getPage(p.id)!.content).length} characters).`);
    }),
  );

  void cellText;
}
