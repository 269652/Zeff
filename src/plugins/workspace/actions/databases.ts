"use server";

import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { csvToDatabase, parseCsv } from "../csv";
import { previewLines, type PreviewLine } from "../doc";
import { setCollection } from "@/lib/items";
import { ticketExtras } from "@/lib/items/tickets";
import type { TicketExtras } from "@/lib/items/shared";
import { rowKey } from "../collections";
import { rowsToCsv, subtaskCounts, type DbSchema, type Row } from "../model";
import * as store from "../store";
import { type Result, run, collectionSwitches, whoAmI, collectionSource, readOnlyRows } from "./shared";

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

export type DatabaseData = {
  id: number;
  title: string;
  icon: string;
  schema: DbSchema;
  rows: Row[];
  labels: Awaited<ReturnType<typeof store.labelsFor>>;
  templates: { id: number; title: string }[];
  /** Related databases (for relation pickers): their rows' titles. */
  related: Record<string, { title: string; properties: { id: string; name: string; type: string }[]; /** Its whole schema (a rollup's filter picks from its options). */ schema?: DbSchema; rows: { id: number; title: string; icon: string }[] }>;
  /** What the cards show beyond the cells: each row's ticket key, its subtasks, and — by key — its Lage and todos. */
  /** Locked (a database a sync keeps, as Jira's): shown, not changed here — its cards don't move, its cells aren't edited. */
  locked: boolean;
  /** Its source only lends records (automations, their runs): no row can be made by hand. */
  noNewRows?: boolean;
  extras: { /** A jobs database: per row, the question it waits on and the delivery proposed under it. */ jobs?: Record<number, import("../jobs").JobPanel>; keys: Record<number, string>; subtasks: Record<number, { done: number; total: number }>; tickets: Record<string, TicketExtras>; todosOn: boolean; briefing: boolean; knowledge: boolean; /** How sensitive it is (lib/boundaries) — shown with a lock in its menu. */ sensitivity?: "open" | "personal" | "secret"; me: { names: string[]; ids: number[] }; source: string | null; /** The field types the databases can have (the Workspace's and the plugins'). */ fieldTypes?: import("../field-point").FieldTypeInfo[]; running?: boolean; /** The app views it can have (mail client, chat — their plugins installed). */ appViews?: { id: string; label: string; icon: string; /** Its sidebar can be in the Workspace tree. */ nav?: boolean }[]; /** The sources plugins bring (People …), for the pipeline editor. */ extSources?: { id: string; label: string; icon: string; hint?: string }[]; /** Mail or message channels can be named as sources (the View menu offers "Inbox"). */ inboxPossible?: boolean; /** What its sources let you do (reply where they send; read-only else). */ capabilities?: { reply: string[]; drafts: string[]; readOnly: boolean }; /** Its derived databases (an app shows them as folders), and the one it is derived from. */ derived?: { id: number; title: string; icon: string; count: number; unread: number }[]; derivedFrom?: number | null; previews: Record<number, PreviewLine[]>; /** Per row, the todos that refer to it (todo-marks.ts). */ todoMarks?: Record<number, import("../todo-marks").TodoMark>; /** Rows that are linked copies of a row in another database. */ links?: Record<number, { source: number; sourceTitle: string; sourceDb: string }>; /** The custom view its rows have (a plugin's): its id. */ rowView?: string | null };
};

