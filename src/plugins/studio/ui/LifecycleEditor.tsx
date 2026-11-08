"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { lifecycleDatabasesAction, listFlowsAction, saveLifecycleAction } from "@/plugins/workspace/actions";
import type { Lifecycle, Transition } from "@/plugins/workspace/model";

/**
 * A database's lifecycle: its status (or select) field's values as states, drawn as a diagram with the transitions as arrows (forward
 * above, back below); the transitions edited in a list — from where, to where, the condition, the fields that must be filled, the flow
 * run after it, a question asked before; whether the field may change only so (strict); the flows run when a row enters or leaves a state.
 */

type Db = { id: number; title: string; icon: string; fields: { id: string; name: string; options: { id: string; name: string; color: string }[] }[]; props: { id: string; name: string; type: string }[]; lifecycle: Lifecycle | null };

function Diagram({ states, transitions }: { states: { id: string; name: string }[]; transitions: Transition[] }) {
  const W = 132;
  const GAP = 48;
  const H = 40;
  const width = Math.max(1, states.length) * (W + GAP);
  const x = (id: string) => states.findIndex((s) => s.id === id) * (W + GAP) + W / 2 + GAP / 2;
  const arcs = transitions.flatMap((tr) => (tr.from.length ? tr.from : states.map((s) => s.id).filter((s) => s !== tr.to)).map((f) => ({ tr, from: f })));
  const top = 90;
  return (
    <svg viewBox={`0 0 ${width} ${top * 2 + H}`} width={width} height={top * 2 + H} className="mx-auto max-w-none" role="img" aria-label="Lifecycle">
      <defs>
        <marker id="lc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-indigo-500" />
        </marker>
      </defs>
      {arcs.map(({ tr, from }, i) => {
        const a = x(from);
        const b = x(tr.to);
        if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) return null;
        const forward = b > a;
        const lift = Math.min(top - 8, 24 + Math.abs(b - a) / 6);
        const y = forward ? top : top + H;
        const cy = forward ? y - lift : y + lift;
        const d = `M ${a} ${y} Q ${(a + b) / 2} ${cy} ${b} ${y}`;
        return (
          <g key={`${tr.id}-${from}-${i}`}>
            <path d={d} fill="none" strokeWidth={1.5} className={tr.guard ? "stroke-amber-500" : "stroke-indigo-500"} strokeDasharray={tr.guard ? "4 3" : undefined} markerEnd="url(#lc-arrow)" />
            <text x={(a + b) / 2} y={forward ? cy + 10 : cy - 2} textAnchor="middle" className="fill-zinc-600 text-[11px] dark:fill-zinc-300">
              {tr.name}
            </text>
          </g>
        );
      })}
      {states.map((s, i) => (
        <g key={s.id} transform={`translate(${i * (W + GAP) + GAP / 2}, ${top})`}>
          <rect width={W} height={H} rx={10} className="fill-white stroke-zinc-300 dark:fill-zinc-900 dark:stroke-zinc-700" />
          <text x={W / 2} y={H / 2 + 4} textAnchor="middle" className="fill-zinc-800 text-[13px] font-medium dark:fill-zinc-100">
            {s.name.length > 16 ? `${s.name.slice(0, 15)}…` : s.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function LifecycleEditor() {
  const t = useT();
  const [dbs, setDbs] = useState<Db[]>([]);
  const [flows, setFlows] = useState<string[]>([]);
  const [dbId, setDbId] = useState<number | null>(null);
  const [lc, setLc] = useState<Lifecycle | null>(null);

  useEffect(() => {
    void lifecycleDatabasesAction().then((r) => r.ok && setDbs(r.databases as Db[]));
    void listFlowsAction().then((r) => r.ok && setFlows(r.flows.map((f) => f.name)));
  }, []);

  const db = dbs.find((d) => d.id === dbId) ?? null;
  const field = db?.fields.find((f) => f.id === lc?.field) ?? null;
  const states = field?.options ?? [];

  const save = async () => {
    if (!db) return;
    const r = await saveLifecycleAction(db.id, lc);
    if (!r.ok) return toast(r.error, { tone: "error" });
    setDbs((all) => all.map((d) => (d.id === db.id ? { ...d, lifecycle: r.lifecycle } : d)));
    toast(t("Saved."), { tone: "ok" });
  };

  const setTr = (i: number, patch: Partial<Transition>) => lc && setLc({ ...lc, transitions: lc.transitions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="label mb-0">{t("Database")}</span>
          <select className="input w-64" value={dbId ?? ""} onChange={(e) => { const id = Number(e.target.value) || null; setDbId(id); setLc(dbs.find((d) => d.id === id)?.lifecycle ?? null); }}>
            <option value="">—</option>
            {dbs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.icon} {d.title || `#${d.id}`}
                {d.lifecycle ? " ⟳" : ""}
              </option>
            ))}
          </select>
        </label>
        {db && (
          <label className="space-y-1">
            <span className="label mb-0">{t("Its states are the values of")}</span>
            <select className="input w-48" value={lc?.field ?? ""} onChange={(e) => setLc(e.target.value ? { field: e.target.value, transitions: lc?.field === e.target.value ? lc.transitions : [], strict: lc?.strict } : null)}>
              <option value="">{t("no lifecycle")}</option>
              {db.fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {lc && (
          <label className="inline-flex items-center gap-1.5 pb-2 text-sm">
            <input type="checkbox" className="accent-indigo-600" checked={!!lc.strict} onChange={(e) => setLc({ ...lc, strict: e.target.checked || undefined })} />
            {t("Strict: it changes only by a transition")}
          </label>
        )}
        {db && (
          <button type="button" className="btn btn-sm btn-primary ml-auto" onClick={() => void save()}>
            {t("Save")}
          </button>
        )}
      </div>

      {lc && field && (
        <>
          <div className="card overflow-x-auto p-3">
            <Diagram states={states} transitions={lc.transitions} />
          </div>
          <section className="space-y-2">
            <h3 className="font-semibold">{t("Transitions")}</h3>
            {lc.transitions.map((tr, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-zinc-200 p-3 md:grid-cols-[1fr_1fr_1fr] dark:border-zinc-800">
                <label className="space-y-1">
                  <span className="label mb-0">{t("Name")}</span>
                  <input className="input" value={tr.name} onChange={(e) => setTr(i, { name: e.target.value })} />
                </label>
                <div className="space-y-1">
                  <span className="label mb-0">{t("From")}</span>
                  <div className="flex flex-wrap gap-1">
                    {states.map((s) => (
                      <label key={s.id} className={`cursor-pointer rounded-md border px-1.5 py-0.5 text-xs ${tr.from.includes(s.id) ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950" : "border-zinc-200 dark:border-zinc-700"}`}>
                        <input type="checkbox" className="sr-only" checked={tr.from.includes(s.id)} onChange={(e) => setTr(i, { from: e.target.checked ? [...tr.from, s.id] : tr.from.filter((x) => x !== s.id) })} />
                        {s.name}
                      </label>
                    ))}
                    {!tr.from.length && <span className="text-xs text-zinc-500">{t("(from any)")}</span>}
                  </div>
                </div>
                <label className="space-y-1">
                  <span className="label mb-0">{t("To")}</span>
                  <select className="input" value={tr.to} onChange={(e) => setTr(i, { to: e.target.value })}>
                    {states.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="label mb-0">{t("Only if")}</span>
                  <input className="input font-mono text-xs" placeholder="row.Amount < 1000" value={tr.guard ?? ""} onChange={(e) => setTr(i, { guard: e.target.value || undefined })} />
                </label>
                <div className="space-y-1">
                  <span className="label mb-0">{t("Must be filled")}</span>
                  <div className="flex flex-wrap gap-1">
                    {db!.props.filter((p) => p.id !== lc.field).map((p) => (
                      <label key={p.id} className={`cursor-pointer rounded-md border px-1.5 py-0.5 text-xs ${(tr.require ?? []).includes(p.id) ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950" : "border-zinc-200 dark:border-zinc-700"}`}>
                        <input type="checkbox" className="sr-only" checked={(tr.require ?? []).includes(p.id)} onChange={(e) => setTr(i, { require: e.target.checked ? [...(tr.require ?? []), p.id] : (tr.require ?? []).filter((x) => x !== p.id) })} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <label className="space-y-1">
                    <span className="label mb-0">{t("Then run")}</span>
                    <select className="input" value={tr.flow ?? ""} onChange={(e) => setTr(i, { flow: e.target.value || undefined })}>
                      <option value="">—</option>
                      {flows.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="icon-btn icon-btn-danger self-end" aria-label={t("Remove")} onClick={() => setLc({ ...lc, transitions: lc.transitions.filter((_, j) => j !== i) })}>
                    🗑
                  </button>
                </div>
                <label className="space-y-1 md:col-span-3">
                  <span className="label mb-0">{t("Ask before")}</span>
                  <input className="input" value={tr.confirm ?? ""} placeholder={t("(no question)")} onChange={(e) => setTr(i, { confirm: e.target.value || undefined })} />
                </label>
              </div>
            ))}
            <button type="button" className="btn btn-sm" disabled={!states.length} onClick={() => setLc({ ...lc, transitions: [...lc.transitions, { id: `t${lc.transitions.length + 1}`, name: t("Next"), from: [], to: states[0]?.id ?? "" }] })}>
              + {t("Transition")}
            </button>
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold">{t("When a row enters or leaves a state")}</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {states.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-sm">
                  <span className="w-28 truncate font-medium">{s.name}</span>
                  {(["enter", "leave"] as const).map((k) => (
                    <select key={k} className="input" aria-label={`${s.name}: ${k}`} value={lc[k]?.[s.id] ?? ""} onChange={(e) => setLc({ ...lc, [k]: { ...(lc[k] ?? {}), [s.id]: e.target.value || undefined } })}>
                      <option value="">{k === "enter" ? t("on entering: —") : t("on leaving: —")}</option>
                      {flows.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {!db && <p className="text-sm text-zinc-500">{t("Pick a database with a status or select field: its values become the states, and you say how a row moves between them.")}</p>}
    </div>
  );
}
