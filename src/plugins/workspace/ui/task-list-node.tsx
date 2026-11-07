"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { convertTaskListAction, taskItemAction, taskListAction, taskListMetaAction } from "../actions";
import { WS_CHANGED } from "./ChatPanel";
import { MenuItem } from "./kit";
import { GripBar } from "./app-nodes";
import { TodoAddLine, TodoCheck, TodoDue, TodoHeader, TodoList, useCollapsibleHead } from "./todo-ui";

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

function TaskItemView({ node, editor, updateAttributes }: NodeViewProps) {
  const t = useT();
  const checked = node.attrs.checked === true;
  return (
    <NodeViewWrapper as={"li" as "div"} className="ws-todo-row" data-type="taskItem" data-checked={checked}>
      <TodoCheck checked={checked} disabled={!editor.isEditable} onChange={(v) => updateAttributes({ checked: v })} label={t("Todo")} />
      <NodeViewContent className="ws-todo-text" />
      <TodoDue value={(node.attrs.due as string | null) ?? null} done={checked} disabled={!editor.isEditable} onChange={(v) => updateAttributes({ due: v })} label={t("Due")} />
    </NodeViewWrapper>
  );
}

export const TaskItemWithId = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      itemId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-item-id"), renderHTML: (a: Record<string, unknown>) => (a.itemId ? { "data-item-id": String(a.itemId) } : {}) },
      due: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-due"), renderHTML: (a: Record<string, unknown>) => (a.due ? { "data-due": String(a.due) } : {}) },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView);
  },
});

function TaskListView({ node, editor, getPos, updateAttributes, extension }: NodeViewProps) {
  const t = useT();
  const opts = extension.options as { pageId: number; flush: () => Promise<void> | void };
  const pos = typeof getPos === "function" ? getPos() : undefined;
  const nested = pos !== undefined && editor.state.doc.resolve(pos).parent.type.name === "taskItem";
  const items = node.content.content.filter((n) => n.type.name === "taskItem");
  const done = items.filter((n) => n.attrs.checked).length;
  // Feeding the engine on a page that shows its todos in a widget: folded into a line — the todos are in the widget (Zeff's
  // todos count; the same once, not twice). Unfolded on demand.
  const [unfold, setUnfold] = useState(false);
  let widget = false;
  if (node.attrs.engine === true) editor.state.doc.descendants((n) => (widget ||= n.type.name === "zeffWidget" && n.attrs.widget === "people.todos", !widget));
  const fold = widget && !unfold;
  const listId = String(node.attrs.listId ?? "");
  const [busy, setBusy] = useState(false);
  const head = useCollapsibleHead();

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
    <NodeViewWrapper className={`ws-todo-block ${head.visible ? "" : "is-headless"} ${fold ? "ws-list-merged" : ""}`} data-todo-block {...head.frame}>
      {fold && (
        <button type="button" contentEditable={false} className="ws-list-merged-note" onClick={() => setUnfold(true)} title={t("Show the checklist here too")}>
          ☐ {t("{n} todos of this checklist — in the todos widget", { n: items.length - done })}
        </button>
      )}
      {unfold && widget && (
        <button type="button" contentEditable={false} className="ws-list-merged-note" onClick={() => setUnfold(false)}>
          {t("Fold into the widget again")}
        </button>
      )}
      {head.visible && !fold && (
      <TodoHeader
        onHide={head.hide}
        title={String(node.attrs.title ?? "")}
        onTitle={(v) => updateAttributes({ title: v })}
        placeholder={t("To-do list")}
        done={done}
        total={items.length}
        engine={node.attrs.engine === true}
        disabled={!editor.isEditable}
        menu={(close) => (
          <>
            <MenuItem onClick={() => (close(), updateAttributes({ engine: node.attrs.engine === true ? false : true }))}>
              {node.attrs.engine === true ? "☑" : "☐"} {t("Open items are todos (Todo engine)")}
            </MenuItem>
            <MenuItem onClick={() => (close(), void convert())}>▦ {busy ? "…" : t("Turn into a database")}</MenuItem>
          </>
        )}
      />
      )}
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
      // (null: as the page says — a note of the Agenda: on; false: switched off.)
      engine: { default: null, parseHTML: (el: HTMLElement) => (el.getAttribute("data-engine") === "true" ? true : null), renderHTML: (a: Record<string, unknown>) => (a.engine ? { "data-engine": "true" } : {}) },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskListView);
  },
});

// ---------------------------------------------------------------------------
// A list embedded elsewhere
// ---------------------------------------------------------------------------

type Loaded = { path: string; title: string; pageId: number; listId: string; engine: boolean; items: { itemId: string; text: string; checked: boolean; depth: number; due: string | null }[] };

function TodoListEmbedView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const t = useT();
  const router = useRouter();
  const pageId = Number(node.attrs.pageId);
  const listId = String(node.attrs.listId);
  const [list, setList] = useState<Loaded | null | "gone">(null);
  const editable = editor.isEditable;
  const head = useCollapsibleHead();
  const load = useCallback(
    () =>
      taskListAction(pageId, listId).then((r) => {
        setList(r.ok ? { ...r.list, listId } : "gone");
      }),
    [pageId, listId],
  );
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
    <NodeViewWrapper className={`ws-todo-block ws-todo-embed ${head.visible ? "" : "is-headless"}`} contentEditable={false} data-todo-embed {...head.frame}>
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label={t("Embedded to-do list")} />
      {list === null ? (
        <p className="text-sm text-zinc-400">…</p>
      ) : list === "gone" ? (
        <p className="text-sm text-zinc-500">{t("This list is gone (or its page).")}</p>
      ) : (
        <>
          {head.visible && (
          <TodoHeader
            onHide={head.hide}
            title={list.title || list.path.split(" / ").slice(-2).join(" / ")}
            href={`/workspace/${list.pageId}`}
            placeholder=""
            done={list.items.filter((i) => i.checked).length}
            total={list.items.length}
            engine={list.engine}
            disabled={!editable}
            menu={(close) => (
              <>
                <MenuItem
                  onClick={async () => {
                    close();
                    const r = await taskListMetaAction(pageId, listId, { engine: !list.engine });
                    if (!r.ok) toast(r.error, { tone: "error" });
                    await load();
                  }}
                >
                  {list.engine ? "☑" : "☐"} {t("Open items are todos (Todo engine)")}
                </MenuItem>
                <MenuItem
                  onClick={async () => {
                    close();
                    if (!confirmAction(t("Turn this list into a database? Its items become rows with a Todo view, right here."))) return;
                    const r = await convertTaskListAction(pageId, listId);
                    if (!r.ok) return void toast(r.error, { tone: "error" });
                    router.push(`/workspace/${r.dbId}`);
                  }}
                >
                  ▦ {t("Turn into a database")}
                </MenuItem>
              </>
            )}
          />
          )}
          <TodoList
            withDue
            disabled={!editable}
            items={list.items.map((i) => ({ id: i.itemId, text: i.text, done: i.checked, due: i.due, depth: i.depth }))}
            onCheck={(id, checked) => void act({ kind: "check", itemId: String(id), checked })}
            onText={(id, text) => void act({ kind: "text", itemId: String(id), text })}
            onDue={(id, due) => void act({ kind: "due", itemId: String(id), due })}
            onRemove={(id) => void act({ kind: "remove", itemId: String(id) })}
          />
          <TodoAddLine disabled={!editable} onAdd={(text) => void act({ kind: "add", text })} />
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