export async function loadDatabaseAction(dbId: number): Promise<Result<{ data: DatabaseData }>> {
  return run(async () => {
    // A documents database: what waits to be read is read (the documents page and the server's start do the same) — also after a reset or a refused read.
    if (store.getDatabase(Number(dbId))?.schema.dataType === "documents") {
      const { queuedDocuments, startProcessing } = await import("@/plugins/documents/store").then(async (m) => ({ queuedDocuments: m.queuedDocuments, startProcessing: (await import("@/plugins/documents/process")).startProcessing }));
      if (queuedDocuments().length) startProcessing();
    }
    // A jobs database: the jobs whose worker has finished are taken in first (the page shows how they ended).
    if (store.getDatabase(Number(dbId))?.schema.jobs) {
      const jobs = await import("../jobs");
      jobs.ensureJobStates(Number(dbId)); // (an older jobs database gets Eingang and Ready)
      await jobs.settleJobs().catch(() => 0);
      void jobs.pumpJobs(Number(dbId)).catch(() => undefined); // (the agents take what is Ready, when they are on)
    }
    if (store.getDatabase(Number(dbId))?.schema.receive) (await import("../links")).resyncInto(Number(dbId)); // (copies follow their originals, also those made before something travelled)
    // A list ticked through every day (day-log.ts): opened after 4:00, it starts the day unticked.
    (await import("../day-log")).startDayIfNew(Number(dbId));
    const d = store.rowsOf(Number(dbId));
    const page = store.getPage(Number(dbId));
    if (!d || !page) throw new Error(t("This database is gone."));
    const labels = await store.labelsFor(d.schema, d.rows);
    const related: DatabaseData["related"] = {};
    for (const p of d.schema.properties) {
      if (p.type === "relation" && p.relationSource !== undefined && !related[p.relationSource]) {
        const st = (await import("../source-table")).sourceTable(p.relationSource);
        if (st) related[p.relationSource] = { title: st.schema.titleName, properties: st.schema.properties.map((q) => ({ id: q.id, name: q.name, type: q.type })), schema: st.schema, rows: [] };
      } else if (p.type === "relation" && p.relationDb !== undefined && !related[p.relationDb]) {
        const o = store.getPage(p.relationDb);
        if (o) related[p.relationDb] = { title: o.title, properties: (o.schema?.properties ?? []).map((q) => ({ id: q.id, name: q.name, type: q.type })), schema: o.schema ?? undefined, rows: store.rawRows(p.relationDb).map((r) => ({ id: r.id, title: r.title, icon: r.icon })) };
      }
    }
    const keys: Record<number, string> = {};
    for (const r of d.rows) {
      const k = rowKey(r);
      if (k) keys[r.id] = k;
    }
    const tickets = ticketExtras(Object.values(keys));
    // A database with a pipeline shows its own fields (its AI steps'), not the Ticket-Lage's — its tickets' todos stay.
    if (d.schema.pipeline?.steps.some((s) => s.kind === "source")) for (const k of Object.keys(tickets)) tickets[k] = { ...tickets[k], attention: null, attentionLabel: null, lead: null, summary: null, happened: [] };
    // A board's Lage fields (its AI review): the card's stripe, lead and summary from them.
    const { LAGE_FIELDS } = await import("../lage-fields");
    const { attentionLabels, isAttention } = await import("@/lib/runs/shared");
    for (const r of d.rows) {
      const k = keys[r.id];
      const att = r.cells[LAGE_FIELDS.attention];
      const lead = r.cells[LAGE_FIELDS.lead];
      if (!k || (typeof att !== "string" && typeof lead !== "string")) continue;
      const cur = tickets[k];
      const attention = typeof att === "string" && isAttention(att) ? att : (cur?.attention ?? null);
      tickets[k] = { attention, attentionLabel: attention && isAttention(attention) ? attentionLabels(t)[attention] : null, lead: typeof lead === "string" ? lead : (cur?.lead ?? null), summary: typeof r.cells[LAGE_FIELDS.summary] === "string" ? String(r.cells[LAGE_FIELDS.summary]) : (cur?.summary ?? null), happened: cur?.happened ?? [], todos: cur?.todos ?? [] };
    }
    const extras: DatabaseData["extras"] = { jobs: d.schema.jobs ? await (async () => { const j = await import("../jobs"); await j.upgradeDeliveries(d.rows).catch((e) => console.error("[jobs] upgrading deliveries failed", e)); return j.jobPanels(d.rows); })() : undefined, keys, subtasks: subtaskCounts(d.schema, d.rows, page.id), tickets, todosOn: isInstalled("todos"), ...collectionSwitches(page.id), me: await whoAmI(), source: collectionSource(page.id), fieldTypes: await (async () => (await import("@/plugins/contributions"), (await import("../field-types")).fieldTypeInfos()))(), running: (await import("../pipeline")).pipelineRunning(page.id), extSources: (await (await import("../source-point")).extSources()).map((x) => ({ id: x.id, label: x.label, icon: x.icon, hint: x.hint })), inboxPossible: (await import("../derived")).channelKinds().mail || (await import("../derived")).channelKinds().messages, appViews: await (async () => { const nav = await import("../app-nav"); return Promise.all((await import("../app-views")).appViewsFor(d.schema.dataType).map(async (a) => ({ id: a.id, label: t(a.label), icon: a.icon, nav: await nav.hasNav(a.id) }))); })(), capabilities: (await import("../capabilities")).capabilitiesOf(d.schema), derived: (await import("../derived")).derivedOf(page.id), derivedFrom: (await import("../derived")).derivedFrom(d.schema), previews: Object.fromEntries(d.rows.map((r) => [r.id, previewLines(store.getPage(r.id)?.content, 10)])), todoMarks: isInstalled("todos") ? (await import("../todo-marks")).todoMarks(d.rows, page.id) : undefined, links: (await import("../links")).linksIn(d.rows.map((r) => r.id)), rowView: (await import("../row-views")).rowViewOf(d.schema.dataType)?.id ?? null };
    return { data: { id: page.id, title: page.title, icon: page.icon, locked: page.locked || !!d.schema.protect?.lock, noNewRows: await readOnlyRows(page.id), schema: d.schema, rows: d.rows, labels, templates: store.rowTemplates(page.id).map((r) => ({ id: r.id, title: r.title || t("Untitled") })), related, extras } };
  });
}

