"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { rowLifecycleAction, runFlowAction, takeTransitionAction } from "../actions";
import { parseWith } from "../flows/with";

/**
 * A view's flows (flows/): <data> loading a flow's output into data.<name> whenever what it is called with changes, and a row's
 * <transitions> — its lifecycle's buttons, the ones it can't take now greyed with why, and its way so far.
 */

export { parseWith };

export type SetData = (name: string, patch: Record<string, unknown>) => void;

/** Loads a flow's output into data.<name> (nothing drawn): again when its input changes, after a pause while it is typed. */
export function FlowData({ a, setData, row }: { a: Record<string, string>; setData: SetData; row?: number }) {
  const key = JSON.stringify([a.flow, a.with ?? "", a.when ?? "__"]);
  const seq = useRef(0);
  useEffect(() => {
    const name = a.name;
    if (a.when !== undefined && !a.when.trim()) {
      setData(name, { [name]: null, [`${name}_status`]: "", [`${name}_error`]: null });
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(
      async () => {
        setData(name, { [`${name}_status`]: "loading" });
        const r = await runFlowAction(a.flow, parseWith(a.with), row ? { row } : {});
        if (mine !== seq.current) return;
        if (!r.ok) return setData(name, { [`${name}_status`]: "error", [`${name}_error`]: r.error });
        const res = r;
        if (res.status === "failed") setData(name, { [`${name}_status`]: "error", [`${name}_error`]: res.error });
        else setData(name, { [name]: res.output, [`${name}_status`]: res.status === "waiting" ? "waiting" : "ok", [`${name}_error`]: null });
      },
      Math.max(0, Math.min(3000, Number(a.debounce) || 0)),
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key holds what it depends on
  }, [key]);
  return null;
}

type Lifecycle = { transitions: { id: string; name: string; toName: string; ok: boolean; why?: string; confirm?: string }[]; history: { id: number; transition: string | null; from: string | null; to: string; by: string | null; note: string | null; at: string }[] };

/** A row's transitions as buttons and its way so far. */
export function TransitionsBlock({ row, history, reload }: { row: number; history: boolean; reload: () => void }) {
  const t = useT();
  const [lc, setLc] = useState<Lifecycle | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void rowLifecycleAction(row).then((r) => live && r.ok && setLc({ transitions: r.transitions, history: r.history }));
    return () => {
      live = false;
    };
  }, [row, tick]);
  if (!lc || (!lc.transitions.length && !lc.history.length)) return null;
  const take = async (id: string, name: string, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    const r = await takeTransitionAction(row, id);
    if (!r.ok) return toast(r.error, { tone: "error" });
    toast(t("{name}: done.", { name }), { tone: "ok" });
    setTick((x) => x + 1);
    reload();
  };
  return (
    <div className="space-y-2">
      {lc.transitions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {lc.transitions.map((x) => (
            <button key={x.id} type="button" className="btn btn-sm" disabled={!x.ok} title={x.ok ? `→ ${x.toName}` : x.why} onClick={() => void take(x.id, x.name, x.confirm)}>
              {x.name}
            </button>
          ))}
        </div>
      )}
      {history && lc.history.length > 0 && (
        <ol className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          {lc.history.slice(0, 8).map((h) => (
            <li key={h.id}>
              {new Date(h.at).toLocaleString()} · {h.from ?? "—"} → {h.to}
              {h.transition ? ` (${h.transition})` : ""}
              {h.by ? ` · ${h.by}` : ""}
              {h.note ? ` · ${h.note}` : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A button's run=: the flow run, its output into data.<into>; what it says when it is through. */
export async function runFlowButton(a: Record<string, string>, v: { row: number | null; setData: SetData; setState: (k: string, v: string) => void; reload: () => void; t: ReturnType<typeof useT> }): Promise<void> {
  const r = await runFlowAction(a.run, parseWith(a.with), v.row ? { row: v.row } : {});
  if (!r.ok) return void toast(r.error, { tone: "error" });
  const res = r;
  if (res.status === "failed") return void toast(res.error ?? v.t("The flow failed."), { tone: "error" });
  if (a.into) v.setData(a.into, { [a.into]: res.output, [`${a.into}_status`]: res.status === "waiting" ? "waiting" : "ok" });
  if (res.status === "waiting") toast(res.waiting?.kind === "approve" ? v.t("It waits for your approval: {title}", { title: res.waiting.title ?? "" }) : v.t("It goes on later."), { ms: 6000 });
  else if (a.done) toast(a.done, { tone: "ok" });
  if (a.then) {
    const i = a.then.indexOf("=");
    if (i > 0) v.setState(a.then.slice(0, i).trim(), a.then.slice(i + 1).trim());
  }
  v.reload();
}

/** A button's transition=: the row moves on (a note asked for when note=true). */
export async function transitionButton(a: Record<string, string>, v: { row: number | null; reload: () => void; t: ReturnType<typeof useT> }): Promise<void> {
  if (!v.row) return;
  const note = a.note === "true" ? (window.prompt(v.t("A note (optional)")) ?? undefined) : undefined;
  const r = await takeTransitionAction(v.row, a.transition, note || undefined);
  if (!r.ok) return void toast(r.error, { tone: "error" });
  toast(a.done || v.t("{name}: done.", { name: a.transition }), { tone: "ok" });
  v.reload();
}
