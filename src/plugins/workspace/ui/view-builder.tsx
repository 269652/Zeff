"use client";

import { useMemo, useState, type DragEvent } from "react";
import { useT } from "@/components/I18nProvider";
import type { TNode } from "../card-template";
import { VIEW_TAGS } from "../view-template";
import { branchesOf, childPath, slotOfPath, insertAt, KIT, kitNodes, moveTo, nodeAt, removeAt, templateToTree, treeToTemplate, updateAt, type Branch, type Path, type Slot } from "../view-tree";

/**
 * A view built by hand without its code: the kit of elements on the left (layout, data, inputs, text, flows, logic) dragged onto the
 * canvas — the view's structure, each element a block with what it holds — or dragged within it to move; one clicked is edited in
 * the inspector (its attributes with their choices, a condition, a value, a text). Every change is the template at once: the live view
 * below shows it, the Code tab has it.
 */

const ICON: Record<string, string> = Object.fromEntries(KIT.map((k) => [k.id, k.icon]));
const SUMMARY_ATTRS = ["title", "label", "source", "bind", "name", "flow", "run", "action", "options", "placeholder", "group", "value", "cols", "kind"];
const BRANCH_LABEL: Record<Branch, string> = { kids: "", then: "then", else: "else", body: "each" };

type Drag = { kind: "kit"; id: string } | { kind: "node"; path: Path };
const DRAG_TYPE = "application/x-zeff-view";

function summary(n: TNode): string {
  if (n.k === "text") return n.v.trim().slice(0, 60);
  if (n.k === "out") return `{{ ${n.expr}${n.filters.length ? ` | ${n.filters.map((f) => f.name).join(" | ")}` : ""} }}`;
  if (n.k === "if") return n.cond;
  if (n.k === "each") return n.expr;
  return n.attrs
    .filter(([k]) => SUMMARY_ATTRS.includes(k))
    .slice(0, 3)
    .map(([k, v]) => `${k}="${v.length > 28 ? `${v.slice(0, 27)}…` : v}"`)
    .join(" ");
}