export async function updateSchemaAction(dbId: number, schema: unknown) {
  return run(async () => {
    return { schema: store.saveSchema(Number(dbId), schema, t("Relation")) };
  });
}

export async function addRowAction(dbId: number, v: store.NewRow = {}) {
  return run(async () => {
    if (await readOnlyRows(Number(dbId))) throw new Error(t("This database only shows records from its source — rows cannot be added here."));
    const id = store.addRow(Number(dbId), v);
    // A row with a title in a two-way source (an appointment) is made there at once.
    if (v.title?.trim()) void import("../pipeline").then((p) => p.syncAfterEdit(id)).catch(() => undefined);
    return { id };
  });
}

export async function setCellAction(rowId: number, propId: string, value: unknown) {
  return run(async () => {
    // By your hand: a correction of an AI field goes into the feedback ledger.
    (await import("../ai-feedback")).setCellByHand(Number(rowId), String(propId), value);
    // A row of a two-way source (a person): the edit goes back to where it comes from.
    void import("../pipeline").then((p) => p.syncAfterEdit(Number(rowId))).catch(() => undefined);
    return {};
  });
}

/** What a block of a page shows about a ticket (/Lage, /Todos …): its key (given, else its page's row's), the card's extras and the detail. */
export async function ticketBlockAction(key: string, pageId?: number) {
  return run(async () => {
    let k = String(key ?? "").trim().toUpperCase();
    if (!k && pageId) {
      const p = store.getPage(Number(pageId));
      if (p?.dbId) k = rowKey({ id: p.id, cells: p.props }) ?? "";
    }
    if (!k) return { key: null, ticket: null, detail: null, todosOn: isInstalled("todos") };
    const t = await import("@/lib/items/tickets");
    return { key: k, ticket: t.ticketExtras([k])[k] ?? null, detail: t.ticketDetail(k), todosOn: isInstalled("todos") };
  });
}

