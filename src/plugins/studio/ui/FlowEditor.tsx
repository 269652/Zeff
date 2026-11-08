"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { checkFlowAction, flowCatalogAction, flowDatabasesAction, flowSecretsAction, getFlowAction, listFlowsAction, runFlowAction, saveFlowAction } from "@/plugins/workspace/actions";
import { askWorkspace } from "@/plugins/workspace/ui/chat-client";
import type { FlowRun } from "@/plugins/workspace/flows/store";
import { FIELD_TYPES, NODE_KINDS, type FieldSpec, type FlowDef, type FlowNode, type FlowNodeKind, type FlowPermissions, type FlowTrigger } from "@/plugins/workspace/flows/types";
import { findNode, insertNode, moveNode, newNode, pathsBefore, removeNode, updateNode, type Slot } from "../tree";
import { Canvas, KIND_ICON, type NodeRun } from "./Canvas";
import { Inspector, type CatalogAction } from "./Inspector";
import { RunConsole } from "./RunConsole";

/**
 * One flow in the Studio: its canvas with the node picked in the inspector beside it, its inputs and output, its triggers, what it
 * may reach (and what the AI asked for, granted with a click), its definition as JSON, its runs — and a run started from here, for
 * real or dry, and the copilot that changes it on request.
 */

type Draft = FlowDef & { pageId: number };
type Tab = "canvas" | "setup" | "permissions" | "json" | "runs";

const KIND_LABEL = (t: ReturnType<typeof useT>): Record<FlowNodeKind, string> => ({ action: t("Action"), set: t("Set variables"), if: t("If / else"), switch: t("Switch"), foreach: t("For each"), parallel: t("In parallel"), try: t("Try / catch"), script: t("JavaScript"), ask: t("Ask me"), approve: t("Approval"), wait: t("Wait"), call: t("Call a flow"), return: t("Return"), fail: t("Fail") });

