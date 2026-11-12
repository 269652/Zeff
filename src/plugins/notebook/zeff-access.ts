import { t } from "@/lib/i18n/server";
import { cellText } from "@/plugins/workspace/model";
import type { Cell, Grid } from "@/plugins/workspace/table-pipe";
import { pageGrids } from "./page-data";

/**
 * What a notebook's code may ask Zeff for, and what it answers: the page's tables with their calculations, the results of its
 * transforms, the Kennzahlen, the values widgets publish, the databases. `accessFor` says which permission a request needs (the
 * permission layer asks the user for it when it is missing — sessions.ts); `readFor` answers it. Nothing here runs without that
 * permission. Server only.
 */

/** What a request needs: the permission's key, how it reads in the question, and whether it changes something in Zeff (`write`: its own kind of permission). */
export type Access = { key: string; label: string; description: string; write?: boolean };
export type Request = { op: string; args?: Record<string, unknown> };

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");

/** The fields of a write by their names ("Name", "Betrag") as the title and the properties' ids; a name that is not a field says which are. */
async function fieldsOf(dbId: number, fields: unknown): Promise<{ title?: string; cells: Record<string, unknown> }> {
  const store = await import("@/plugins/workspace/store");
  const d = store.getDatabase(dbId);
  if (!d) throw new Error("No such database.");
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("The fields are a dict of name → value.");
  const out: { title?: string; cells: Record<string, unknown> } = { cells: {} };
  const titleName = (d.schema.titleName || "Name").toLowerCase();
  for (const [name, v] of Object.entries(fields as Record<string, unknown>)) {
    const k = name.trim().toLowerCase();
    if (k === titleName) {
      out.title = v === null || v === undefined ? "" : String(v);
      continue;
    }
    const p = d.schema.properties.find((x) => x.name.trim().toLowerCase() === k);
    if (!p) throw new Error(`The database “${d.page.title}” has no field “${name.slice(0, 60)}” (it has: ${[d.schema.titleName || "Name", ...d.schema.properties.map((x) => x.name)].join(", ")}).`);
    // (A choice is written by its name - "done" - and kept by the option's id; a name that is no option is refused with the ones there are.)
    if ((p.type === "select" || p.type === "status" || p.type === "multi_select") && p.options?.length && v !== null && v !== "") {
      const pick = (x: unknown) => {
        const w = String(x).trim().toLowerCase();
        const o = p.options!.find((o) => o.id === String(x) || o.name.trim().toLowerCase() === w);
        if (!o) throw new Error(`“${String(x).slice(0, 40)}” is no option of “${p.name}” (there are: ${p.options!.map((o) => o.name).join(", ")}).`);
        return o.id;
      };
      out.cells[p.id] = p.type === "multi_select" ? (Array.isArray(v) ? v : [v]).map(pick) : pick(v);
      continue;
    }
    out.cells[p.id] = v;
  }
  return out;
}

/** A row of that database by its id (a row of another database is refused). */
async function rowOf(dbId: number, id: unknown): Promise<number> {
  const store = await import("@/plugins/workspace/store");
  const n = Math.floor(Number(id));
  const row = n > 0 ? store.getPage(n) : null;
  if (!row || row.dbId !== dbId) throw new Error(`There is no row ${String(id).slice(0, 20)} in that database.`);
  return n;
}

/** A database as a grid: its title column and properties; numbers stay numbers. */
async function databaseGrid(id: number): Promise<{ title: string; grid: Grid; ids: number[] } | null> {
  const store = await import("@/plugins/workspace/store");
  const { KEY_PROP, NOTE_PROP } = await import("@/plugins/workspace/collections");
  const d = store.getDatabase(id);
  if (!d) return null;
  const props = d.schema.properties.filter((p) => ![KEY_PROP, NOTE_PROP, "srcref", "srcedited", "srcurl"].includes(p.id));
  const rows = store.rawRows(d.page.id).slice(0, 5000);
  return {
    title: d.page.title,
    ids: rows.map((r) => r.id),
    grid: {
      cols: [d.schema.titleName || "Name", ...props.map((p) => p.name)],
      rows: rows.map((r): Cell[] => [r.title, ...props.map((p): Cell => { const raw = r.cells[p.id]; return typeof raw === "number" ? raw : cellText(p, raw) || null; })]),
    },
  };
}