/** The AI review of a database now (its AI properties for the rows that changed; `force`: all rows). */
export async function reviewDatabaseAction(dbId: number, force = false) {
  return run(async () => {
    if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
    const r = await (await import("../review")).reviewDatabase(Number(dbId), { force: !!force });
    if (!r.ok) throw new Error(r.error ?? t("Failed."));
    return { reviewed: r.reviewed, unchanged: r.unchanged };
  });
}

/** A database made from this one, under it: its rows (fields as they are), an AI filter after — its id. */
export async function createDerivedDatabaseAction(dbId: number, title?: string) {
  return run(async () => {
    const id = (await import("../derived")).createDerivedDatabase(Number(dbId), title ? String(title).slice(0, 200) : undefined);
    // Its rows right away, in the background (its AI filter judges them — the view follows as it does).
    (await import("../pipeline")).startPipeline(id, { ai: false });
    return { id };
  });
}

/** A database straight from a data source (its steps to add) — its id; its rows read at once, in the background. */
export async function createSourceDatabaseAction(from: string) {
  return run(async () => {
    const ok = ["jira", "keep", "todos", "mail", "messages", "inbox"] as const;
    const d = await import("../derived");
    // A source a plugin brings (People): "ext:<id>".
    const id = from.startsWith("ext:") ? await d.createExtSourceDatabase(from.slice(4)) : (ok as readonly string[]).includes(from) ? d.createSourceDatabase(from as (typeof ok)[number]) : (() => { throw new Error(t("Unknown source.")); })();
    (await import("../pipeline")).startPipeline(id, { ai: false });
    return { id };
  });
}

/** Any database made an inbox: the channels named as its sources, its rows read in the background (the Inbox view follows). */
/** Where an app view's navigation is: in the view, or in the Workspace tree under its database. */
export async function setNavPlaceAction(dbId: number, viewId: string, place: "view" | "workspace" | "off") {
  return run(async () => {
    (await import("../app-nav-store")).setNavPlace(Number(dbId), String(viewId), place === "workspace" || place === "off" ? place : "view");
    return {};
  });
}

/** A row made with New and closed again untouched: to the bin (see fresh-rows.ts). Whether it went. */
export async function discardIfUntouchedAction(rowId: number, madeWith: string[]) {
  return run(async () => ({ discarded: (await import("../fresh-rows")).discardIfUntouched(Number(rowId), Array.isArray(madeWith) ? madeWith.map(String) : []) }));
}

/** An entry of the navigation in the tree: hidden, or shown again (never deleted). */
export async function setNavHiddenAction(dbId: number, viewId: string, entry: string, hidden: boolean) {
  return run(async () => {
    (await import("../app-nav-store")).setNavHidden(Number(dbId), String(viewId), String(entry), !!hidden);
    return {};
  });
}

export async function makeInboxAction(dbId: number) {
  return run(async () => {
    const { makeInbox } = await import("../derived");
    makeInbox(Number(dbId));
    (await import("../pipeline")).startPipeline(Number(dbId), { ai: false });
    return {};
  });
}

/** The instructions an AI step can choose (pages under KI-Anweisungen). */
export async function instructionsAction() {
  return run(async () => {
    const i = await import("../instructions");
    return { folder: i.instructionsFolder(), instructions: i.listInstructions() };
  });
}

/** A new instruction (a page under KI-Anweisungen) — to write it. */
export async function newInstructionAction(title: string) {
  return run(async () => ({ id: await (await import("../instructions")).newInstruction(String(title ?? "").trim().slice(0, 200) || t("Instruction")) }));
}

/**
 * What a system page is (null: not one): where it comes from, what uses it, whether it differs from its default — and
 * whether it can go back to it. Generic: the Workspace knows system pages; the prompts are what they are today.
 */