export function FlowEditor({ pageId, onChanged }: { pageId: number; onChanged: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState("");
  const [catalog, setCatalog] = useState<CatalogAction[]>([]);
  const [flows, setFlows] = useState<string[]>([]);
  const [secrets, setSecrets] = useState<string[]>([]);
  const [dbs, setDbs] = useState<{ id: number; title: string; icon: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("canvas");
  const [adding, setAdding] = useState<{ slot: Slot; index: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [tick, setTick] = useState(0);
  const [focusRun, setFocusRun] = useState<number | null>(null);
  const [runInput, setRunInput] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState<string[] | null>(null);
  const [json, setJson] = useState("");

  const load = useCallback(async () => {
    const r = await getFlowAction(pageId);
    if (!r.ok) return toast(r.error, { tone: "error" });
    const { lastRunAt: _l, nextRunAt: _n, ...def } = r.flow;
    setDraft(def);
    setSaved(JSON.stringify(def));
    setJson(JSON.stringify(def, null, 2));
  }, [pageId]);

  useEffect(() => {
    void (async () => {
      await load();
      const [c, f, s, d] = await Promise.all([flowCatalogAction(), listFlowsAction(), flowSecretsAction(), flowDatabasesAction()]);
      if (c.ok) setCatalog(c.actions as CatalogAction[]);
      if (f.ok) setFlows(f.flows.map((x) => x.name));
      if (s.ok) setSecrets(s.secrets.map((x) => x.name));
      if (d.ok) setDbs(d.databases);
    })();
  }, [load]);

  // The problems, checked a moment after it changed.
  const key = draft ? JSON.stringify({ ...draft, pageId: undefined }) : "";
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => void checkFlowAction(draft).then((r) => r.ok && setProblems(r.problems)), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key holds the draft
  }, [key]);

  const nodeRuns = useMemo(() => {
    const out: Record<string, NodeRun & { input?: unknown; output?: unknown; error?: string; logs?: string[] }> = {};
    for (const l of runs[0]?.log ?? []) out[l.node] = { status: l.status, ms: l.ms, input: l.input, output: l.output, error: l.error, logs: l.logs };
    return out;
  }, [runs]);

  if (!draft) return <p className="text-sm text-zinc-500">{t("Loading …")}</p>;

  const dirty = JSON.stringify(draft) !== saved;
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setNodes = (nodes: FlowNode[]) => set({ nodes });
  const node = selected ? findNode(draft.nodes, selected) : null;
  const kinds = KIND_LABEL(t);

  const save = async () => {
    const r = await saveFlowAction(pageId, draft);
    if (!r.ok) return toast(r.error, { tone: "error" });
    const { lastRunAt: _l, nextRunAt: _n, ...def } = r.flow;
    setDraft(def);
    setSaved(JSON.stringify(def));
    setJson(JSON.stringify(def, null, 2));
    toast(t("Saved."), { tone: "ok" });
    onChanged();
  };

  const start = async (dry: boolean) => {
    if (dirty) {
      const r = await saveFlowAction(pageId, draft);
      if (!r.ok) return toast(r.error, { tone: "error" });
      setSaved(JSON.stringify(draft));
    }
    setBusy(true);
    const r = await runFlowAction(draft.name, runInput, { dry });
    setBusy(false);
    if (!r.ok) return toast(r.error, { tone: "error" });
    setFocusRun(r.runId);
    setTick((x) => x + 1);
    if (r.status === "failed") toast(r.error ?? t("The flow failed."), { tone: "error" });
    else if (r.status === "waiting") toast(t("It waits — see its run."), { ms: 5000 });
    else toast(dry ? t("Dry run done: nothing was written.") : t("Done."), { tone: "ok" });
  };

  const copilot = async () => {
    if (!ask.trim()) return;
    if (dirty) {
      const r = await saveFlowAction(pageId, draft);
      if (!r.ok) return toast(r.error, { tone: "error" });
    }
    setAsking([]);
    const request = `Im Flow „${draft.name}“ (Seite ${pageId}, lies ihn mit workspace_read_flow): ${ask.trim()}\nÄndere ihn mit workspace_save_flow (gleicher Name, page ${pageId}) und probiere ihn mit workspace_run_flow (dry: true, wenn er schreibt). Sag am Ende kurz, was du geändert hast und welche Rechte er braucht.`;
    const r = await askWorkspace([{ role: "user", text: request }], pageId, (steps) => setAsking(steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.summary}`)));
    setAsking(null);
    if (!r.ok) return toast(r.error, { tone: "error" });
    setAsk("");
    toast(r.reply || t("Done."), { tone: "ok", ms: 10000 });
    await load();
    setTick((x) => x + 1);
    onChanged();
  };

  const add = (kind: FlowNodeKind, action?: string) => {
    if (!adding) return;
    const n = newNode(draft.nodes, kind, action);
    setNodes(insertNode(draft.nodes, adding.slot, adding.index, n));
    setSelected(n.id);
    setAdding(null);
  };

  const requested = draft.requested && Object.keys(draft.requested).length ? draft.requested : null;
  const grant = () => set({ permissions: { ...draft.permissions, ...draft.requested }, requested: undefined });

  const TABS: [Tab, string][] = [
    ["canvas", t("Canvas")],
    ["setup", t("Inputs & triggers")],
    ["permissions", t("Permissions")],
    ["json", "JSON"],
    ["runs", t("Runs")],
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-xl" aria-hidden>
          {draft.lookup ? "🔎" : "⚡"}
        </span>
        <div className="min-w-0 flex-1">
          <input className="w-full bg-transparent text-lg font-semibold outline-none" value={draft.title ?? ""} placeholder={draft.name} aria-label={t("Title")} onChange={(e) => set({ title: e.target.value || undefined })} />
          <input className="w-full bg-transparent font-mono text-xs text-zinc-500 outline-none" value={draft.name} aria-label={t("Name")} onChange={(e) => set({ name: e.target.value.toLowerCase() })} />
        </div>
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="accent-indigo-600" checked={draft.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} />
          {t("On")}
        </label>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void start(true)} title={t("Reads and fetches, writes nothing")}>
          {t("Dry run")}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void start(false)}>
          ▶ {t("Run")}
        </button>
        <button type="button" className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => void save()}>
          {t("Save")}
        </button>
      </header>

      {draft.inputs.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
          <span className="label mb-1">{t("Run with")}</span>
          {draft.inputs.map((f) => (
            <label key={f.name} className="space-y-0.5">
              <span className="block text-xs text-zinc-500">
                {f.label || f.name}
                {f.required ? " *" : ""}
              </span>
              <input className="input w-44 py-1" value={runInput[f.name] ?? ""} placeholder={f.default !== undefined ? String(f.default) : f.type} onChange={(e) => setRunInput((x) => ({ ...x, [f.name]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}

      {requested && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <span className="flex-1">
            {t("The AI asks for")}: <code className="text-xs">{JSON.stringify(requested)}</code>
          </span>
          <button type="button" className="btn btn-sm btn-primary" onClick={grant}>
            {t("Grant")}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => set({ requested: undefined })}>
            {t("Refuse")}
          </button>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="space-y-0.5 rounded-xl border border-red-200 bg-red-50/60 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {problems.map((x) => (
            <li key={x}>⚠ {x}</li>
          ))}
        </ul>
      )}

      <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === id ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`} onClick={() => (id === "json" && setJson(JSON.stringify(draft, null, 2)), setTab(id))}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "canvas" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Canvas nodes={draft.nodes} selected={selected} onSelect={setSelected} onAdd={(slot, index) => setAdding({ slot, index })} runs={nodeRuns} />
          <aside className="card h-fit space-y-3 p-3 xl:sticky xl:top-0 xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">
            {adding ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{t("Add a node")}</span>
                  <button type="button" className="icon-btn" aria-label={t("Close")} onClick={() => setAdding(null)}>
                    ×
                  </button>
                </div>
                {[...new Set(catalog.map((a) => a.group))].map((g) => (
                  <div key={g}>
                    <div className="label">{g}</div>
                    <div className="grid grid-cols-2 gap-1">
                      {catalog
                        .filter((a) => a.group === g)
                        .map((a) => (
                          <button key={a.name} type="button" className="rounded-md border border-zinc-200 px-2 py-1 text-left text-xs hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:hover:bg-indigo-950" title={a.summary} onClick={() => add("action", a.name)}>
                            {a.label}
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
                <div>
                  <div className="label">{t("Logic")}</div>
                  <div className="grid grid-cols-2 gap-1">
                    {NODE_KINDS.filter((k) => k !== "action").map((k) => (
                      <button key={k} type="button" className="rounded-md border border-zinc-200 px-2 py-1 text-left text-xs hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:hover:bg-indigo-950" onClick={() => add(k)}>
                        {KIND_ICON[k]} {kinds[k]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : node ? (
              <Inspector
                key={node.id}
                node={node}
                catalog={catalog}
                flows={flows.filter((f) => f !== draft.name)}
                paths={pathsBefore(draft, node.id, secrets)}
                run={nodeRuns[node.id]}
                onChange={(patch) => setNodes(updateNode(draft.nodes, node.id, patch))}
                onMove={(by) => setNodes(moveNode(draft.nodes, node.id, by))}
                onRemove={() => (setNodes(removeNode(draft.nodes, node.id)), setSelected(null))}
              />
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-zinc-500">{t("Pick a node to edit it, or + to add one.")}</p>
                <div className="space-y-2">
                  <div className="label">✨ {t("Copilot")}</div>
                  <textarea className="input" rows={4} value={ask} placeholder={t("What should the flow do? E.g. “look the film up at TMDB, then put its rating and poster into the row”")} onChange={(e) => setAsk(e.target.value)} />
                  <button type="button" className="btn btn-sm btn-primary" disabled={asking !== null || !ask.trim()} onClick={() => void copilot()}>
                    {asking !== null ? t("Working …") : t("Change the flow")}
                  </button>
                  {asking && asking.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-zinc-500">
                      {asking.slice(-6).map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {tab === "setup" && <Setup draft={draft} set={set} dbs={dbs} />}

      {tab === "permissions" && <Permissions value={draft.permissions} dbs={dbs} onChange={(permissions) => set({ permissions })} />}

      {tab === "json" && (
        <div className="space-y-2">
          <textarea className="input font-mono text-xs" rows={28} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              try {
                const parsed = JSON.parse(json) as FlowDef;
                set({ ...parsed, pageId });
                toast(t("Taken over — save to keep it."), { tone: "ok" });
              } catch (e) {
                toast((e as Error).message, { tone: "error" });
              }
            }}
          >
            {t("Take over")}
          </button>
        </div>
      )}

      {/* (Read while hidden too: the canvas shows the last run's marks.) */}
      <div hidden={tab !== "runs"}>
        <RunConsole pageId={pageId} tick={tick} focus={focusRun} onRuns={setRuns} onPick={(id) => (setSelected(id), setTab("canvas"))} />
      </div>
    </div>
  );
}

function Setup({ draft, set, dbs }: { draft: Draft; set: (p: Partial<Draft>) => void; dbs: { id: number; title: string }[] }) {
  const t = useT();
  const inputs = draft.inputs;
  const setInput = (i: number, patch: Partial<FieldSpec>) => set({ inputs: inputs.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const trig = draft.triggers;
  const setTrig = (i: number, x: FlowTrigger) => set({ triggers: trig.map((y, j) => (j === i ? x : y)) });
  const lookup = draft.lookup;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <h3 className="font-semibold">{t("Inputs")}</h3>
        <p className="text-xs text-zinc-500">{t("What a run is given: a button's with=, a form, another flow. In the nodes: input.<name>.")}</p>
        {inputs.map((f, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <input className="input w-32 font-mono text-xs" value={f.name} aria-label={t("Name")} onChange={(e) => setInput(i, { name: e.target.value })} />
            <select className="input w-28" value={f.type} aria-label={t("Type")} onChange={(e) => setInput(i, { type: e.target.value as FieldSpec["type"] })}>
              {FIELD_TYPES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input className="input w-32" value={f.label ?? ""} placeholder={t("Label")} onChange={(e) => setInput(i, { label: e.target.value || undefined })} />
            <input className="input w-28" value={f.default === undefined ? "" : String(f.default)} placeholder={t("Default")} onChange={(e) => setInput(i, { default: e.target.value === "" ? undefined : e.target.value })} />
            <label className="inline-flex items-center gap-1 text-xs">
              <input type="checkbox" className="accent-indigo-600" checked={!!f.required} onChange={(e) => setInput(i, { required: e.target.checked || undefined })} />
              {t("required")}
            </label>
            <button type="button" className="icon-btn icon-btn-danger" aria-label={t("Remove")} onClick={() => set({ inputs: inputs.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => set({ inputs: [...inputs, { name: `input${inputs.length + 1}`, type: "text" }] })}>
          + {t("Input")}
        </button>

        <h3 className="pt-4 font-semibold">{t("Output")}</h3>
        <p className="text-xs text-zinc-500">{t("An expression or JSON — empty: what the last node gave.")}</p>
        <textarea className="input font-mono text-xs" rows={4} value={draft.output === undefined ? "" : typeof draft.output === "string" ? draft.output : JSON.stringify(draft.output, null, 2)} onChange={(e) => { const v = e.target.value; let out: unknown = v || undefined; if (/^\s*[[{]/.test(v)) { try { out = JSON.parse(v); } catch { out = v; } } set({ output: out }); }} />

        <h3 className="pt-4 font-semibold">{t("Description")}</h3>
        <textarea className="input" rows={2} value={draft.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} />
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t("Triggers")}</h3>
        <p className="text-xs text-zinc-500">{t("A flow always runs by hand, from a button or another flow; these start it by themselves.")}</p>
        {trig.map((x, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
            <select className="input w-32" value={x.kind} aria-label={t("Trigger")} onChange={(e) => setTrig(i, e.target.value === "schedule" ? { kind: "schedule", at: "08:00" } : e.target.value === "event" ? { kind: "event", event: "row.added" } : { kind: "manual" })}>
              <option value="manual">{t("by hand")}</option>
              <option value="schedule">{t("on a schedule")}</option>
              <option value="event">{t("when something happens")}</option>
            </select>
            {x.kind === "schedule" && (
              <>
                <input className="input w-24" placeholder="08:00" value={x.at ?? ""} aria-label={t("At")} onChange={(e) => setTrig(i, { kind: "schedule", at: e.target.value || undefined, days: x.days })} />
                <span className="text-xs text-zinc-500">{t("or every")}</span>
                <input className="input w-20" type="number" min={5} value={x.everyMinutes ?? ""} aria-label={t("Every … minutes")} onChange={(e) => setTrig(i, { kind: "schedule", everyMinutes: Number(e.target.value) || undefined })} />
                <span className="text-xs text-zinc-500">{t("min")}</span>
              </>
            )}
            {x.kind === "event" && (
              <>
                <select className="input w-36" value={x.event} aria-label={t("Event")} onChange={(e) => setTrig(i, { ...x, event: e.target.value as typeof x.event })}>
                  {["row.added", "row.changed", "row.removed", "transition", "signal", "form.submitted"].map((ev) => (
                    <option key={ev}>{ev}</option>
                  ))}
                </select>
                {x.event !== "signal" && (
                  <select className="input w-44" value={x.db ?? ""} aria-label={t("Database")} onChange={(e) => setTrig(i, { ...x, db: Number(e.target.value) || undefined })}>
                    <option value="">{t("any database")}</option>
                    {dbs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                )}
                {x.event === "signal" ? <input className="input w-36" placeholder={t("signal name")} value={x.name ?? ""} onChange={(e) => setTrig(i, { ...x, name: e.target.value || undefined })} /> : <input className="input w-28" placeholder={t("field")} value={x.field ?? ""} onChange={(e) => setTrig(i, { ...x, field: e.target.value || undefined })} />}
                {x.event === "row.changed" && <input className="input w-28" placeholder={t("becomes")} value={x.equals ?? ""} onChange={(e) => setTrig(i, { ...x, equals: e.target.value || undefined })} />}
              </>
            )}
            <button type="button" className="icon-btn icon-btn-danger ml-auto" aria-label={t("Remove")} onClick={() => set({ triggers: trig.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => set({ triggers: [...trig, { kind: "schedule", at: "08:00" }] })}>
          + {t("Trigger")}
        </button>

        <h3 className="pt-4 font-semibold">{t("Lookup source")}</h3>
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="accent-indigo-600" checked={!!lookup} onChange={(e) => set({ lookup: e.target.checked ? { label: draft.title || draft.name, what: "", fields: {} } : undefined })} />
          {t("A <lookup> in a view can search it")}
        </label>
        {lookup && (
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">{t("It is called with input.mode “search” (input.query) and gives hits [{ id, title, subtitle, image }]; with “details” (input.id) it gives the fields.")}</p>
            <input className="input" placeholder={t("Label")} value={lookup.label} onChange={(e) => set({ lookup: { ...lookup, label: e.target.value } })} />
            <input className="input" placeholder={t("What it finds (for the AI)")} value={lookup.what} onChange={(e) => set({ lookup: { ...lookup, what: e.target.value } })} />
            <input className="input font-mono text-xs" placeholder={t("Fields, separated by commas")} value={Object.keys(lookup.fields).join(", ")} onChange={(e) => set({ lookup: { ...lookup, fields: Object.fromEntries(e.target.value.split(",").map((x) => x.trim()).filter(Boolean).map((k) => [k, lookup.fields[k] ?? k])) } })} />
            <label className="inline-flex items-center gap-1.5 text-xs">
              <input type="checkbox" className="accent-indigo-600" checked={!!lookup.slow} onChange={(e) => set({ lookup: { ...lookup, slow: e.target.checked || undefined } })} />
              {t("Slow or costly: search only on Enter")}
            </label>
          </div>
        )}
      </section>
    </div>
  );
}

function Permissions({ value, dbs, onChange }: { value: FlowPermissions; dbs: { id: number; title: string; icon: string }[]; onChange: (v: FlowPermissions) => void }) {
  const t = useT();
  const write = value.write;
  const writes = (id: number) => write === "all" || (Array.isArray(write) && write.includes(id));
  const toggle = (id: number, on: boolean) => {
    const cur = write === "all" ? dbs.map((d) => d.id) : (write ?? []);
    const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    onChange({ ...value, write: next.length ? next : undefined });
  };
  const flag = (k: "ai" | "send" | "api" | "create", label: string, help: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1 accent-indigo-600" checked={!!value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked || undefined })} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-zinc-500">{help}</span>
      </span>
    </label>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <div>
          <h3 className="font-semibold">{t("The web")}</h3>
          <p className="text-xs text-zinc-500">{t("The addresses it may fetch: domains (their subdomains too), separated by commas — * for any public address. Your own network stays out of reach.")}</p>
          <input className="input mt-1 font-mono text-xs" placeholder="api.themoviedb.org, en.wikipedia.org" value={(value.web ?? []).join(", ")} onChange={(e) => onChange({ ...value, web: e.target.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) })} />
        </div>
        {flag("create", t("Make databases"), t("db.ensure makes a database when it isn't there — and the flow may write what it made."))}
        {flag("ai", t("The AI"), t("AI nodes (pick out fields, answer, sort) — they cost."))}
        {flag("send", t("Sending out"), t("Requests that change something elsewhere (POST, PUT, DELETE), mail, messages."))}
        {flag("api", t("Every plugin method"), t("Also the methods that aren't marked safe for automations."))}
        <label className="block space-y-1">
          <span className="label mb-0">{t("Most steps per run")}</span>
          <input className="input w-32" type="number" min={10} value={value.maxSteps ?? 500} onChange={(e) => onChange({ ...value, maxSteps: Number(e.target.value) || undefined })} />
        </label>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">{t("Databases it may write")}</h3>
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="accent-indigo-600" checked={write === "all"} onChange={(e) => onChange({ ...value, write: e.target.checked ? "all" : undefined })} />
          {t("All of them")}
        </label>
        <ul className="max-h-96 space-y-0.5 overflow-y-auto rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
          {dbs.map((d) => (
            <li key={d.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-indigo-600" disabled={write === "all"} checked={writes(d.id)} onChange={(e) => toggle(d.id, e.target.checked)} />
                <span aria-hidden>{d.icon}</span>
                {d.title || `#${d.id}`}
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