/** The id of the database a request names (by id, or by its title). */
async function databaseId(v: unknown): Promise<{ id: number; title: string }> {
  const store = await import("@/plugins/workspace/store");
  const dbs = store.tree().filter((x) => x.kind === "database");
  // ("@my-pkg.i3": a database of an installed package by its place in it - no mix-up with another database of the same name.)
  const { isPackageRef, packagePage } = await import("@/plugins/workspace/package-refs");
  const own = isPackageRef(v) ? packagePage(v) : null;
  if (isPackageRef(v) && own === null) throw new Error(`No database ${str(v, 60)} - the package is not installed.`);
  const n = own ?? (typeof v === "number" ? v : /^\d+$/.test(str(v)) ? Number(str(v)) : 0);
  const hit = n ? dbs.find((d) => d.id === n) : dbs.find((d) => (d.title || "").trim().toLowerCase() === str(v).toLowerCase());
  if (!hit) throw new Error(`No database “${str(v, 60)}”.`);
  return { id: hit.id, title: hit.title || `#${hit.id}` };
}

const ACCESS = {
  tables: (): Access => ({ key: "tables", label: t("the tables, calculations and results of this page"), description: t("Its tables with their formulas worked out, the results of its transforms, the tables shared for formulas.") }),
  metrics: (): Access => ({ key: "metrics", label: t("your Kennzahlen (metrics)"), description: t("The values of all your Kennzahlen.") }),
  outputs: (): Access => ({ key: "outputs", label: t("the values widgets publish"), description: t("What widgets publish for all of Zeff (zeff.publish).") }),
  databases: (): Access => ({ key: "databases", label: t("the list of your databases"), description: t("Their names and ids — not their rows.") }),
};

/** The permission a request needs; what is wrong with it said in words (it throws). */
export async function accessFor(req: Request): Promise<Access> {
  switch (req.op) {
    case "tables":
    case "table":
      return ACCESS.tables();
    case "metrics":
    case "metric":
      return ACCESS.metrics();
    case "outputs":
    case "output":
      return ACCESS.outputs();
    case "databases":
      return ACCESS.databases();
    case "publish":
      return { key: "write:outputs", write: true, label: t("publish the value “{name}” for widgets and the rest of Zeff", { name: str(req.args?.name, 60) }), description: t("It becomes a value other blocks, widgets and formulas can read; a number becomes a Kennzahl. It replaces what was published under that name by this notebook.") };
    case "add_row":
    case "update_row": {
      const d = await databaseId(req.args?.database);
      return { key: `write:database:${d.id}`, write: true, label: t("add and change rows of the database “{title}”", { title: d.title }), description: t("Rows are added or their fields set. Nothing is removed.") };
    }
    case "api": {
      const method = str(req.args?.method, 80);
      const { apiMethods } = await import("@/lib/plugins/api");
      const m = apiMethods()[method];
      if (!m) throw new Error(`Zeff has no method “${method}” (for example todos.add, calendar.event.add, workspace.rows.add).`);
      return { key: `api:${method}`, write: true, label: t("use Zeff's “{method}”: {what}", { method, what: m.summary }), description: t("A function of a Zeff plugin (made by the plugin that brings it) that the code calls with its own arguments.") };
    }
    case "ai":
      return { key: "ai", write: true, label: t("ask the AI (it costs tokens of your AI account)"), description: t("The code sends a question (and what it puts in it) to the AI and gets the answer back.") };
    case "call": {
      const { listFunctions } = await import("./functions");
      const plugin = str(req.args?.plugin, 60);
      const name = str(req.args?.name, 60);
      const f = listFunctions().find((x) => x.plugin === plugin && x.name === name);
      if (!f) throw new Error(`There is no function “${plugin}.${name}” (the plugin must be on and bring it).`);
      return { key: `call:${plugin}.${name}`, write: true, label: t("run the function “{name}” of the plugin “{plugin}”", { name: f.title || name, plugin }), description: t("It runs the plugin's code (in a container), which may do what it was granted — see Settings → Notebook.") };
    }
    case "meta": {
      const { metaAccess } = await import("@/plugins/workspace/meta");
      return { ...metaAccess(str(req.args?.mop, 40), (req.args?.margs && typeof req.args.margs === "object" ? req.args.margs : {}) as Record<string, unknown>), write: true };
    }
    case "delete_row": {
      const d = await databaseId(req.args?.database);
      return { key: `delete:database:${d.id}`, write: true, label: t("move rows of the database “{title}” to the trash", { title: d.title }), description: t("The rows can be brought back from the trash.") };
    }
    case "database": {
      const d = await databaseId(req.args?.name ?? req.args?.id);
      return { key: `database:${d.id}`, label: t("the rows of the database “{title}”", { title: d.title }), description: t("All its rows and fields, as the database shows them.") };
    }
    default:
      throw new Error(`Zeff knows no “${str(req.op, 30)}”.`);
  }
}