export async function systemPageAction(pageId: number) {
  return run(async () => {
    const p = await import("@/lib/prompts");
    if (!p.isSystemPage(Number(pageId))) return { page: null };
    const prompt = await p.systemPromptOf(Number(pageId));
    return { page: prompt ? { kind: t("Prompt"), title: prompt.title, uses: t(prompt.uses), modified: prompt.modified, resettable: true, vars: prompt.vars } : { kind: t("System"), title: "", uses: "", modified: false, resettable: false, vars: [] as string[] } };
  });
}

/** A system page back to its default (a prompt: its built-in text). */
export async function resetSystemPageAction(pageId: number) {
  return run(async () => {
    await (await import("@/lib/prompts")).resetSystemPrompt(Number(pageId));
    return {};
  });
}

/** A page as an inline page shows it: kind, title, icon, its content, and its sub-pages. */
export async function pageEmbedAction(id: number) {
  return run(() => {
    const p = store.getPage(Number(id));
    if (!p || p.archivedAt) throw new Error(t("This page is gone."));
    const children = store
      .tree()
      .filter((x) => x.parentId === p.id)
      .map((x) => ({ id: x.id, title: x.title, icon: x.icon, kind: x.kind }));
    return { page: { kind: p.kind === "database" ? ("database" as const) : ("page" as const), title: p.title, icon: p.icon, content: JSON.stringify(p.content), rev: p.rev, children } };
  });
}

/** What an AI block on a page writes by its instruction (from the page and the databases shown in it). */
export async function aiBlockAction(pageId: number, prompt: string) {
  return run(async () => {
    if (!isInstalled("llm")) throw new Error(t("The LLM plugin is needed for this (Menu → Plugins)."));
    return { text: await (await import("../ai-block")).writeAiBlock(Number(pageId), String(prompt ?? "").slice(0, 2000)), at: new Date().toISOString() };
  });
}

/** A data source's databases kept now from what Zeff has (Jira's boards, Google Keep's notes) — after a sync, or a board switched on. */
export async function keepSourceDatabasesAction(key: string) {
  return run(async () => {
    if (key === "jira" && isInstalled("jira-lage")) await (await import("@/plugins/jira-lage/to-workspace")).syncJiraBoardDatabases();
    if (key === "keep" && isInstalled("keep")) (await import("@/plugins/keep/google-workspace")).syncGoogleKeepDatabase();
    return {};
  });
}

/** A ticket's detail beyond its card (questions, suggested actions, flags, context, chat) — fetched when its row's panel opens. */
export async function ticketDetailAction(key: string) {
  return run(async () => ({ detail: (await import("@/lib/items/tickets")).ticketDetail(String(key)) }));
}

/** A database's sensitivity (open, personal, secret — Settings → Data boundaries); null: back to its default. */
export async function setDatabaseLabelAction(dbId: number, label: "open" | "personal" | "secret" | null) {
  return run(async () => {
    const { isLabel } = await import("@/lib/boundaries/shared");
    if (label !== null && !isLabel(label)) throw new Error(t("No such label."));
    if (!store.getDatabase(Number(dbId))) throw new Error(t("This page is gone."));
    (await import("../sensitivity")).setDatabaseLabel(Number(dbId), label);
    return {};
  });
}

/** A database into the briefing (its rows: tickets or notes of the Lage) or the knowledge, or out — Kanban's "into the briefing". */
export async function setCollectionAction(dbId: number, patch: { briefing?: boolean; knowledge?: boolean }) {
  return run(() => {
    setCollection(`workspace:${Number(dbId)}`, { ...(patch.briefing !== undefined ? { briefing: !!patch.briefing } : {}), ...(patch.knowledge !== undefined ? { knowledge: !!patch.knowledge } : {}) });
    return {};
  });
}

/** Every database, to choose from (relations, linked views). */
/** What a relation can point at besides databases (the booked time …), with its properties — for the rollup wizard. */
export async function relationSourcesAction() {
  return run(async () => {
    const st = await import("../source-table");
    return { sources: st.relationSources().flatMap((x) => { const tbl = st.sourceTable(x.id); return tbl ? [{ ...x, schema: tbl.schema }] : []; }) };
  });
}

