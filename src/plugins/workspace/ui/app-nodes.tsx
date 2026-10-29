"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { addRelatedRowAction, layoutChoicesAction, restorePageAction, relatedRowsAction, rowButtonAction, rowContextAction, type DatabaseData } from "../actions";
import type { LayoutChoices, RelatedRow } from "../app-blocks";
import { RowField } from "./DatabaseView";

/**
 * The blocks an app's layout is made of, beside the modules of a detail view: a field of the row (edited in place), a list of the
 * rows of another database that belong to it, a button that does something to the row. Each knows the row whose page it is on (or
 * is being laid out for) — on a layout page that is no row they show what they will be, and, being edited, let you pick.
 */

// ---------------------------------------------------------------------------
// The row's data, once for all the blocks of a page
// ---------------------------------------------------------------------------

type Entry = { data: DatabaseData | null; loading: boolean; at: number };
const rows = new Map<number, Entry>();
const subs = new Set<() => void>();
const inflight = new Map<number, Promise<void>>();
const LOADING: Entry = { data: null, loading: true, at: 0 };

/** What the server read with the page: used at once. */
export function seedRowData(rowId: number, data: DatabaseData) {
  rows.set(rowId, { data, loading: false, at: Date.now() });
}

function loadRow(rowId: number): Promise<void> {
  const running = inflight.get(rowId);
  if (running) return running;
  const p = rowContextAction(rowId)
    .then((r) => {
      rows.set(rowId, { data: r.ok ? r.data : null, loading: false, at: Date.now() });
      subs.forEach((s) => s());
    })
    .finally(() => inflight.delete(rowId));
  inflight.set(rowId, p);
  return p;
}

export function useRowData(rowId: number): Entry {
  const entry = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => rows.get(rowId) ?? LOADING,
    () => LOADING,
  );
  useEffect(() => {
    if (Date.now() - (rows.get(rowId)?.at ?? 0) > 5000) void loadRow(rowId);
  }, [rowId]);
  return entry;
}

function useChoices(pageId: number, on: boolean) {
  const [choices, setChoices] = useState<LayoutChoices | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    void layoutChoicesAction(pageId).then((r) => live && r.ok && setChoices(r.choices));
    return () => {
      live = false;
    };
  }, [pageId, on]);
  return choices;
}

/** Where a block can be taken by: dragged elsewhere, a line added after it, removed — shown when it is hovered, while editing the layout. */
export function GripBar({ editor, node, getPos, deleteNode, label }: Pick<NodeViewProps, "editor" | "node" | "getPos" | "deleteNode"> & { label: string }) {
  if (!editor.isEditable) return null;
  return (
    <div className="ws-grip-bar" contentEditable={false}>
      <span data-drag-handle className="ws-grip-btn" title="Drag to move" aria-hidden="true">
        ⠿
      </span>
      <span className="ws-grip-label">{label}</span>
      <button
        type="button"
        title="A new line after this block"
        aria-label="A new line after this block"
        onClick={() => {
          const pos = typeof getPos === "function" ? getPos() : undefined;
          if (pos !== undefined) editor.chain().focus().insertContentAt(pos + node.nodeSize, { type: "paragraph" }).run();
        }}
      >
        ＋
      </button>
      <button type="button" title="Remove this block" aria-label="Remove this block" onClick={() => deleteNode()}>
        ✕
      </button>
    </div>
  );
}

const ctxPageId = (e: NodeViewProps["extension"]) => Number((e.options as { pageId: number }).pageId);
const Placeholder = ({ children }: { children: React.ReactNode }) => <div className="rounded-lg border border-dashed border-zinc-300 p-2 text-sm text-zinc-500 dark:border-zinc-700">▤ {children}</div>;

// ---------------------------------------------------------------------------
// A field
// ---------------------------------------------------------------------------

