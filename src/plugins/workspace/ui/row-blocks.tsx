"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { activityAction, belongsAction, restoreChangeAction } from "../actions";
import type { ActivityLine } from "../activity";
import type { Belongs } from "../belongs";
import { GripBar } from "./app-nodes";
import { WS_CHANGED } from "./ChatPanel";

/**
 * The blocks of a detail view that are about the entry itself: its activity (who changed what, you, the AI, a source), everything that
 * belongs to it (linked pages, related rows, todos, tickets, pages about the same), and tabs to put the rest in.
 */

const ctxPageId = (e: NodeViewProps["extension"]) => Number((e.options as { pageId: number }).pageId);

function useLoaded<T>(load: () => Promise<T | null>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const run = useCallback(() => void load().then((r) => r && setData(r)), [load]);
  useEffect(() => {
    run();
    window.addEventListener(WS_CHANGED, run);
    // A change made elsewhere on the page (a field set, a button) shows within a moment.
    const timer = setInterval(run, 30000);
    return () => {
      window.removeEventListener(WS_CHANGED, run);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when what it looks at changes
  }, [run, ...deps]);
  return { data, reload: run };
}

const ACTOR: Record<string, { label: string; icon: string }> = { you: { label: "You", icon: "👤" }, ai: { label: "AI", icon: "✨" }, source: { label: "A source", icon: "🔄" } };

function ago(at: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(at)) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d`;
  return new Date(at).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function ActivityView(p: NodeViewProps) {
  const t = useT();
  const pageId = ctxPageId(p.extension);
  const limit = Number(p.node.attrs.limit) || 12;
  const [all, setAll] = useState(false);
  const [problem, setProblem] = useState("");
  const { data, reload } = useLoaded(
    useCallback(async () => {
      const r = await activityAction(pageId, all ? 100 : limit);
      return r.ok ? (r.lines as ActivityLine[]) : null;
    }, [pageId, limit, all]),
    [pageId, limit, all],
  );
  const FIELD: Record<string, string> = { created: t("created"), trash: t("moved to the trash"), restored: t("brought back"), text: t("the text was edited"), title: t("title") };
  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-2" contentEditable={false} data-app-block="activity">
      <GripBar editor={p.editor} node={p.node} getPos={p.getPos} deleteNode={p.deleteNode} label="activity" />
      <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t("Activity")}</h4>
        {!data ? (
          <p className="text-sm text-zinc-400">…</p>
        ) : !data.length ? (
          <p className="text-sm text-zinc-400">{t("Nothing yet — changes to this entry show up here.")}</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {data.map((l) => {
              const a = ACTOR[l.actor] ?? ACTOR.you;
              return (
                <li key={l.id} className="grid grid-cols-[1.4rem_1fr_auto] items-baseline gap-1.5">
                  <span title={t(a.label)} aria-label={t(a.label)}>
                    {a.icon}
                  </span>
                  <span className="min-w-0 break-words">
                    <span className="font-medium">{FIELD[l.field] ?? l.field}</span>
                    {!(l.field in FIELD) || l.field === "title" ? (
                      <>
                        {" "}
                        <span className="text-zinc-400 line-through">{l.from || "∅"}</span> → <span>{l.to || "∅"}</span>
                      </>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1.5 text-xs text-zinc-400" title={new Date(l.at).toLocaleString()}>
                    {(!(l.field in FIELD) || l.field === "title") && (
                      <button
                        type="button"
                        className="rounded px-1 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                        title={t("Put the old value back")}
                        onClick={async () => {
                          setProblem("");
                          const r = await restoreChangeAction(l.id);
                          if (!r.ok) return setProblem(r.error);
                          window.dispatchEvent(new Event(WS_CHANGED));
                          reload();
                        }}
                      >
                        ↩
                      </button>
                    )}
                    {ago(l.at) === "just now" ? t("just now") : ago(l.at)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {problem && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {problem}
          </p>
        )}
        {data && data.length >= limit && !all && (
          <button type="button" className="mt-2 text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setAll(true)}>
            {t("Show more")}
          </button>
        )}
      </section>
    </NodeViewWrapper>
  );
}

export const ZeffActivity = Node.create<{ pageId: number }>({
  name: "zeffActivity",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { limit: { default: 12 } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-activity]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-activity": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ActivityView as never);
  },
});

// ---------------------------------------------------------------------------
// Everything that belongs
// ---------------------------------------------------------------------------

function BelongsView(p: NodeViewProps) {
  const t = useT();
  const pageId = ctxPageId(p.extension);
  const { data } = useLoaded(
    useCallback(async () => {
      const r = await belongsAction(pageId);
      return r.ok ? (r.belongs as Belongs) : null;
    }, [pageId]),
    [pageId],
  );
  const TITLES: Record<string, string> = { related: t("Related"), linking: t("Linked from"), linked: t("Linked here"), similar: t("About the same") };
  const empty = !!data && !data.groups.length && !data.todos.length && !data.tickets.length;
  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-2" contentEditable={false} data-app-block="belongs">
      <GripBar editor={p.editor} node={p.node} getPos={p.getPos} deleteNode={p.deleteNode} label="everything that belongs" />
      <section className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t("Everything that belongs")}</h4>
        {!data ? (
          <p className="text-sm text-zinc-400">…</p>
        ) : empty ? (
          <p className="text-sm text-zinc-400">{t("Nothing found that belongs to this entry yet.")}</p>
        ) : (
          <>
            {data.todos.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-zinc-500">{t("Todos")}</p>
                <ul className="space-y-0.5 text-sm">
                  {data.todos.map((x) => (
                    <li key={x.id} className="flex items-baseline gap-2">
                      <span aria-hidden>{x.done ? "☑" : "☐"}</span>
                      <Link href={`/todos#todo-${x.id}`} className={`min-w-0 flex-1 truncate hover:underline ${x.done ? "text-zinc-400 line-through" : ""}`}>
                        {x.text}
                      </Link>
                      {x.ticket && <span className="rounded bg-zinc-100 px-1.5 text-xs text-zinc-500 dark:bg-zinc-800">{x.ticket}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.tickets.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-zinc-500">{t("Tickets")}</p>
                <ul className="space-y-0.5 text-sm">
                  {data.tickets.map((x) => (
                    <li key={x.key} className="flex items-baseline gap-2">
                      <span className="font-mono text-xs">{x.href ? <a href={x.href} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">{x.key}</a> : x.key}</span>
                      <span className="min-w-0 flex-1 truncate">{x.summary}</span>
                      {x.status && <span className="rounded bg-zinc-100 px-1.5 text-xs text-zinc-500 dark:bg-zinc-800">{x.status}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.groups.map((g) => (
              <div key={g.key}>
                <p className="mb-1 text-xs font-medium text-zinc-500">{TITLES[g.key] ?? g.title}</p>
                <ul className="space-y-0.5 text-sm">
                  {g.items.map((x) => (
                    <li key={x.id} className="flex items-baseline gap-2">
                      <span aria-hidden>{x.icon || "📄"}</span>
                      <Link href={x.href} className="min-w-0 flex-1 truncate hover:underline">
                        {x.title || t("Untitled")}
                      </Link>
                      {x.hint && <span className="max-w-48 shrink-0 truncate text-xs text-zinc-400">{x.hint}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>
    </NodeViewWrapper>
  );
}

export const ZeffBelongs = Node.create<{ pageId: number }>({
  name: "zeffBelongs",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-belongs]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-belongs": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BelongsView as never);
  },
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function TabsView({ node, editor, getPos, updateAttributes, deleteNode }: NodeViewProps) {
  const t = useT();
  const active = Math.min(Math.max(0, Number(node.attrs.active) || 0), Math.max(0, node.childCount - 1));
  const titles = Array.from({ length: node.childCount }, (_, i) => String(node.child(i).attrs.title ?? ""));
  const editable = editor.isEditable;
  const [editing, setEditing] = useState<number | null>(null);

  /** The position of the i-th tab inside this block. */
  const tabPos = (i: number) => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return null;
    let pos = base + 1;
    for (let k = 0; k < i; k++) pos += node.child(k).nodeSize;
    return pos;
  };
  const rename = (i: number, title: string) => {
    const pos = tabPos(i);
    if (pos === null) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.child(i).attrs, title: title.trim().slice(0, 60) || t("Tab") }));
  };
  const add = () => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return;
    editor.chain().insertContentAt(base + node.nodeSize - 1, { type: "zeffTab", attrs: { title: t("Tab {n}", { n: node.childCount + 1 }) }, content: [{ type: "paragraph" }] }).run();
    updateAttributes({ active: node.childCount });
  };
  const remove = (i: number) => {
    if (node.childCount < 2) return deleteNode();
    const pos = tabPos(i);
    if (pos === null) return;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + node.child(i).nodeSize));
    updateAttributes({ active: Math.max(0, Math.min(active, node.childCount - 2)) });
  };
  return (
    <NodeViewWrapper className="ws-tabs my-3" data-active={active}>
      <div className="ws-tabs-bar flex flex-wrap items-center gap-0.5 border-b border-zinc-200 dark:border-zinc-800" contentEditable={false} role="tablist">
        {titles.map((title, i) =>
          editing === i && editable ? (
            <input
              key={i}
              autoFocus
              className="input w-32 py-0.5 text-sm"
              defaultValue={title}
              aria-label={t("Tab name")}
              onBlur={(e) => (rename(i, e.target.value), setEditing(null))}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(null);
              }}
            />
          ) : (
            <span key={i} className="group/tab relative">
              <button type="button" role="tab" aria-selected={i === active} className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${i === active ? "border-indigo-500 font-medium text-indigo-700 dark:text-indigo-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`} onClick={() => updateAttributes({ active: i })} onDoubleClick={() => editable && setEditing(i)} title={editable ? t("Double-click to rename") : undefined}>
                {title}
              </button>
              {editable && i === active && (
                <button type="button" className="absolute -top-1.5 -right-1 hidden rounded-full bg-zinc-200 px-1 text-[10px] leading-4 text-zinc-600 group-hover/tab:block dark:bg-zinc-700 dark:text-zinc-200" onClick={() => remove(i)} aria-label={t("Remove the tab")} title={t("Remove the tab")}>
                  ✕
                </button>
              )}
            </span>
          ),
        )}
        {editable && (
          <button type="button" className="icon-btn ml-1" onClick={add} aria-label={t("Add a tab")} title={t("Add a tab")}>
            +
          </button>
        )}
      </div>
      <NodeViewContent className="ws-tab-content pt-3" />
    </NodeViewWrapper>
  );
}

export const ZeffTabs = Node.create({
  name: "zeffTabs",
  group: "block",
  content: "zeffTab+",
  defining: true,
  isolating: true,
  addAttributes() {
    return { active: { default: 0 } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-tabs]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-tabs": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TabsView as never);
  },
});

export const ZeffTab = Node.create({
  name: "zeffTab",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return { title: { default: "Tab" } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-tab]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-tab": "" }), 0];
  },
});

export const ROW_BLOCKS = [ZeffTabs, ZeffTab];