/** What a permitted request answers (JSON). `pageId`: the page whose notebook asks. */
export async function readFor(pageId: number, req: Request): Promise<unknown> {
  const a = req.args ?? {};
  switch (req.op) {
    case "tables":
    case "table": {
      const { getPage } = await import("@/plugins/workspace/store");
      const g = await gridsOf(getPage(pageId)?.content);
      if (req.op === "tables") return g.names;
      const name = str(a.name).toLowerCase();
      const grid = g.byName.get(name);
      if (!grid) throw new Error(`There is no table or result “${str(a.name, 60)}” on this page (there are: ${g.names.map((n) => n.name).join(", ") || "none"}).`);
      const err = g.errors.get(name);
      if (err) throw new Error(`“${str(a.name, 60)}” does not work: ${err}`);
      return { cols: grid.cols, rows: grid.rows };
    }
    case "metrics": {
      const { listMetrics } = await import("@/plugins/workspace/metrics");
      return listMetrics().map((m) => ({ key: m.key, label: m.label, value: m.value, unit: m.unit }));
    }
    case "metric": {
      const { listMetrics } = await import("@/plugins/workspace/metrics");
      const want = str(a.name).toLowerCase();
      const hit = listMetrics().find((m) => m.key.toLowerCase() === want || m.label.toLowerCase() === want);
      if (!hit) throw new Error(`There is no Kennzahl “${str(a.name, 60)}”.`);
      return { key: hit.key, label: hit.label, value: hit.value, unit: hit.unit };
    }
    case "outputs": {
      const { listOutputs } = await import("@/plugins/workspace/widget-outputs");
      return listOutputs().map((o) => ({ name: o.key, label: o.label, kind: o.kind, unit: o.unit, value: o.value }));
    }
    case "output": {
      const { getOutput } = await import("@/plugins/workspace/widget-outputs");
      const o = getOutput(str(a.name));
      if (!o) throw new Error(`No widget published “${str(a.name, 60)}”.`);
      return { name: o.key, label: o.label, kind: o.kind, unit: o.unit, value: o.value };
    }
    case "databases": {
      const store = await import("@/plugins/workspace/store");
      return store.tree().filter((x) => x.kind === "database").map((d) => ({ id: d.id, title: d.title }));
    }
    case "database": {
      const d = await databaseId(a.name ?? a.id);
      const g = await databaseGrid(d.id);
      if (!g) throw new Error(`No database “${d.title}”.`);
      return { id: d.id, title: g.title, cols: g.grid.cols, rows: g.grid.rows, ids: g.ids };
    }
    case "api": {
      const { callBuiltin } = await import("@/lib/plugins/api");
      return callBuiltin("workspace", str(a.method, 80), (a.params && typeof a.params === "object" && !Array.isArray(a.params) ? a.params : {}) as Record<string, unknown>);
    }
    case "ai": {
      const { isInstalled } = await import("@/plugins/state");
      if (!isInstalled("llm")) throw new Error("The LLM plugin is needed for zeff.ai (Menu → Plugins).");
      const prompt = str(a.prompt, 20000).trim();
      if (!prompt) throw new Error("ai: ask something.");
      const { runAi } = await import("@/lib/ai");
      const wantsJson = a.json === true;
      // A long answer (a plan of a whole course): a schema of its own and up to 9 minutes - else a short answer in two.
      const own = a.schema && typeof a.schema === "object" && !Array.isArray(a.schema) ? (a.schema as object) : null;
      const minutes = Math.max(1, Math.min(9, Math.floor(Number(a.minutes) || 2)));
      if (own) {
        const long = await runAi<unknown>(prompt, own, { task: "notebook-ask", timeoutMs: minutes * 60_000, maxBudgetUsd: minutes > 2 ? 1.5 : 0.3 });
        return long.output ?? null;
      }
      const r = await runAi<{ answer?: unknown }>(
        `${prompt}\n\n${wantsJson ? 'Answer ONLY with JSON: {"answer": <the JSON value asked for>}.' : 'Answer ONLY with JSON: {"answer": "<your answer as text>"}.'}`,
        { type: "object", required: ["answer"], properties: { answer: wantsJson ? {} : { type: "string" } } },
        { task: "notebook-ask", timeoutMs: minutes * 60_000, maxBudgetUsd: minutes > 2 ? 1.5 : 0.3 },
      );
      return r.output?.answer ?? null;
    }
    case "call": {
      const { callFunction } = await import("./functions");
      const r = await callFunction(str(a.plugin, 60), str(a.name, 60), (a.fargs && typeof a.fargs === "object" && !Array.isArray(a.fargs) ? a.fargs : {}) as Record<string, unknown>);
      if (!r.ok) throw new Error(r.error);
      return r.value === undefined ? null : r.value;
    }
    case "meta": {
      const { metaRun } = await import("@/plugins/workspace/meta");
      return metaRun(str(a.mop, 40), (a.margs && typeof a.margs === "object" ? a.margs : {}) as Record<string, unknown>);
    }
    case "publish": {
      const { publishOutput } = await import("@/plugins/workspace/widget-outputs");
      const name = str(a.name, 80);
      if (!name) throw new Error("publish: give the value a name.");
      const o = publishOutput(name, a.value, { owner: `notebook:${pageId}`, pageId, widget: `code:${pageId}:${name}`, unit: str(a.unit, 20), label: name });
      return { published: o?.key ?? name };
    }
    case "add_row": {
      const d = await databaseId(a.database);
      const store = await import("@/plugins/workspace/store");
      const { title, cells } = await fieldsOf(d.id, a.fields);
      return { id: store.addRow(d.id, { ...(title !== undefined ? { title } : {}), cells }) };
    }
    case "update_row": {
      const d = await databaseId(a.database);
      const store = await import("@/plugins/workspace/store");
      const rowId = await rowOf(d.id, a.id);
      const { title, cells } = await fieldsOf(d.id, a.fields);
      const { TITLE } = await import("@/plugins/workspace/model");
      if (title !== undefined) store.setCell(rowId, TITLE, title);
      for (const [prop, v] of Object.entries(cells)) store.setCell(rowId, prop, v);
      return { id: rowId };
    }
    case "delete_row": {
      const d = await databaseId(a.database);
      const store = await import("@/plugins/workspace/store");
      const rowId = await rowOf(d.id, a.id);
      store.archivePage(rowId);
      return { id: rowId };
    }
    default:
      throw new Error(`Zeff knows no “${str(req.op, 30)}”.`);
  }
}