function FieldView({ node, updateAttributes, editor, extension, getPos, deleteNode }: NodeViewProps) {
  const t = useT();
  const pageId = ctxPageId(extension);
  const prop = String(node.attrs.prop ?? "");
  const showLabel = node.attrs.label !== false;
  const { data } = useRowData(pageId);
  const choices = useChoices(pageId, editor.isEditable);
  const name = choices?.properties.find((p) => p.id === prop)?.name ?? data?.schema.properties.find((p) => p.id === prop)?.name ?? (prop === "title" ? data?.schema.titleName : "") ?? "";
  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-1" contentEditable={false} data-app-block="field">
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label="field" />
      {editor.isEditable && (
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <select className="input w-auto py-0.5 text-xs" value={prop} onChange={(e) => updateAttributes({ prop: e.target.value })} aria-label={t("Field")}>
            <option value="">{t("Pick a field …")}</option>
            {(choices?.properties ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={showLabel} onChange={(e) => updateAttributes({ label: e.target.checked })} />
            {t("Name shown")}
          </label>
        </div>
      )}
      {!prop ? (
        <Placeholder>{t("A field of the entry — pick which")}</Placeholder>
      ) : data ? (
        <RowField initial={data} dbId={data.id} rowId={pageId} propId={prop} showLabel={showLabel} />
      ) : (
        <Placeholder>{name ? t("{field} — the entry's, edited in place", { field: name }) : t("A field of the entry")}</Placeholder>
      )}
    </NodeViewWrapper>
  );
}

export const ZeffField = Node.create<{ pageId: number }>({
  name: "zeffField",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { prop: { default: "" }, label: { default: true } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-field]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-field": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FieldView);
  },
});

// ---------------------------------------------------------------------------
// A related list
// ---------------------------------------------------------------------------

function RelatedView({ node, updateAttributes, editor, extension, getPos, deleteNode }: NodeViewProps) {
  const t = useT();
  const router = useRouter();
  const pageId = ctxPageId(extension);
  const dbId = Number(node.attrs.dbId) || 0;
  const prop = String(node.attrs.prop ?? "");
  const { data } = useRowData(pageId);
  const choices = useChoices(pageId, editor.isEditable);
  const [list, setList] = useState<RelatedRow[] | null>(null);
  const [title, setTitle] = useState("");
  const load = () => void relatedRowsAction(pageId, dbId, prop).then((r) => r.ok && setList(r.rows));
  useEffect(() => {
    if (data && dbId && prop) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read when the row, the database or the relation changes
  }, [data?.id, pageId, dbId, prop]);
  const label = choices?.related.find((r) => r.dbId === dbId && r.prop === prop);
  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-2" contentEditable={false} data-app-block="related">
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label="related rows" />
      {editor.isEditable && (
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <select
            className="input w-auto py-0.5 text-xs"
            value={dbId && prop ? `${dbId}:${prop}` : ""}
            onChange={(e) => {
              const [d, p] = e.target.value.split(":");
              updateAttributes({ dbId: Number(d) || null, prop: p ?? "" });
            }}
            aria-label={t("Rows that belong to it")}
          >
            <option value="">{t("Pick the rows that belong to it …")}</option>
            {(choices?.related ?? []).map((r) => (
              <option key={`${r.dbId}:${r.prop}`} value={`${r.dbId}:${r.prop}`}>
                {r.title} · {r.propName}
              </option>
            ))}
          </select>
        </div>
      )}
      {!dbId || !prop ? (
        <Placeholder>{t("The rows of another database that belong to the entry — pick which")}</Placeholder>
      ) : !data ? (
        <Placeholder>{label ? t("{title} of the entry", { title: label.title }) : t("The rows that belong to the entry")}</Placeholder>
      ) : (
        <section className="ws-module space-y-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h4 className="text-xs font-semibold text-zinc-500 uppercase">{label?.title ?? t("Related")}</h4>
          {list === null ? (
            <p className="text-sm text-zinc-400">…</p>
          ) : list.length ? (
            <ul className="space-y-1 text-sm">
              {list.map((r) => (
                <li key={r.id} className="flex items-baseline gap-2">
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => router.push(`/workspace/${r.id}`)}>
                    {r.title || t("Untitled")}
                  </button>
                  {r.details.map((d, i) => (
                    <span key={i} className="shrink-0 rounded bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {d}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-400">{t("None yet.")}</p>
          )}
          <form
            className="flex gap-2 pt-1"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!title.trim()) return;
              const r = await addRelatedRowAction(pageId, dbId, prop, title);
              if (!r.ok) return void toast(r.error, { tone: "error" });
              setTitle("");
              load();
            }}
          >
            <input className="input py-0.5 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("＋ Add …")} aria-label={t("Add a row")} />
          </form>
        </section>
      )}
    </NodeViewWrapper>
  );
}

export const ZeffRelated = Node.create<{ pageId: number }>({
  name: "zeffRelated",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { dbId: { default: null }, prop: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-related]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-related": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RelatedView);
  },
});

