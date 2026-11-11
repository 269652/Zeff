"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { NEW_ELEMENTS, type DropAt, type OutlineNode, type VisualModel } from "@/lib/widgets/visual";
import { scanWidgetCode } from "@/lib/widgets/values";
import { toast } from "@/components/Toaster";
import { widgetValuesAction } from "../actions";
import { WS_CHANGED } from "./ChatPanel";
import { dropOn, getDragged, lastSaid, saidKey, select, setDragged, useEditSession } from "./widget-edit-store";

/**
 * The visual widget editor: the canvas (the widget's markup drawn without its scripts — click picks, double-click edits text in
 * place, drag moves) and the sidebar panel (palette, outline, properties of what is picked). Both work on one VisualModel
 * (lib/widgets/visual.ts) shared through widget-edit-store.ts.
 */

const NO_CHILDREN = new Set(["input", "img", "br", "hr", "textarea", "select", "canvas", "svg"]);

const canvasCss = (dark: boolean) => `
:host{display:block}
.zroot{min-height:80px;padding:12px;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:${dark ? "#18181b" : "#fff"};color:${dark ? "#ececf1" : "#18181b"};border-radius:8px}
[data-zid]{cursor:pointer}
input,select,textarea,button{pointer-events:none}
[data-group]{box-shadow:0 0 0 1px rgba(139,92,246,.55);border-radius:4px}
[data-zid]:hover{outline:1px dashed #a5b4fc}
[data-zid]:empty{min-height:1.8em;outline:1px dashed #a1a1aa;outline-offset:-1px}
[data-zsel]{outline:2px solid #6366f1 !important;outline-offset:1px}
.zdrop-before{box-shadow:0 -3px 0 0 #6366f1 !important}
.zdrop-after{box-shadow:0 3px 0 0 #6366f1 !important}
.zdrop-inside{outline:2px solid #22c55e !important;outline-offset:-2px}
[contenteditable]{outline:2px solid #f59e0b !important;cursor:text}
`;

/** Where on `el` a pointer at `y` would put what is dragged. */
function dropPos(el: HTMLElement, y: number): DropAt {
  const r = el.getBoundingClientRect();
  const ratio = r.height ? (y - r.top) / r.height : 0.5;
  const leafText = el.children.length === 0 && !!(el.textContent ?? "").trim();
  const holds = !NO_CHILDREN.has(el.tagName.toLowerCase()) && !leafText;
  if (holds) return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
  return ratio < 0.5 ? "before" : "after";
}