export function ViewBuilder({ value, onChange }: { value: string; onChange: (src: string) => void }) {
  const t = useT();
  const parsed = useMemo(() => templateToTree(value), [value]);
  const nodes = parsed.nodes;
  const [sel, setSel] = useState<Path | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const set = (next: TNode[]) => onChange(treeToTemplate(next));
  const selected = sel ? nodeAt(nodes, sel) : null;

  const drop = (slot: Slot, index: number) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    let d: Drag;
    try {
      d = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as Drag;
    } catch {
      return;
    }
    if (d.kind === "kit") {
      const item = KIT.find((k) => k.id === d.id);
      if (!item) return;
      let next = nodes;
      kitNodes(item).forEach((n, i) => (next = insertAt(next, slot, index + i, n)));
      set(next);
      setSel(childPath(slot, index));
    } else {
      set(moveTo(nodes, d.path, slot, index));
      setSel(null);
    }
  };

  const zone = (slot: Slot, index: number, empty?: boolean) => {
    const id = `${JSON.stringify(slot)}:${index}`;
    return (
      <div
        key={`z${index}`}
        className={`rounded transition-all ${over === id ? "my-1 h-6 border-2 border-dashed border-indigo-400 bg-indigo-50 dark:bg-indigo-950/50" : empty ? "h-6 border border-dashed border-zinc-300 dark:border-zinc-700" : "h-1.5"}`}
        onDragOver={(e) => (e.preventDefault(), over !== id && setOver(id))}
        onDragLeave={() => over === id && setOver(null)}
        onDrop={drop(slot, index)}
      >
        {empty && over !== id && <span className="block px-2 text-[10px] leading-6 text-zinc-400">{t("drop here")}</span>}
      </div>
    );
  };

  const listOf = (list: TNode[], slot: Slot) => (
    <div className="flex flex-col">
      {zone(slot, 0, !list.length)}
      {list.map((n, i) => (
        <div key={i}>
          {block(n, childPath(slot, i))}
          {zone(slot, i + 1)}
        </div>
      ))}
    </div>
  );

  const block = (node: TNode, path: Path) => {
    const active = sel && sel.join() === path.join();
    const name = node.k === "tag" ? node.name : node.k === "out" ? "value" : node.k;
    const branches = branchesOf(node);
    const inline = node.k === "text" || node.k === "out";
    return (
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: "node", path } satisfies Drag));
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={(e) => (e.stopPropagation(), setSel(path))}
        className={`cursor-pointer rounded-lg border bg-white text-xs dark:bg-zinc-900 ${active ? "border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900" : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"} ${inline ? "border-dashed" : ""}`}
      >
        <div className="flex items-center gap-1.5 px-2 py-1">
          <span aria-hidden className="cursor-grab text-zinc-400">⠿</span>
          <span aria-hidden>{ICON[name] ?? (node.k === "text" ? "¶" : "▫")}</span>
          <span className="font-mono font-semibold text-indigo-700 dark:text-indigo-300">{node.k === "tag" ? `<${node.name}>` : node.k === "text" ? t("text") : name}</span>
          <span className="truncate font-mono text-zinc-500">{summary(node)}</span>
        </div>
        {branches.length > 0 && (
          <div className={`border-t border-zinc-100 px-2 pb-1.5 dark:border-zinc-800 ${node.k === "tag" && ["row", "toolbar", "split", "panes", "grid", "header"].includes(node.name) ? "" : ""}`}>
            {branches.map((b) => {
              const list = b === "kids" && node.k === "tag" ? node.kids : node.k === "if" ? (b === "then" ? node.then : node.else) : node.k === "each" ? node.body : [];
              return (
                <div key={b} className="mt-1">
                  {BRANCH_LABEL[b] && <div className="text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">{BRANCH_LABEL[b]}</div>}
                  <div className="border-l-2 border-zinc-100 pl-2 dark:border-zinc-800">
                    {listOf(list, { parent: path, branch: b })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (parsed.errors.length)
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        {t("The template has errors — fix them in the Code tab, then it can be built here.")}
        <ul className="mt-1 text-xs">
          {parsed.errors.slice(0, 5).map((e, i) => (
            <li key={i}>
              {t("Line {n}", { n: e.line })}: {e.message}
            </li>
          ))}
        </ul>
      </div>
    );

  const groups = [...new Set(KIT.map((k) => k.group))];
  const shownKit = KIT.filter((k) => !q || `${k.label} ${k.what} ${k.id}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="grid h-[30rem] gap-2 lg:grid-cols-[13rem_minmax(0,1fr)_17rem]">
      <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
        <input type="search" className="input py-1 text-xs" placeholder={t("Find an element")} value={q} onChange={(e) => setQ(e.target.value)} />
        {groups.map((g) => {
          const items = shownKit.filter((k) => k.group === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <div className="label">{t(g)}</div>
              <div className="grid grid-cols-2 gap-1">
                {items.map((k) => (
                  <div
                    key={k.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: "kit", id: k.id } satisfies Drag));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onDoubleClick={() => set(insertAt(nodes, { parent: null, branch: "kids" }, nodes.length, kitNodes(k)[0]))}
                    title={`${k.what} — ${t("drag it onto the canvas (double click: at the end)")}`}
                    className="flex cursor-grab items-center gap-1 rounded-md border border-zinc-200 px-1.5 py-1 text-[11px] hover:border-indigo-300 hover:bg-indigo-50 active:cursor-grabbing dark:border-zinc-700 dark:hover:bg-indigo-950"
                  >
                    <span aria-hidden>{k.icon}</span>
                    <span className="truncate">{t(k.label)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </aside>

      <div className="min-h-0 overflow-y-auto rounded-lg border border-dashed border-zinc-300 bg-[radial-gradient(circle,_rgb(0_0_0/0.05)_1px,_transparent_1px)] [background-size:14px_14px] p-2 dark:border-zinc-700" onClick={() => setSel(null)}>
        {listOf(nodes, { parent: null, branch: "kids" })}
      </div>

      <aside className="min-h-0 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
        {selected && sel ? <Inspector key={sel.join()} node={selected} onChange={(n) => set(updateAt(nodes, sel, () => n))} onRemove={() => (set(removeAt(nodes, sel).nodes), setSel(null))} onDuplicate={() => { const at = slotOfPath(nodes, sel); set(insertAt(nodes, at.slot, at.index + 1, structuredClone(selected))); }} /> : <p className="text-zinc-500">{t("Drag elements from the kit onto the canvas; click one to change it. The view below shows it live.")}</p>}
      </aside>
    </div>
  );
}

function Inspector({ node, onChange, onRemove, onDuplicate }: { node: TNode; onChange: (n: TNode) => void; onRemove: () => void; onDuplicate: () => void }) {
  const t = useT();
  const [more, setMore] = useState(false);
  const row = (label: string, input: React.ReactNode) => (
    <label className="block space-y-0.5">
      <span className="font-mono text-[11px] text-zinc-500">{label}</span>
      {input}
    </label>
  );
  const head = (
    <div className="mb-2 flex items-center gap-1">
      <span className="flex-1 font-mono text-sm font-semibold">{node.k === "tag" ? `<${node.name}>` : node.k}</span>
      <button type="button" className="icon-btn size-6" title={t("Duplicate")} aria-label={t("Duplicate")} onClick={onDuplicate}>
        ⧉
      </button>
      <button type="button" className="icon-btn icon-btn-danger size-6" title={t("Remove")} aria-label={t("Remove")} onClick={onRemove}>
        🗑
      </button>
    </div>
  );
  if (node.k === "text")
    return (
      <div>
        {head}
        {row(t("text"), <textarea className="input text-xs" rows={4} value={node.v} onChange={(e) => onChange({ ...node, v: e.target.value })} />)}
      </div>
    );
  if (node.k === "out") {
    const src = treeToTemplate([node]).replace(/^\{\{\s*|\s*\}\}$/g, "");
    return (
      <div>
        {head}
        {row(
          t("value"),
          <input
            className="input font-mono text-xs"
            defaultValue={src}
            onBlur={(e) => {
              const n = templateToTree(`{{ ${e.target.value} }}`).nodes[0];
              if (n) onChange(n);
            }}
          />,
        )}
        <p className="mt-1 text-[11px] text-zinc-500">{t("A value and its filters: title | upper, rows | count, [Due] | date.")}</p>
      </div>
    );
  }
  if (node.k === "if")
    return (
      <div>
        {head}
        {row(t("condition"), <input className="input font-mono text-xs" value={node.cond} onChange={(e) => onChange({ ...node, cond: e.target.value })} />)}
      </div>
    );
  if (node.k === "each")
    return (
      <div>
        {head}
        {row(t("items"), <input className="input font-mono text-xs" value={node.expr} onChange={(e) => onChange({ ...node, expr: e.target.value })} />)}
      </div>
    );
  const def = VIEW_TAGS[node.name];
  const known = def ? Object.entries(def.attrs) : [];
  const value = (k: string) => node.attrs.find(([a]) => a === k)?.[1];
  const setAttr = (k: string, v: string | undefined) => onChange({ ...node, attrs: v === undefined || v === "" ? node.attrs.filter(([a]) => a !== k) : node.attrs.some(([a]) => a === k) ? node.attrs.map(([a, x]) => [a, a === k ? v : x]) : [...node.attrs, [k, v]] });
  const shown = known.filter(([k]) => value(k) !== undefined || more);
  return (
    <div className="space-y-1.5">
      {head}
      {shown.map(([k, kind]) => {
        const choices = typeof kind === "object" && "oneOf" in kind ? kind.oneOf : null;
        return (
          <div key={k}>
            {row(
              k,
              choices ? (
                <select className="input py-1 text-xs" value={value(k) ?? ""} onChange={(e) => setAttr(k, e.target.value || undefined)}>
                  <option value="">—</option>
                  {choices.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              ) : (
                <input className="input py-1 font-mono text-xs" value={value(k) ?? ""} onChange={(e) => setAttr(k, e.target.value)} />
              ),
            )}
          </div>
        );
      })}
      {known.length > shown.length || more ? (
        <button type="button" className="text-[11px] text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setMore(!more)}>
          {more ? t("Only the ones set") : t("All attributes ({n})", { n: known.length })}
        </button>
      ) : null}
    </div>
  );
}