/** The page's tables and results, with the databases its transforms read (`db:12`) loaded. */
async function gridsOf(content: Parameters<typeof pageGrids>[0]): Promise<ReturnType<typeof pageGrids>> {
  const ids = new Set<number>();
  const walk = (n: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (n.type === "tablePipe") {
      const m = /^db:(\d+)$/.exec(String(n.attrs?.from ?? "").trim());
      if (m) ids.add(Number(m[1]));
    }
    for (const c of (n.content ?? []) as (typeof n)[]) walk(c);
  };
  for (const n of content?.content ?? []) walk(n);
  const loaded = new Map<number, Grid>();
  for (const id of ids) {
    const g = await databaseGrid(id);
    if (g) loaded.set(id, g.grid);
  }
  const { formulaData } = await import("@/plugins/workspace/formula-data");
  return pageGrids(content, formulaData(), (id) => loaded.get(id) ?? null);
}

/** What a cell's declared input is: a table of the page, a result of a transform or another code cell, a database (`db:12`), or a value another cell returned. */
export async function inputFor(pageId: number, name: string): Promise<unknown> {
  const { getPage } = await import("@/plugins/workspace/store");
  const n = str(name, 120);
  const db = /^db:(\d+)$/.exec(n);
  if (db) {
    const g = await databaseGrid(Number(db[1]));
    if (!g) throw new Error(`No database ${db[1]}.`);
    return { cols: g.grid.cols, rows: g.grid.rows, ids: g.ids };
  }
  const g = await gridsOf(getPage(pageId)?.content);
  const k = n.toLowerCase();
  const grid = g.byName.get(k);
  if (grid) {
    const err = g.errors.get(k);
    if (err) throw new Error(`The input “${n}” does not work: ${err}`);
    return { cols: grid.cols, rows: grid.rows };
  }
  if (g.values.has(k)) return g.values.get(k);
  throw new Error(`There is no input “${n}” on this page (there are: ${g.names.map((x) => x.name).join(", ") || "none"}).`);
}

/** The permission reading an input needs. */
export async function inputAccess(name: string): Promise<Access> {
  const db = /^db:(\d+)$/.exec(str(name, 120));
  return db ? accessFor({ op: "database", args: { id: Number(db[1]) } }) : ACCESS.tables();
}
