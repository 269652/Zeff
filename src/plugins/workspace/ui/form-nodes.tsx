"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { convertFormBlockAction, createFormAction, databasesAction, formAction, formsAction, legacyFormAction, submitLegacyFormAction } from "../actions";
import type { FormRun } from "../forms";
import { FormDesigner } from "./form-designer";
import { FormRunner } from "./form-runner";
import { cellText, type Property } from "../model";
import { conditionHolds, type RecordOf } from "../routine-conditions";
import { GripBar, useRowData } from "./app-nodes";

/**
 * More parts for building an app's pages with clicks: a form (a form page shown in the page — filled in, it makes a row; routines on
 * "row added" go on from there), a block shown only when a condition on the entry holds, and tabs (each a box of blocks).
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

/**
 * A form in a page: a form page (`formId`) filled in right here — and, while the page is edited, "Edit form" opens its designer in
 * place. Without one yet: make a new form for a database (below this page) or show one there is. An old block (a database and its
 * fields, no form page) becomes a form page the first time its page is edited; read, it is still filled in as it was.
 */
function FormBlockView({ node, updateAttributes, editor, extension, getPos, deleteNode }: NodeViewProps) {
  const t = useT();
  const pageId = Number((extension.options as { pageId: number }).pageId) || 0;
  const formId = Number(node.attrs.formId) || 0;
  const legacyDb = Number(node.attrs.dbId) || 0;
  const fields = asList(node.attrs.fields);
  const label = String(node.attrs.label ?? "");
  const editable = editor.isEditable;
  const [form, setForm] = useState<FormRun | null>(null);
  const [error, setError] = useState("");
  const [designing, setDesigning] = useState(false);
  const [run, setRun] = useState(0);
  const converting = useRef(false);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new form to load: the old one's error goes
    setError("");
    if (formId) void formAction(formId).then((r) => live && (r.ok ? setForm(r.form) : setError(r.error)));
    else if (legacyDb && editable && !converting.current) {
      // An old block in a page being edited: it becomes a form page once (below this page), and names it from then on.
      converting.current = true;
      void convertFormBlockAction(pageId, legacyDb, fields, label).then((r) => (r.ok ? updateAttributes({ formId: r.id, dbId: null, fields: "[]", label: "" }) : live && setError(r.error)));
    } else if (legacyDb) void legacyFormAction(legacyDb, fields, label).then((r) => live && (r.ok ? setForm(r.form) : setError(r.error)));
    else setForm(null);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by what the block names
  }, [formId, legacyDb, editable]);

  const legacy = !formId && !!legacyDb;
  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-2" contentEditable={false} data-app-block="form" data-form-ui="">
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label={t("Form")} />
      {error ? (
        <p className="alert-error text-sm" role="alert">
          {error}
        </p>
      ) : !formId && !legacyDb ? (
        editable ? (
          <FormChooser pageId={pageId} onPick={(id, design) => (updateAttributes({ formId: id, dbId: null, fields: "[]", label: "" }), setDesigning(design))} />
        ) : null
      ) : !form ? (
        <p className="text-sm text-zinc-400">…</p>
      ) : (
        <div className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          {editable && !legacy && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" className="btn btn-sm" aria-pressed={designing} onClick={() => (setDesigning(!designing), designing && setRun((n) => n + 1))}>
                ✎ {designing ? t("Done editing") : t("Edit form")}
              </button>
              <Link href={`/workspace/${form.id}`} className="text-indigo-700 hover:underline dark:text-indigo-400">
                {t("Open the form page")} →
              </Link>
            </div>
          )}
          {designing && editable && !legacy ? (
            <FormDesigner initial={form} onChange={setForm} />
          ) : (
            <FormRunner key={run} form={form} headingLevel={2} submit={legacy ? (a) => submitLegacyFormAction(legacyDb, fields, label, a) : undefined} />
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** A form block without a form: a new one for a database (made below this page, its designer opened), or one there is. */
function FormChooser({ pageId, onPick }: { pageId: number; onPick: (formId: number, design: boolean) => void }) {
  const t = useT();
  const [databases, setDatabases] = useState<{ id: number; title: string }[]>([]);
  const [forms, setForms] = useState<{ id: number; title: string; dbTitle: string }[]>([]);
  const [dbId, setDbId] = useState(0);
  const [err, setErr] = useState("");
  useEffect(() => {
    void databasesAction().then((r) => r.ok && setDatabases(r.databases.map((d) => ({ id: d.id, title: d.title }))));
    void formsAction().then((r) => r.ok && setForms(r.forms));
  }, []);
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-zinc-300 p-3 text-sm dark:border-zinc-700">
      <p className="font-medium">📝 {t("A form that makes entries of a database")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={dbId || ""} onChange={(e) => setDbId(Number(e.target.value) || 0)} aria-label={t("Database the new form fills")}>
          <option value="">{t("Choose a database …")}</option>
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!dbId}
          onClick={async () => {
            const r = await createFormAction({ parentId: pageId || null, dbId });
            if (!r.ok) return setErr(r.error);
            onPick(r.id, true);
          }}
        >
          {t("Create the form")}
        </button>
      </div>
      {forms.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">{t("or show a form there is:")}</span>
          <select className="input w-auto" value="" onChange={(e) => Number(e.target.value) && onPick(Number(e.target.value), false)} aria-label={t("Form to show here")}>
            <option value="">{t("Choose a form …")}</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
                {f.dbTitle ? ` → ${f.dbTitle}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {err && (
        <p role="alert" className="alert-error">
          {err}
        </p>
      )}
    </div>
  );
}

export const ZeffForm = Node.create<{ pageId: number }>({
  name: "zeffForm",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    // (dbId, fields, label: an old block's — read until it becomes a form page.)
    return { formId: { default: null }, dbId: { default: null }, fields: { default: "[]" }, label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-form]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-form": "" })];
  },
  addNodeView() {
    // (Typing, clicks, drags and drops inside the form or its designer are the form's — not the editor's.)
    return ReactNodeViewRenderer(FormBlockView, { stopEvent: ({ event }) => !!(event.target instanceof Element && event.target.closest("[data-form-ui]")) });
  },
});

// ---------------------------------------------------------------------------
// Shown only when
// ---------------------------------------------------------------------------

const OPS = ["is", "is_not", "contains", "not_contains", "empty", "not_empty"] as const;

function IfView({ node, updateAttributes, editor, extension, getPos, deleteNode }: NodeViewProps) {
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
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label={t("Shown only if")} />
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
