"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { convertTaskListAction, taskItemAction, taskListAction } from "../actions";
import { WS_CHANGED } from "./ChatPanel";
import { Dropdown, MenuItem } from "./kit";

/**
 * To-do lists as blocks with a head: a title, how many are done, and a "…" menu - turn the list into a database (with its Todo view), let its
 * open items be todos of the Todo engine. Every list and every item has an id of its own (a plugin of the editor gives them), so a list can be
 * found from elsewhere: a data source, a block that embeds it (read and write), the Todo engine.
 */

const rid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

/** A transaction that gives every list and item without an id (or with one that is taken) a new one - null when none needs it. */
function idsTransaction(state: EditorState) {
  const seen = new Set<string>();
  let tr = state.tr;
  let changed = false;
  state.doc.descendants((node, pos) => {
    const key = node.type.name === "taskList" ? "listId" : node.type.name === "taskItem" ? "itemId" : "";
    if (!key) return;
    const have = String(node.attrs[key] ?? "");
    if (have && !seen.has(have)) return void seen.add(have);
    let id = rid(key === "listId" ? "t" : "i");
    while (seen.has(id)) id = rid(key === "listId" ? "t" : "i");
    seen.add(id);
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, [key]: id });
    changed = true;
  });
  return changed ? tr.setMeta("addToHistory", false) : null;
}

export const TaskIds = Extension.create({
  name: "taskIds",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("taskIds"),
        appendTransaction: (trs, _old, state) => (trs.some((t) => t.docChanged) ? idsTransaction(state) : null),
        // A page loaded with lists that have no ids yet: they get them at once.
        view: (view) => {
          queueMicrotask(() => {
            const tr = idsTransaction(view.state);
            if (tr) view.dispatch(tr);
          });
          return {};
        },
      }),
    ];
  },
});

export const TaskItemWithId = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      itemId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-item-id"), renderHTML: (a: Record<string, unknown>) => (a.itemId ? { "data-item-id": String(a.itemId) } : {}) },
    };
  },
});

function TaskListView({ node, editor, getPos, updateAttributes, extension }: NodeViewProps) {
  const t = useT();
  const opts = extension.options as { pageId: number; flush: () => Promise<void> | void };
  const pos = typeof getPos === "function" ? getPos() : undefined;
  const nested = pos !== undefined && editor.state.doc.resolve(pos).parent.type.name === "taskItem";
  const items = node.content.content.filter((n) => n.type.name === "taskItem");
  const done = items.filter((n) => n.attrs.checked).length;
  const listId = String(node.attrs.listId ?? "");
  const [busy, setBusy] = useState(false);

  if (nested)
    return (
      <NodeViewWrapper as="div" className="ws-tasklist-nested">
        <NodeViewContent as={"ul" as "div"} data-type="taskList" />
      </NodeViewWrapper>
    );

  const convert = async () => {
    if (!listId || !confirmAction(t("Turn this list into a database? Its items become rows with a Todo view, right here."))) return;
    setBusy(true);
    await opts.flush();
    const r = await convertTaskListAction(opts.pageId, listId);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(t("The list is a database now."), { tone: "ok" });
    window.dispatchEvent(new Event(WS_CHANGED));
  };

  return (
    <NodeViewWrapper className="ws-todo-block" data-todo-block>
      <div className="ws-todo-head" contentEditable={false}>
        <span aria-hidden>☑</span>
        <input
          className="ws-todo-title"
          value={String(node.attrs.title ?? "")}
          placeholder={t("To-do list")}
          aria-label={t("Title of the list")}
          disabled={!editor.isEditable}
          onChange={(e) => updateAttributes({ title: e.target.value })}
        />
        <span className="ws-todo-count" title={t("{done} of {n} done", { done, n: items.length })}>
          {done}/{items.length}
        </span>
        {node.attrs.engine === true && (
          <span className="ws-tag" title={t("Its open items are todos of the Todo engine")}>
            ✓ {t("Todos")}
          </span>
        )}
        {editor.isEditable && (
          <Dropdown label="…" align="right" title={t("List settings")} className="icon-btn">
            {(close) => (
              <>
                <MenuItem onClick={() => (close(), updateAttributes({ engine: node.attrs.engine === true ? false : true }))}>
                  {node.attrs.engine === true ? "☑" : "☐"} {t("Open items are todos (Todo engine)")}
                </MenuItem>
                <MenuItem onClick={() => (close(), void convert())}>▦ {busy ? "…" : t("Turn into a database")}</MenuItem>
              </>
            )}
          </Dropdown>
        )}
      </div>
      <NodeViewContent as={"ul" as "div"} data-type="taskList" />
    </NodeViewWrapper>
  );
}