// ---------------------------------------------------------------------------
// A button
// ---------------------------------------------------------------------------

function ButtonView({ node, updateAttributes, editor, extension, getPos, deleteNode }: NodeViewProps) {
  const t = useT();
  const router = useRouter();
  const pageId = ctxPageId(extension);
  const label = String(node.attrs.label ?? "");
  const action = String(node.attrs.action ?? "set");
  const prop = String(node.attrs.prop ?? "");
  const value = String(node.attrs.value ?? "");
  const { data } = useRowData(pageId);
  const choices = useChoices(pageId, editor.isEditable);
  const [busy, setBusy] = useState(false);
  const shown = label || (action === "trash" ? t("Move to the trash") : action === "refresh" ? t("Read again") : t("Set"));
  const press = async () => {
    if (!data) return void toast(t("The button works on an entry — open one."));
    setBusy(true);
    const r = await rowButtonAction(pageId, { action, prop, value });
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    if (action === "trash")
      toast(r.message, {
        action: {
          label: t("Undo"),
          run: async () => {
            await restorePageAction(pageId);
            router.refresh();
          },
        },
      });
    else toast(r.message);
    if (action === "trash") router.push(`/workspace/${data.id}`);
    else {
      rows.delete(pageId);
      void loadRow(pageId);
      router.refresh();
    }
  };
  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-1" contentEditable={false} data-app-block="button">
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label="button" />
      {editor.isEditable && (
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <input className="input w-32 py-0.5 text-xs" value={label} onChange={(e) => updateAttributes({ label: e.target.value })} placeholder={t("Label")} aria-label={t("Label")} />
          <select className="input w-auto py-0.5 text-xs" value={action} onChange={(e) => updateAttributes({ action: e.target.value })} aria-label={t("What it does")}>
            <option value="set">{t("Set a field")}</option>
            <option value="trash">{t("Move to the trash")}</option>
            <option value="refresh">{t("Read the sources again")}</option>
          </select>
          {action === "set" && (
            <>
              <select className="input w-auto py-0.5 text-xs" value={prop} onChange={(e) => updateAttributes({ prop: e.target.value })} aria-label={t("Field")}>
                <option value="">{t("Pick a field …")}</option>
                {(choices?.properties ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input className="input w-28 py-0.5 text-xs" value={value} onChange={(e) => updateAttributes({ value: e.target.value })} placeholder={t("to")} aria-label={t("Value")} />
            </>
          )}
        </div>
      )}
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void press()}>
        {busy ? "…" : shown}
      </button>
    </NodeViewWrapper>
  );
}

export const ZeffButton = Node.create<{ pageId: number }>({
  name: "zeffButton",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { label: { default: "" }, action: { default: "set" }, prop: { default: "" }, value: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-button]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-button": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ButtonView);
  },
});