export function VisualCanvas({ model }: { model: VisualModel }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const shadow = useRef<ShadowRoot | null>(null);
  const { multi } = useEditSession();
  const version = model.version;
  const dark = typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  // Drawn again after every change of the markup (it is small) — not for a pick, and not while a text is written in place.
  useEffect(() => {
    const h = host.current;
    if (!h) return;
    const sr = shadow.current ?? (shadow.current = h.attachShadow({ mode: "open" }));
    if (sr.querySelector("[contenteditable]")) return;
    sr.innerHTML = `<style>${canvasCss(dark)}</style><div class="zroot">${model.canvasHtml()}</div>`;
    for (const el of sr.querySelectorAll<HTMLElement>("[data-zid]")) el.draggable = true;
  }, [model, version, dark]);
  // What is picked is marked (also after a redraw).
  useEffect(() => {
    const sr = shadow.current;
    if (!sr) return;
    sr.querySelectorAll("[data-zsel]").forEach((x) => x.removeAttribute("data-zsel"));
    for (const z of multi) sr.querySelector(`[data-zid="${z.replace(/[^a-z0-9]/gi, "")}"]`)?.setAttribute("data-zsel", "");
  }, [multi, version]);

  // The pointer, once (the handlers read the model, not the drawing).
  useEffect(() => {
    const h = host.current;
    if (!h) return;
    const sr = shadow.current ?? (shadow.current = h.attachShadow({ mode: "open" }));
    const zidOf = (e: Event): string | null => {
      const t0 = e.composedPath()[0];
      return t0 instanceof Element ? (t0.closest("[data-zid]") as HTMLElement | null)?.getAttribute("data-zid") ?? null : null;
    };
    const clear = () => sr.querySelectorAll(".zdrop-before,.zdrop-after,.zdrop-inside").forEach((x) => x.classList.remove("zdrop-before", "zdrop-after", "zdrop-inside"));
    let pending: { target: string; at: DropAt } | null = null;

    const onClick = (e: Event) => {
      if ((e.composedPath()[0] as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      const me = e as MouseEvent;
      select(zidOf(e), me.shiftKey || me.ctrlKey || me.metaKey);
    };
    const onDouble = (e: Event) => {
      const z = zidOf(e);
      if (!z || !model.hasText(z)) return;
      const el = sr.querySelector<HTMLElement>(`[data-zid="${z}"]`);
      if (!el) return;
      el.draggable = false;
      el.contentEditable = "plaintext-only";
      if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
      el.focus();
      const done = (keep: boolean) => {
        el.removeEventListener("keydown", key);
        el.contentEditable = "false";
        el.removeAttribute("contenteditable");
        el.draggable = true;
        // (The text selection goes — the page's editor would show its text toolbar over the widget for it.)
        window.getSelection()?.removeAllRanges();
        // (Its own text pieces — "Rate: " beside a <b> — are written back one for one; an edit that deleted an element inside is given up.)
        if (keep && el.children.length !== model.el(z)?.children.length) model.refresh();
        else if (keep) model.setOwnText(z, [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? ""));
        else model.refresh();
      };
      const key = (k: Event) => {
        const ke = k as KeyboardEvent;
        ke.stopPropagation();
        if (ke.key === "Enter" && !ke.shiftKey) {
          ke.preventDefault();
          el.blur();
        }
        if (ke.key === "Escape") {
          ke.preventDefault();
          done(false);
          el.blur();
        }
      };
      el.addEventListener("keydown", key);
      el.addEventListener("blur", () => done(true), { once: true });
    };
    const onDragStart = (e: Event) => {
      const z = zidOf(e);
      if (!z) return;
      // (A part of a group carries the whole group.)
      setDragged({ kind: "move", zid: model.groupRoot(z) });
      const de = e as DragEvent;
      de.dataTransfer?.setData("text/plain", "zeff-widget-element");
      if (de.dataTransfer) de.dataTransfer.effectAllowed = "move";
    };
    const onDragOver = (e: Event) => {
      const d = getDragged();
      if (!d) return;
      const z = zidOf(e) ?? "body";
      const el = z === "body" ? null : sr.querySelector<HTMLElement>(`[data-zid="${z}"]`);
      const at: DropAt = el ? dropPos(el, (e as DragEvent).clientY) : "inside";
      if (d.kind === "move" && !model.canMove(d.zid, z, at)) return clear();
      e.preventDefault();
      clear();
      pending = { target: z, at };
      (el ?? sr.querySelector(".zroot"))?.classList.add(`zdrop-${at}`);
    };
    const onDrop = (e: Event) => {
      e.preventDefault();
      clear();
      if (pending) dropOn(pending.target, pending.at);
      pending = null;
    };
    const onEnd = () => (clear(), (pending = null), setDragged(null));
    // The page's editor must not see the pointer here (it would take the drags for its own).
    const own = (e: Event) => e.stopPropagation();
    for (const n of ["mousedown", "dragenter", "dragstart", "dragover", "drop", "dragend"]) sr.addEventListener(n, own);
    sr.addEventListener("click", onClick);
    sr.addEventListener("dblclick", onDouble);
    sr.addEventListener("dragstart", onDragStart);
    sr.addEventListener("dragover", onDragOver);
    sr.addEventListener("drop", onDrop);
    sr.addEventListener("dragend", onEnd);
    h.addEventListener("dragleave", (e) => !h.contains(e.relatedTarget as Node | null) && clear());
    return () => {
      for (const n of ["mousedown", "dragenter", "dragstart", "dragover", "drop", "dragend"]) sr.removeEventListener(n, own);
      sr.removeEventListener("click", onClick);
      sr.removeEventListener("dblclick", onDouble);
      sr.removeEventListener("dragstart", onDragStart);
      sr.removeEventListener("dragover", onDragOver);
      sr.removeEventListener("drop", onDrop);
      sr.removeEventListener("dragend", onEnd);
    };
  }, [model]);

  return (
    <div className="space-y-1.5">
      <div ref={host} className="overflow-hidden rounded-lg border border-violet-300 dark:border-violet-800" />
      <p className="text-xs text-zinc-500">
        {t("Click to pick, double-click a text to write in it, drag to move. Parts the widget builds with its script show up when it runs.")}
      </p>
    </div>
  );
}

const STYLE_FIELDS: { prop: string; label: string; options?: string[]; color?: boolean }[] = [
  { prop: "color", label: "Text colour", color: true },
  { prop: "background", label: "Background", color: true },
  { prop: "font-size", label: "Font size" },
  { prop: "font-weight", label: "Weight", options: ["", "400", "500", "600", "700"] },
  { prop: "text-align", label: "Align text", options: ["", "left", "center", "right"] },
  { prop: "padding", label: "Padding" },
  { prop: "margin", label: "Margin" },
  { prop: "width", label: "Width" },
  { prop: "height", label: "Height" },
  { prop: "border", label: "Border" },
  { prop: "border-radius", label: "Corners" },
  { prop: "display", label: "Layout", options: ["", "block", "inline-block", "flex", "grid", "none"] },
  { prop: "flex-direction", label: "Direction", options: ["", "row", "column"] },
  { prop: "gap", label: "Gap" },
  { prop: "align-items", label: "Align items", options: ["", "flex-start", "center", "flex-end", "stretch"] },
  { prop: "justify-content", label: "Justify", options: ["", "flex-start", "center", "flex-end", "space-between"] },
];

/** A box that commits when you leave it (a half-typed "1" isn't a size): re-made when the value changes from outside. */
function Commit({ value, onCommit, className = "", placeholder }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string }) {
  return (
    <input
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      className={`input min-w-0 py-0.5 text-xs ${className}`}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
    />
  );
}

function OutlineRow({ n, depth, model, selected, drop, setDrop }: { n: OutlineNode; depth: number; model: VisualModel; selected: string[]; drop: { zid: string; at: DropAt } | null; setDrop: (d: { zid: string; at: DropAt } | null) => void }) {
  const mark = drop?.zid === n.zid ? drop.at : null;
  return (
    <li>
      <div
        draggable
        onDragStart={(e) => (setDragged({ kind: "move", zid: n.zid }), e.dataTransfer.setData("text/plain", "zeff-widget-element"), (e.dataTransfer.effectAllowed = "move"))}
        onDragEnd={() => (setDragged(null), setDrop(null))}
        onDragOver={(e) => {
          const d = getDragged();
          if (!d) return;
          const r = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientY - r.top) / (r.height || 1);
          const at: DropAt = ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "inside";
          if (d.kind === "move" && !model.canMove(d.zid, n.zid, at)) return setDrop(null);
          e.preventDefault();
          setDrop({ zid: n.zid, at });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (drop) dropOn(drop.zid, drop.at);
          setDrop(null);
        }}
        onClick={(e) => select(n.zid, e.shiftKey || e.ctrlKey || e.metaKey)}
        style={{ paddingLeft: 6 + depth * 12 }}
        className={`flex cursor-pointer items-center gap-1 rounded py-0.5 pr-1 text-xs ${selected.includes(n.zid) ? "bg-indigo-100 font-medium text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"} ${mark === "before" ? "shadow-[0_-2px_0_0_#6366f1]" : mark === "after" ? "shadow-[0_2px_0_0_#6366f1]" : mark === "inside" ? "ring-2 ring-emerald-500 ring-inset" : ""}`}
      >
        <span className="font-mono text-[10px] text-zinc-400" aria-hidden>
          ⠿
        </span>
        <span className="min-w-0 flex-1 truncate">{n.label}</span>
      </div>
      {n.children.length > 0 && (
        <ul>
          {n.children.map((c) => (
            <OutlineRow key={c.zid} n={c} depth={depth + 1} model={model} selected={selected} drop={drop} setDrop={setDrop} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The sidebar while a widget is edited: what can be added, the outline, the properties of what is picked, save and cancel. */
export function WidgetEditPanel() {
  const t = useT();
  const { session, selected, multi } = useEditSession();
  const [drop, setDrop] = useState<{ zid: string; at: DropAt } | null>(null);
  if (!session) return null;
  const model = session.model;
  const el = model.el(selected);
  const isText = !!el && model.isLeaf(selected!) && !NO_CHILDREN.has(el.tagName.toLowerCase());
  // (A click adds into a box that is picked, after anything else, at the end when nothing is picked.)
  const holds = !!el && !isText && !NO_CHILDREN.has(el.tagName.toLowerCase());
  const tools = el
    ? [
        { icon: "↑", title: t("Up"), run: () => model.nudge(selected!, -1) },
        { icon: "↓", title: t("Down"), run: () => model.nudge(selected!, 1) },
        { icon: "⧉", title: t("Duplicate"), run: () => select(model.duplicate(selected!)) },
        multi.length > 1 || !model.isGroup(selected!)
          ? { icon: "⛓", title: multi.length > 1 ? t("Group the picked elements — they move as one") : t("Make a group of it — what is in it moves as one"), run: () => select(model.group(multi.length ? multi : [selected!])) }
          : { icon: "✂", title: t("Dissolve the group"), run: () => select(model.ungroup(selected!)) },
        { icon: "▣", title: t("Wrap in a box"), run: () => select(model.wrap(selected!)) },
        { icon: "🗑", title: t("Delete"), run: () => (model.remove(selected!), select(null)) },
      ]
    : [];

  return (
    <div className="space-y-3 text-sm" aria-label={t("Edit the widget")}>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-semibold">✎ {session.title || t("Widget")}</span>
        <button type="button" className="icon-btn" title={t("Undo (Ctrl+Z)")} aria-label={t("Undo")} disabled={!model.canUndo} onClick={() => model.undo()}>
          ↶
        </button>
        <button type="button" className="icon-btn" title={t("Redo (Ctrl+Shift+Z)")} aria-label={t("Redo")} disabled={!model.canRedo} onClick={() => model.redo()}>
          ↷
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={session.onSave}>
          {t("Save")}
        </button>
        <button type="button" className="btn btn-sm" onClick={session.onCancel}>
          {t("Cancel")}
        </button>
      </div>

      <section>
        <div className="label mb-1">{t("Add")}</div>
        <div className="flex flex-wrap gap-1">
          {NEW_ELEMENTS.map((n) => (
            <button
              key={n.kind}
              type="button"
              draggable
              title={t("Click to add — or drag it into the widget")}
              className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              onDragStart={(e) => (setDragged({ kind: "new", element: n.kind }), e.dataTransfer.setData("text/plain", "zeff-widget-new"), (e.dataTransfer.effectAllowed = "copy"))}
              onDragEnd={() => setDragged(null)}
              onClick={() => select(model.insert(n.kind, selected, selected ? (holds ? "inside" : "after") : "inside"))}
            >
              + {t(n.label)}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="label mb-1">{t("Outline")}</div>
        <ul
          className="max-h-60 overflow-y-auto rounded-lg border border-zinc-200 p-1 dark:border-zinc-800"
          onDragOver={(e) => getDragged() && e.target === e.currentTarget && e.preventDefault()}
          onDrop={(e) => e.target === e.currentTarget && (e.preventDefault(), dropOn("body", "inside"))}
        >
          {model.outline().map((n) => (
            <OutlineRow key={n.zid} n={n} depth={0} model={model} selected={multi} drop={drop} setDrop={setDrop} />
          ))}
          {!model.outline().length && <li className="px-2 py-1 text-xs text-zinc-500">{t("Nothing yet — add an element.")}</li>}
        </ul>
      </section>

      <section>
        <div className="label mb-1 flex items-center gap-1">
          <span className="flex-1">{t("Properties")}</span>
          {tools.map((x) => (
            <button key={x.icon} type="button" title={x.title} aria-label={x.title} className="rounded px-1.5 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={x.run}>
              {x.icon}
            </button>
          ))}
        </div>
        {!el ? (
          <p className="text-xs text-zinc-500">{t("Pick an element in the widget or the outline.")}</p>
        ) : (
          <div className="space-y-3">
            <div className="font-mono text-xs text-indigo-700 dark:text-indigo-300">&lt;{el.tagName.toLowerCase()}&gt;</div>
            {isText && (
              <label className="block space-y-0.5">
                <span className="text-xs text-zinc-500">{t("Text")}</span>
                <textarea
                  rows={2}
                  className="input w-full py-1 text-xs"
                  value={el.textContent ?? ""}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => model.setText(selected!, e.target.value)}
                />
              </label>
            )}
            <div className="space-y-1">
              <div className="text-xs text-zinc-500">{t("Attributes")}</div>
              {model.attrs(selected!).map((a) => (
                <div key={a.name} className="flex items-center gap-1">
                  <span className="w-16 shrink-0 truncate font-mono text-[11px] text-zinc-500" title={a.name}>
                    {a.name}
                  </span>
                  <Commit value={a.value} className="flex-1" onCommit={(v) => model.setAttr(selected!, a.name, v)} />
                  <button type="button" className="icon-btn" aria-label={t("Remove")} onClick={() => model.setAttr(selected!, a.name, null)}>
                    ✕
                  </button>
                </div>
              ))}
              <NewAttribute onAdd={(n, v) => model.setAttr(selected!, n, v)} />
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
              {STYLE_FIELDS.map((f) => {
                const v = model.style(selected!, f.prop);
                return (
                  <label key={f.prop} className="min-w-0 space-y-0.5">
                    <span className="block truncate text-[11px] text-zinc-500">{t(f.label)}</span>
                    {f.options ? (
                      <select className="input w-full py-0.5 text-xs" value={v} onChange={(e) => model.setStyle(selected!, f.prop, e.target.value)}>
                        {f.options.map((o) => (
                          <option key={o} value={o}>
                            {o || "—"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="flex items-center gap-1">
                        {f.color && (
                          <input type="color" aria-label={t(f.label)} className="size-6 shrink-0 cursor-pointer rounded border border-zinc-300 p-0 dark:border-zinc-700" value={/^#[0-9a-f]{6}$/i.test(v) ? v : "#000000"} onChange={(e) => model.setStyle(selected!, f.prop, e.target.value)} />
                        )}
                        <Commit value={v} className="flex-1" onCommit={(x) => model.setStyle(selected!, f.prop, x)} />
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <ValuesSection model={model} pageId={session.pageId} />
    </div>
  );
}

function ValueRow({ name, value, unit, note, code, copy }: { name: string; value?: string | null; unit?: string; note?: string; code: string; copy: (code: string) => void }) {
  const t = useT();
  return (
    <li>
      <button type="button" title={t("Click to copy: {code}", { code })} className="flex w-full min-w-0 items-baseline gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => copy(code)}>
        <span className="min-w-0 truncate font-mono text-indigo-700 dark:text-indigo-300">{name}</span>
        {note && <span className="shrink-0 rounded bg-zinc-100 px-1 text-[10px] text-zinc-500 dark:bg-zinc-800">{note}</span>}
        <span className="min-w-0 flex-1 truncate text-right text-zinc-500">{value === undefined ? "" : value === null ? t("nothing yet") : `${value}${unit ? ` ${unit}` : ""}`}</span>
      </button>
    </li>
  );
}

type Slim = { key: string; label: string; kind: string; unit: string; widget: string; pageId: number | null; preview: string };
type Around = { outputs: Slim[]; byName: Record<string, Slim | null>; page: Record<string, string> };

/**
 * The values around the widget: what it publishes, reads, shares and sends (found in its code, as it is now), each with the value
 * it has right now, and what the other widgets publish — a click copies the code that reads it.
 */
function ValuesSection({ model, pageId }: { model: VisualModel; pageId: number | null }) {
  const t = useT();
  const [around, setAround] = useState<Around | null>(null);
  const version = model.version;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the model changes in place: its version says when
  const scan = useMemo(() => scanWidgetCode(model.html()), [model, version]);
  const asked = useMemo(() => [...scan.publishes, ...scan.reads], [scan]);
  const askedKey = asked.join("\u0001");
  useEffect(() => {
    let live = true;
    const load = () =>
      void widgetValuesAction(pageId, asked).then((r) => {
        if (live && r.ok) setAround({ outputs: r.outputs, byName: r.byName, page: r.page });
      });
    load();
    const every = window.setInterval(load, 3000);
    window.addEventListener(WS_CHANGED, load);
    return () => {
      live = false;
      window.clearInterval(every);
      window.removeEventListener(WS_CHANGED, load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asked is kept by its text
  }, [pageId, askedKey]);

  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code).then(() => toast(t("Copied: {code}", { code })), () => undefined);
  };
  const mine = new Set(scan.publishes.map((n) => n.toLowerCase()));
  const others = (around?.outputs ?? []).filter((o) => !mine.has(o.label.toLowerCase()) && !mine.has(o.key.toLowerCase()));
  const none = <li className="px-1 text-xs text-zinc-400">—</li>;
  const group = (title: string, rows: React.ReactNode[], empty = true) =>
    rows.length || empty ? (
      <div className="space-y-0.5">
        <div className="text-[11px] font-medium text-zinc-500">{title}</div>
        <ul>{rows.length ? rows : none}</ul>
      </div>
    ) : null;

  return (
    <section>
      <div className="label mb-1">{t("Values")}</div>
      <div className="space-y-2">
        {group(
          t("Published by this widget (all of Zeff)"),
          scan.publishes.map((n) => {
            const o = around?.byName[n];
            return <ValueRow copy={copy} key={n} name={n} value={around ? (o ? o.preview : null) : undefined} unit={o?.unit} code={`outputs.${n.replace(/\s+/g, "_")}`} />;
          }),
        )}
        {group(
          t("Read from other widgets"),
          scan.reads.map((n) => {
            const o = around?.byName[n];
            return <ValueRow copy={copy} key={n} name={n} value={around ? (o ? o.preview : null) : undefined} unit={o?.unit} code={`await zeff.values.get("${n}")`} />;
          }),
        )}
        {group(t("Shared on this page"), [
          ...scan.pageSets.map((n) => <ValueRow copy={copy} key={`s${n}`} name={n} note={t("sets")} value={around ? (around.page[n] ?? null) : undefined} code={`await zeff.page.get("${n}")`} />),
          ...scan.pageGets.filter((n) => !scan.pageSets.includes(n)).map((n) => <ValueRow copy={copy} key={`g${n}`} name={n} note={t("reads")} value={around ? (around.page[n] ?? null) : undefined} code={`await zeff.page.get("${n}")`} />),
        ])}
        {group(t("Messages"), [
          ...scan.emits.map((n) => <ValueRow copy={copy} key={`e${n}`} name={n} note={t("sends")} value={lastSaid.has(saidKey(pageId ?? 0, n)) ? JSON.stringify(lastSaid.get(saidKey(pageId ?? 0, n))).slice(0, 60) : null} code={`zeff.on("${n}", (d) => …)`} />),
          ...scan.listens.filter((n) => !scan.emits.includes(n)).map((n) => <ValueRow copy={copy} key={`l${n}`} name={n} note={t("hears")} value={lastSaid.has(saidKey(pageId ?? 0, n)) ? JSON.stringify(lastSaid.get(saidKey(pageId ?? 0, n))).slice(0, 60) : null} code={`zeff.emit("${n}", …)`} />),
        ])}
        {group(
          t("Published by other widgets"),
          others.slice(0, 40).map((o) => <ValueRow copy={copy} key={o.key} name={o.label || o.key} note={o.pageId === pageId ? t("this page") : o.widget || undefined} value={o.preview} unit={o.unit} code={`await zeff.values.get("${o.label || o.key}")`} />),
          false,
        )}
        <p className="text-xs text-zinc-400">{t("Found by reading the widget's code — a name put together by the program isn't seen. Click a value to copy the code that reads it.")}</p>
      </div>
    </section>
  );
}

function NewAttribute({ onAdd }: { onAdd: (name: string, value: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  return (
    <div className="flex items-center gap-1">
      <input className="input w-16 shrink-0 py-0.5 font-mono text-[11px]" placeholder={t("name")} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <input className="input min-w-0 flex-1 py-0.5 text-xs" placeholder={t("value")} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <button
        type="button"
        className="btn btn-sm px-2"
        disabled={!name.trim()}
        onClick={() => {
          onAdd(name.trim(), value);
          setName("");
          setValue("");
        }}
      >
        +
      </button>
    </div>
  );
}
