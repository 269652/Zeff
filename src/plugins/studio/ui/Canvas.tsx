"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { FlowNode, FlowNodeKind } from "@/plugins/workspace/flows/types";
import { BRANCH_LABEL, nodeBranches, nodeSummary, type Slot } from "../tree";

/**
 * A flow drawn as a canvas: its nodes top to bottom joined by a line, a branch's lists side by side (if: then | else, parallel: its
 * branches, switch: its cases), a loop's and a try's nodes in a frame. A node's last run shows on it (✓ ✗ … and how long). "+"
 * between two nodes adds one there.
 */

export const KIND_ICON: Record<FlowNodeKind, string> = { action: "⚡", set: "📝", if: "🔀", switch: "🔀", foreach: "🔁", parallel: "⫴", try: "🛟", script: "⌨", ask: "💬", approve: "✋", wait: "⏳", call: "↪", return: "⏎", fail: "⛔" };

export type NodeRun = { status: "ok" | "failed" | "skipped" | "waiting" | "dry"; ms: number };

type Props = {
  nodes: FlowNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: (slot: Slot, index: number) => void;
  runs: Record<string, NodeRun>;
};

const RUN_TONE: Record<NodeRun["status"], string> = { ok: "text-emerald-600", failed: "text-red-600", skipped: "text-zinc-500", waiting: "text-amber-600", dry: "text-sky-600" };
const RUN_SIGN: Record<NodeRun["status"], string> = { ok: "✓", failed: "✗", skipped: "–", waiting: "…", dry: "~" };

function Adder({ onAdd, label }: { onAdd: () => void; label: string }) {
  return (
    <div className="flex justify-center py-0.5">
      <button type="button" className="flex size-5 items-center justify-center rounded-full border border-dashed border-zinc-300 text-xs text-zinc-500 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 dark:border-zinc-700 dark:hover:bg-indigo-950" title={label} aria-label={label} onClick={onAdd}>
        +
      </button>
    </div>
  );
}

function Line() {
  return <div className="mx-auto h-3 w-px bg-zinc-300 dark:bg-zinc-700" aria-hidden />;
}

function List({ nodes, slot, ...p }: Props & { slot: Slot }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-col">
      <Adder onAdd={() => p.onAdd(slot, 0)} label={t("Add a node here")} />
      {nodes.map((n, i) => (
        <div key={n.id} className="flex flex-col">
          <Node node={n} {...p} nodes={nodes} />
          <Line />
          <Adder onAdd={() => p.onAdd(slot, i + 1)} label={t("Add a node here")} />
        </div>
      ))}
    </div>
  );
}

function Node({ node: n, ...p }: Props & { node: FlowNode }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const run = p.runs[n.id];
  const branches = nodeBranches(n);
  const active = p.selected === n.id;
  return (
    <div className={`min-w-0 rounded-xl border bg-white shadow-xs transition dark:bg-zinc-900 ${active ? "border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"}`}>
      <button type="button" className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left" onClick={() => p.onSelect(n.id)} aria-pressed={active}>
        <span aria-hidden className="text-base">
          {KIND_ICON[n.kind]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{n.label || n.id}</span>
          <span className="block truncate font-mono text-xs text-zinc-500">{nodeSummary(n)}</span>
        </span>
        {run && (
          <span className={`shrink-0 font-mono text-xs ${RUN_TONE[run.status]}`} title={t("Last run")}>
            {RUN_SIGN[run.status]} {run.ms ? `${run.ms} ms` : ""}
          </span>
        )}
        {branches.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            className="icon-btn size-6"
            aria-label={open ? t("Fold") : t("Unfold")}
            onClick={(e) => (e.stopPropagation(), setOpen((o) => !o))}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.stopPropagation(), e.preventDefault(), setOpen((o) => !o))}
          >
            {open ? "▾" : "▸"}
          </span>
        )}
      </button>
      {branches.length > 0 && open && (
        <div className={`border-t border-zinc-100 p-2 dark:border-zinc-800 ${branches.length > 1 ? "grid gap-2" : ""}`} style={branches.length > 1 ? { gridTemplateColumns: `repeat(${branches.length}, minmax(14rem, 1fr))` } : undefined}>
          {branches.map(([b, list]) => (
            <div key={b} className="min-w-0 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-950/50">
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{n.kind === "switch" && b.startsWith("case:") ? `= ${(n as Extract<FlowNode, { kind: "switch" }>).cases[Number(b.slice(5))]?.value || "…"}` : BRANCH_LABEL(b)}</div>
              <List {...p} nodes={list} slot={{ parent: n.id, branch: b }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Canvas(p: Props) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <div className="mx-auto max-w-3xl min-w-[20rem] rounded-xl border border-dashed border-zinc-200 bg-[radial-gradient(circle,_rgb(0_0_0/0.06)_1px,_transparent_1px)] [background-size:16px_16px] p-4 dark:border-zinc-800 dark:bg-[radial-gradient(circle,_rgb(255_255_255/0.06)_1px,_transparent_1px)]">
        <div className="mx-auto mb-1 w-fit rounded-full bg-indigo-50 px-3 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{t("Start")}</div>
        <Line />
        <List {...p} slot={{ parent: null, branch: "root" }} />
        <Line />
        <div className="mx-auto mt-1 w-fit rounded-full bg-zinc-100 px-3 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t("Output")}</div>
      </div>
    </div>
  );
}
