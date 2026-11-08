"use server";

import { run } from "./shared";

// ---------------------------------------------------------------------------
// Flows (flows/): what a view's run= and <data> call, what the Studio edits and runs, the lifecycles' transitions
// ---------------------------------------------------------------------------

const MAX_INPUT = 200_000;

function inputOf(raw: unknown): Record<string, unknown> {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (JSON.stringify(o).length > MAX_INPUT) throw new Error("The input is too large.");
  return o;
}

/** A flow run by its name — a view's button (run="…") or <data>. Its output; `row`: the row the button stands in. */
export async function runFlowAction(name: string, input: Record<string, unknown> = {}, opts: { row?: number; dry?: boolean } = {}) {
  return run(async () => {
    const { runFlow } = await import("../flows/engine");
    return runFlow(String(name), inputOf(input), { trigger: { kind: "button" }, ...(Number(opts.row) > 0 ? { row: Number(opts.row) } : {}), dry: opts.dry === true });
  });
}

/** Every flow (name, title, inputs, whether it is a lookup), for the Studio and a template's checks. */
export async function listFlowsAction() {
  return run(async () => ({ flows: (await import("../flows/store")).listFlows().map((f) => ({ pageId: f.pageId, parentId: f.parentId, name: f.name, title: f.title, description: f.description ?? "", inputs: f.inputs, lookup: !!f.lookup, enabled: f.enabled !== false, triggers: f.triggers, lastRunAt: f.lastRunAt })) }));
}

export async function getFlowAction(pageId: number) {
  return run(async () => {
    const f = (await import("../flows/store")).getFlow(Number(pageId));
    if (!f) throw new Error("This page is no flow.");
    return { flow: f };
  });
}

export async function createFlowAction(def: unknown, parentId: number | null = null) {
  return run(async () => ({ flow: (await import("../flows/store")).createFlow(def, parentId === null ? null : Number(parentId)) }));
}

export async function saveFlowAction(pageId: number, def: unknown) {
  return run(async () => ({ flow: (await import("../flows/store")).saveFlow(Number(pageId), def) }));
}

/** A flow's runs, newest first (the run console). */
export async function flowRunsAction(pageId: number, beforeId?: number) {
  return run(async () => ({ runs: (await import("../flows/store")).flowRuns(Number(pageId), 20, beforeId === undefined ? undefined : Number(beforeId)) }));
}

export async function flowRunAction(runId: number) {
  return run(async () => ({ run: (await import("../flows/store")).getFlowRun(Number(runId)) }));
}

/** The runs that wait for your approval. */
export async function waitingFlowRunsAction() {
  return run(async () => ({ runs: (await import("../flows/store")).waitingRuns().map((r) => ({ id: r.id, name: r.name, pageId: r.pageId, waiting: r.waiting, startedAt: r.startedAt })) }));
}

export async function resumeFlowRunAction(runId: number, choice: string, note?: string) {
  return run(async () => (await import("../flows/engine")).resumeFlowRun(Number(runId), { choice: String(choice), ...(note ? { note: String(note).slice(0, 2000) } : {}) }));
}

export async function cancelFlowRunAction(runId: number) {
  return run(async () => ((await import("../flows/engine")).cancelFlowRun(Number(runId)), {}));
}

/** What a flow's nodes can call: the actions with their inputs, and the filters of the expressions. */
export async function flowCatalogAction() {
  return run(async () => {
    const { actionCatalog } = await import("../flows/actions");
    const { FLOW_FILTERS } = await import("../flows/expr");
    return { actions: actionCatalog(), filters: Object.fromEntries(Object.entries(FLOW_FILTERS).map(([k, v]) => [k, v.what])) };
  });
}

/** The secrets' names (never their values). */
export async function flowSecretsAction() {
  return run(async () => ({ secrets: (await import("../flows/store")).secretNames() }));
}

/** A secret set (an empty value removes it). */
export async function setFlowSecretAction(name: string, value: string) {
  return run(async () => ((await import("../flows/store")).setSecret(String(name).trim(), String(value)), {}));
}

/** A row takes a transition of its lifecycle (a button with transition="…"). */
export async function takeTransitionAction(rowId: number, transition: string, note?: string) {
  return run(async () => (await import("../flows/lifecycle")).takeTransition(Number(rowId), String(transition), { by: "you", ...(note ? { note: String(note).slice(0, 2000) } : {}) }));
}

