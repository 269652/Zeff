"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { formChoicesAction, routineChoicesAction, submitFormAction } from "../actions";
import { cellText, type Property } from "../model";
import { conditionHolds, type RecordOf } from "../routine-conditions";
import { useRowData } from "./app-nodes";

/**
 * More parts for building an app's pages with clicks: a form (a row from what is typed — routines on "row added" go on from there),
 * a block shown only when a condition on the entry holds, and tabs (each a box of blocks).
 */

const asList = (v: unknown): string[] => {
  try {
    const x = JSON.parse(String(v || "[]")) as unknown;
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// A form
// ---------------------------------------------------------------------------

type FormChoices = { titleName: string; properties: { id: string; name: string; type: string; options: string[] }[] };

function FormView({ node, updateAttributes, editor }: NodeViewProps) {
  const t = useT();
  const dbId = Number(node.attrs.dbId) || 0;
  const fields = asList(node.attrs.fields);
  const label = String(node.attrs.label ?? "");
  const [databases, setDatabases] = useState<{ id: number; title: string }[]>([]);
  const [choices, setChoices] = useState<FormChoices | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<number | null>(null);
  useEffect(() => {
    if (editor.isEditable) void routineChoicesAction().then((r) => r.ok && setDatabases(r.databases.map((d) => ({ id: d.id, title: d.title }))));
  }, [editor.isEditable]);
  useEffect(() => {
    if (!dbId) return setChoices(null);
    let live = true;
    void formChoicesAction(dbId).then((r) => live && setChoices(r.ok ? r.choices : null));
    return () => {
      live = false;
    };
  }, [dbId]);
  const shown = (choices?.properties ?? []).filter((p) => fields.includes(p.id));
  const submit = async () => {
    setBusy(true);
    const r = await submitFormAction(dbId, fields, values);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setValues({});
    setMade(r.id);
    toast(t("Added ✓"));
  };
  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-2" contentEditable={false} data-app-block="form">
      {editor.isEditable && (
        <div className="mb-1 space-y-1.5 text-xs text-zinc-500">
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto py-0.5 text-xs" value={dbId || ""} onChange={(e) => updateAttributes({ dbId: Number(e.target.value) || null, fields: "[]" })} aria-label={t("Which database")}>
              <option value="">{t("Pick the database the form fills …")}</option>
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
            <input className="input w-32 py-0.5 text-xs" value={label} placeholder={t("Button text")} onChange={(e) => updateAttributes({ label: e.target.value })} aria-label={t("Button text")} />
          </div>
          {choices && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {choices.properties.map((p) => (
                <label key={p.id} className="flex items-center gap-1">
                  <input type="checkbox" checked={fields.includes(p.id)} onChange={(e) => updateAttributes({ fields: JSON.stringify(e.target.checked ? [...fields, p.id] : fields.filter((x) => x !== p.id)) })} />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {!dbId ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-2 text-sm text-zinc-500 dark:border-zinc-700">▤ {t("A form that makes a row — pick its database")}</p>
      ) : !choices ? (
        <p className="text-sm text-zinc-400">…</p>
      ) : (
        <form
          className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block text-sm">
            <span className="label">{choices.titleName}</span>
            <input className="input" value={values.title ?? ""} onChange={(e) => setValues({ ...values, title: e.target.value })} required />
          </label>
          {shown.map((p) => (
            <label key={p.id} className="block text-sm">
              <span className="label">{p.name}</span>
              {p.type === "select" || p.type === "status" ? (
                <select className="input" value={values[p.id] ?? ""} onChange={(e) => setValues({ ...values, [p.id]: e.target.value })}>
                  <option value="">—</option>
                  {p.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : p.type === "checkbox" ? (
                <input type="checkbox" checked={values[p.id] === "true"} onChange={(e) => setValues({ ...values, [p.id]: e.target.checked ? "true" : "" })} />
              ) : (
                <input className="input" type={p.type === "number" ? "number" : p.type === "date" ? "date" : "text"} value={values[p.id] ?? ""} onChange={(e) => setValues({ ...values, [p.id]: e.target.value })} />
              )}
            </label>
          ))}
          <div className="flex items-center gap-3">
            <button className="btn btn-primary btn-sm" disabled={busy || !(values.title ?? "").trim()}>
              {busy ? "…" : label || t("Send")}
            </button>
            {made && (
              <Link href={`/workspace/${made}`} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                {t("Open it")} →
              </Link>
            )}
          </div>
        </form>
      )}
    </NodeViewWrapper>
  );
}

export const ZeffForm = Node.create({
  name: "zeffForm",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { dbId: { default: null }, fields: { default: "[]" }, label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-form]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-form": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FormView);
  },
});

// ---------------------------------------------------------------------------
// Shown only when
// ---------------------------------------------------------------------------

const OPS = ["is", "is_not", "contains", "not_contains", "empty", "not_empty"] as const;

function IfView({ node, updateAttributes, editor, extension }: NodeViewProps) {
  const t = useT();
  const pageId = Number((extension.options as { pageId: number }).pageId);
  const field = String(node.attrs.field ?? "");
  const op = String(node.attrs.op ?? "is") as (typeof OPS)[number];
  const value = String(node.attrs.value ?? "");
  const { data } = useRowData(pageId);
  const row = data?.rows.find((r) => r.id === pageId);
  let met = true;
  if (data && row && field) {
    const rec: RecordOf = { title: row.title, [data.schema.titleName.toLowerCase()]: row.title };
    for (const p of data.schema.properties as Property[]) rec[p.name.toLowerCase()] = p.type === "checkbox" ? row.cells[p.id] === true : cellText(p, row.cells[p.id]);
    met = conditionHolds({ rules: [{ field, op, value }] }, rec);
  }
  const ops: Record<(typeof OPS)[number], string> = { is: t("is"), is_not: t("isn't"), contains: t("contains"), not_contains: t("doesn't contain"), empty: t("is empty"), not_empty: t("isn't empty") };
  return (
    <NodeViewWrapper className={`ws-if my-2 ${met ? "" : editor.isEditable ? "ws-if-off" : "ws-if-hidden"}`} data-met={met ? "true" : "false"}>
      {editor.isEditable && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500" contentEditable={false}>
          <span>{t("Shown only if")}</span>
          <input className="input w-28 py-0.5 text-xs" value={field} placeholder={t("Field")} onChange={(e) => updateAttributes({ field: e.target.value })} aria-label={t("Field")} />
          <select className="input w-auto py-0.5 text-xs" value={op} onChange={(e) => updateAttributes({ op: e.target.value })} aria-label={t("Condition")}>
            {OPS.map((o) => (
              <option key={o} value={o}>
                {ops[o]}
              </option>
            ))}
          </select>
          {op !== "empty" && op !== "not_empty" && <input className="input w-32 py-0.5 text-xs" value={value} placeholder={t("Value")} onChange={(e) => updateAttributes({ value: e.target.value })} aria-label={t("Value")} />}
          {!met && <span className="text-amber-700 dark:text-amber-400">· {t("not shown for this entry")}</span>}
        </div>
      )}
      <NodeViewContent className="ws-if-body" />
    </NodeViewWrapper>
  );
}

/** Blocks that are shown only when a field of the entry has a value (on a page that is no entry: always). */
export const ZeffIf = Node.create<{ pageId: number }>({
  name: "zeffIf",
  group: "block",
  content: "block+",
  defining: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { field: { default: "" }, op: { default: "is" }, value: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-if]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-if": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(IfView);
  },
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function TabsView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const t = useT();
  const titles = asList(node.attrs.titles);
  const panels = node.childCount;
  const [shown, setShown] = useState(Math.min(Number(node.attrs.active) || 0, Math.max(0, panels - 1)));
  const active = Math.min(shown, Math.max(0, panels - 1));
  const names = Array.from({ length: panels }, (_, i) => titles[i] || `${t("Tab")} ${i + 1}`);
  const setTitle = (i: number, v: string) => updateAttributes({ titles: JSON.stringify(names.map((n, k) => (k === i ? v : n))) });
  const addTab = () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos === undefined) return;
    editor.chain().focus().insertContentAt(pos + node.nodeSize - 1, { type: "flexBox", attrs: { dir: "col", gap: "md" }, content: [{ type: "paragraph" }] }).run();
    updateAttributes({ titles: JSON.stringify([...names, `${t("Tab")} ${panels + 1}`]) });
    setShown(panels);
  };
  const removeTab = () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos === undefined || panels <= 1) return;
    let from = pos + 1;
    for (let i = 0; i < active; i++) from += node.child(i).nodeSize;
    editor.chain().focus().deleteRange({ from, to: from + node.child(active).nodeSize }).run();
    updateAttributes({ titles: JSON.stringify(names.filter((_, i) => i !== active)) });
    setShown(Math.max(0, active - 1));
  };
  return (
    <NodeViewWrapper className="ws-tabs my-2" data-active={active}>
      <div className="mb-2 flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist" contentEditable={false}>
        {names.map((n, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={`-mb-px border-b-2 px-3 py-1 text-sm ${i === active ? "border-indigo-500 font-medium text-indigo-700 dark:text-indigo-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
            onClick={() => {
              setShown(i);
              if (editor.isEditable) updateAttributes({ active: i });
            }}
          >
            {n}
          </button>
        ))}
        {editor.isEditable && (
          <>
            <input className="input ml-2 w-28 py-0.5 text-xs" value={names[active] ?? ""} onChange={(e) => setTitle(active, e.target.value)} aria-label={t("Tab name")} />
            <button type="button" className="icon-btn" title={t("Add a tab")} aria-label={t("Add a tab")} onClick={addTab}>
              ＋
            </button>
            <button type="button" className="icon-btn" title={t("Remove this tab")} aria-label={t("Remove this tab")} disabled={panels <= 1} onClick={removeTab}>
              ✕
            </button>
          </>
        )}
      </div>
      <NodeViewContent className="ws-tabs-body" />
    </NodeViewWrapper>
  );
}

/** Tabs: each tab is a box of blocks (the first shows; the others wait behind their titles). */
export const ZeffTabs = Node.create({
  name: "zeffTabs",
  group: "block",
  content: "flexBox+",
  defining: true,
  addAttributes() {
    return { titles: { default: "[]" }, active: { default: 0 } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-tabs]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-tabs": "" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TabsView);
  },
});