/** What a rollup wizard needs of another database: its schema (properties and their options). */
export async function databaseSchemaAction(id: number) {
  return run(() => {
    const d = store.getDatabase(Number(id));
    if (!d) throw new Error(t("This database is gone."));
    return { title: d.page.title, schema: d.schema };
  });
}

export async function databasesAction() {
  return run(() => ({ databases: store.tree().filter((x) => x.kind === "database").map((x) => ({ id: x.id, title: x.title || t("Untitled"), icon: x.icon, rules: !!store.getDatabase(x.id)?.schema.rules, jobs: !!store.getDatabase(x.id)?.schema.jobs, people: store.getDatabase(x.id)?.schema.dataType === "people" })) }));
}

/** People and open todos to put in person/todo cells. */
export async function cellChoicesAction(kind: "person" | "todo", q: string) {
  return run(async () => {
    const w = String(q ?? "").trim().toLowerCase();
    if (kind === "person") {
      if (!isInstalled("people")) return { items: [] as { id: number; label: string }[] };
      const { listPeople } = await import("@/plugins/people/store");
      return { items: listPeople().filter((p) => !w || p.name.toLowerCase().includes(w) || p.aliases.some((a) => a.toLowerCase().includes(w))).slice(0, 10).map((p) => ({ id: p.id, label: p.name })) };
    }
    if (!isInstalled("todos")) return { items: [] as { id: number; label: string }[] };
    const { listTodos, searchTodos } = await import("@/lib/todos/store");
    const found = w ? searchTodos(w, 10) : listTodos({ status: "open" }).slice(0, 10);
    return { items: found.map((x) => ({ id: x.id, label: `${x.ref} ${x.text}`.slice(0, 80) })) };
  });
}

export async function importCsvAction(csv: string, title: string, parentId: number | null) {
  return run(() => {
    const table = parseCsv(String(csv ?? ""));
    if (table.length < 1 || !table[0].length) throw new Error(t("The file has no rows."));
    const imp = csvToDatabase(table);
    const id = store.createPage({ parentId, kind: "database", title: title || t("Imported table"), schema: imp.schema });
    const created = imp.schema.properties;
    void created;
    for (const r of imp.rows.slice(0, 5000)) store.addRow(id, r);
    return { id, rows: imp.rows.length };
  });
}

export async function exportDatabaseCsvAction(dbId: number, viewId?: string) {
  return run(async () => {
    const d = store.rowsOf(Number(dbId));
    const page = store.getPage(Number(dbId));
    if (!d || !page) throw new Error(t("This database is gone."));
    const labels = store.labelFns(await store.labelsFor(d.schema, d.rows));
    const view = d.schema.views.find((v) => v.id === viewId);
    const { filterRows, sortRows } = await import("../model");
    const rows = view ? sortRows(filterRows(d.rows, view.filter, d.schema.properties, labels), view.sorts, d.schema.properties) : d.rows;
    return { filename: `${(page.title || "database").replace(/[^\p{L}\p{N}_-]+/gu, "_")}.csv`, csv: rowsToCsv(d.schema, rows, view, labels) };
  });
}

// ---------------------------------------------------------------------------
// An old chart block of a page (legacy-blocks.ts): the chart view it becomes
// ---------------------------------------------------------------------------

/** The chart view an old chart block's marker stands for — one of the same settings, else made now (data-block-migration.ts). */
export async function chartViewAction(dbId: number, marker: string, title: string) {
  return run(async () => {
    const { parseChartMarker } = await import("../legacy-blocks");
    const spec = parseChartMarker(String(marker ?? ""));
    if (!spec) throw new Error(t("Unknown block."));
    const viewId = (await import("../data-block-migration")).ensureChartView(Number(dbId), spec, String(title ?? ""));
    if (!viewId) throw new Error(t("No such database."));
    return { viewId };
  });
}