/** A row's transitions now (which can be taken, why not) and its way so far. */
export async function rowLifecycleAction(rowId: number) {
  return run(async () => {
    const { getPage, rowsOf } = await import("../store");
    const page = getPage(Number(rowId));
    const d = page?.dbId ? rowsOf(page.dbId) : null;
    const row = d?.rows.find((r) => r.id === Number(rowId));
    if (!d || !row || !d.schema.lifecycle) return { transitions: [], history: [] };
    const { transitionsOf, rowHistory } = await import("../flows/lifecycle");
    // (The states and transitions by their names, as they read now.)
    const lc = d.schema.lifecycle;
    const opts = d.schema.properties.find((p) => p.id === lc.field)?.options ?? [];
    const state = (id: string | null) => (id ? (opts.find((o) => o.id === id)?.name ?? id) : null);
    const named = (id: string | null) => (id ? (lc.transitions.find((x) => x.id === id)?.name ?? id) : null);
    return { transitions: transitionsOf(d.schema, row), history: rowHistory(row.id).map((h) => ({ ...h, from: state(h.from), to: state(h.to) ?? h.to, transition: named(h.transition) })) };
  });
}

/** The databases with a status or select field (the lifecycles' editor): their fields' options, their lifecycle. */
export async function lifecycleDatabasesAction() {
  return run(async () => {
    const { tree, getDatabase } = await import("../store");
    const dbs = tree()
      .filter((p) => p.kind === "database" && !p.system)
      .flatMap((p) => {
        const s = getDatabase(p.id)?.schema;
        if (!s) return [];
        const fields = s.properties.filter((q) => q.type === "status" || q.type === "select").map((q) => ({ id: q.id, name: q.name, options: (q.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color })) }));
        return fields.length ? [{ id: p.id, title: p.title || "", icon: p.icon ?? "", fields, props: s.properties.map((q) => ({ id: q.id, name: q.name, type: q.type })), lifecycle: s.lifecycle ?? null }] : [];
      });
    return { databases: dbs };
  });
}

/** A database's lifecycle set (null: none). */
export async function saveLifecycleAction(dbId: number, lifecycle: unknown) {
  return run(async () => {
    const { getDatabase, updateSchema } = await import("../store");
    const d = getDatabase(Number(dbId));
    if (!d) throw new Error("There is no such database.");
    const { lifecycle: _was, ...rest } = d.schema;
    const saved = updateSchema(Number(dbId), lifecycle ? { ...rest, lifecycle: lifecycle as never } : rest);
    if (lifecycle && !saved.lifecycle) throw new Error("The lifecycle needs a status or select field.");
    return { lifecycle: saved.lifecycle ?? null };
  });
}

/** A flow put away (its page to the trash; it can be brought back). */
export async function archiveFlowAction(pageId: number) {
  return run(async () => {
    const { archivePage } = await import("../store");
    archivePage(Number(pageId));
    return {};
  });
}

/** A flow's problems (unknown actions, missing inputs, broken expressions) — shown while it is edited. */
export async function checkFlowAction(def: unknown) {
  return run(async () => {
    const { normalizeFlow } = await import("../flows/types");
    const { checkFlow } = await import("../flows/check");
    return { problems: checkFlow(normalizeFlow(def)) };
  });
}

/** Every database (a flow's write permission, an event trigger). */
export async function flowDatabasesAction() {
  return run(async () => {
    const { tree } = await import("../store");
    return { databases: tree().filter((p) => p.kind === "database" && !p.system).map((p) => ({ id: p.id, title: p.title || "", icon: p.icon ?? "" })) };
  });
}

/** What waits for you now: the questions to you (a flow's, an agent's, an approval) — the card on every page shows them. */
export async function pendingAsksAction() {
  return run(async () => {
    const { openAsks } = await import("../asks");
    return { asks: openAsks().slice(0, 10).map((a) => ({ id: a.id, from: a.from, source: a.source.kind, title: a.title, text: a.text, fields: a.fields, expiresAt: a.expiresAt, at: a.createdAt })) };
  });
}

/** A question answered (its answers checked); whoever asked goes on with them. */
export async function answerAskAction(askId: number, answers: Record<string, unknown>) {
  return run(async () => {
    const a = await (await import("../asks")).answerAsk(Number(askId), answers && typeof answers === "object" ? answers : {});
    return { status: a.status };
  });
}

/** A question dismissed: whoever asked hears there is no answer. */
export async function dismissAskAction(askId: number) {
  return run(async () => {
    await (await import("../asks")).cancelAsk(Number(askId));
    return {};
  });
}