export const TaskListBlock = TaskList.extend<{ pageId: number; flush: () => Promise<void> | void }>({
  addOptions() {
    return { ...this.parent?.(), pageId: 0, flush: () => undefined };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      listId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-list-id"), renderHTML: (a: Record<string, unknown>) => (a.listId ? { "data-list-id": String(a.listId) } : {}) },
      title: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-title") ?? "", renderHTML: (a: Record<string, unknown>) => (a.title ? { "data-title": String(a.title) } : {}) },
      engine: { default: false, parseHTML: (el: HTMLElement) => el.getAttribute("data-engine") === "true", renderHTML: (a: Record<string, unknown>) => (a.engine ? { "data-engine": "true" } : {}) },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskListView);
  },
});

// ---------------------------------------------------------------------------
// A list embedded elsewhere
// ---------------------------------------------------------------------------

type Loaded = { path: string; title: string; pageId: number; items: { itemId: string; text: string; checked: boolean; depth: number }[] };

function TodoListEmbedView({ node, editor }: NodeViewProps) {
  const t = useT();
  const pageId = Number(node.attrs.pageId);
  const listId = String(node.attrs.listId);
  const [list, setList] = useState<Loaded | null | "gone">(null);
  const [text, setText] = useState("");
  const editable = editor.isEditable;
  const load = useCallback(async () => {
    const r = await taskListAction(pageId, listId);
    setList(r.ok ? r.list : "gone");
  }, [pageId, listId]);
  useEffect(() => {
    void load();
    window.addEventListener(WS_CHANGED, load);
    const timer = setInterval(load, 20000);
    return () => (window.removeEventListener(WS_CHANGED, load), clearInterval(timer));
  }, [load]);

  const act = async (op: Parameters<typeof taskItemAction>[2]) => {
    const r = await taskItemAction(pageId, listId, op);
    if (!r.ok) toast(r.error, { tone: "error" });
    await load();
    window.dispatchEvent(new Event(WS_CHANGED));
  };

  return (
    <NodeViewWrapper className="ws-todo-block ws-todo-embed" contentEditable={false} data-todo-embed>
      {list === null ? (
        <p className="text-sm text-zinc-400">…</p>
      ) : list === "gone" ? (
        <p className="text-sm text-zinc-500">{t("This list is gone (or its page).")}</p>
      ) : (
        <>
          <div className="ws-todo-head">
            <span aria-hidden>☑</span>
            <Link href={`/workspace/${list.pageId}`} className="ws-todo-title-link" title={list.path}>
              {list.title || list.path.split(" / ").slice(-2).join(" / ")}
            </Link>
            <span className="ws-todo-count">
              {list.items.filter((i) => i.checked).length}/{list.items.length}
            </span>
          </div>
          <ul className="ws-todo-embed-items">
            {list.items.map((i) => (
              <li key={i.itemId} style={{ marginLeft: `${i.depth * 1.25}rem` }}>
                <input type="checkbox" className="size-4 accent-indigo-600" checked={i.checked} disabled={!editable} onChange={(e) => void act({ kind: "check", itemId: i.itemId, checked: e.target.checked })} aria-label={i.text} />
                <input
                  className={`ws-todo-embed-text ${i.checked ? "line-through opacity-60" : ""}`}
                  defaultValue={i.text}
                  disabled={!editable}
                  onBlur={(e) => e.target.value.trim() !== i.text && void act({ kind: "text", itemId: i.itemId, text: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  aria-label={t("Item")}
                />
                {editable && (
                  <button type="button" className="icon-btn" aria-label={t("Remove")} onClick={() => void act({ kind: "remove", itemId: i.itemId })}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {editable && (
            <input
              className="ws-todo-embed-add"
              value={text}
              placeholder={t("+ Add an item")}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !text.trim()) return;
                const v = text;
                setText("");
                void act({ kind: "add", text: v });
              }}
              aria-label={t("Add an item")}
            />
          )}
        </>
      )}
    </NodeViewWrapper>
  );
}

/** A to-do list of another page (or of this one) shown here - ticked, written and added to in place; the list stays in its own page. */
export const TodoListEmbedNode = Node.create({
  name: "todoListEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { pageId: { default: 0 }, listId: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-todo-list-embed]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-todo-list-embed": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TodoListEmbedView);
  },
});
