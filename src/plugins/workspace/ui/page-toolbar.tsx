"use client";

import type { Editor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { exportNotebookAction, importNotebookAction } from "@/plugins/notebook/server-actions";
import { interruptCellAction, restartKernelAction } from "@/plugins/notebook/server-actions";
import { runAllCells, useCellRunState } from "./code-cell";
import { LOCK_META } from "./data-flow-ext";
import { Dropdown, MenuItem, MenuSection, pickFile } from "./kit";
import { cellAt } from "./table-formulas";

/**
 * The page's floating menu bar: it stays at the top while you scroll and offers what fits where you are — like the menu bar of a
 * program. Always: Edit (undo, redo), Insert (blocks), Page (notebook files). By the context: Format (text selected or the caret in text),
 * Table (the caret in a table), Run (the page has code cells). At its right the sticky **Run all** — every code cell of the page, in the
 * order of the page — with Stop, while cells run.
 */

const download = (name: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const MENU = "rounded-md px-2.5 py-1 text-sm text-zinc-700 hover:bg-zinc-500/10 dark:text-zinc-200";

/** The languages of the code cells in the page (their sessions are stopped or restarted together). */
function codeLanguages(editor: Editor): string[] {
  const out = new Set<string>();
  editor.state.doc.descendants((n) => {
    if (n.type.name === "codeCell") out.add(String(n.attrs.language || "python"));
    return true;
  });
  return [...out];
}

export function PageToolbar({ editor, pageId }: { editor: Editor; pageId: number }) {
  const t = useT();
  const router = useRouter();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [runningAll, setRunningAll] = useState(false);
  const { cells, busy } = useCellRunState(pageId);
  // (The bar follows the editor: what the caret is in decides what it offers.)
  useEffect(() => {
    editor.on("transaction", bump);
    return () => void editor.off("transaction", bump);
  }, [editor]);

  const session = `page-${pageId}`;
  const sel = editor.state.selection;
  const inTable = editor.isActive("table");
  const hasCode = editor.state.doc.childCount > 0 && codeLanguages(editor).length > 0;
  const text = !sel.empty || editor.isActive("paragraph") || editor.isActive("heading");
  const c = () => editor.chain().focus();
  const insert = (content: unknown) => c().insertContent(content as never).run();
  const block = (type: string, attrs: Record<string, unknown>) => insert([{ type, attrs }, { type: "paragraph" }]);

  const stopAll = () => {
    for (const l of codeLanguages(editor)) void interruptCellAction(session, l);
  };
  const runAll = async () => {
    if (runningAll) return;
    setRunningAll(true);
    try {
      await runAllCells(pageId);
    } finally {
      setRunningAll(false);
    }
  };
  const restartAll = () => {
    for (const l of codeLanguages(editor)) void restartKernelAction(session, l);
    toast(t("The sessions were restarted — their variables are gone."));
  };

  const tablePos = inTable ? cellAt(editor.state)?.table.pos : undefined;
  const tableNode = tablePos !== undefined ? editor.state.doc.nodeAt(tablePos) : null;
  const locked = tableNode?.attrs.locked === true;

  return (
    <div
      className="ws-toolbar sticky top-0 z-30 -mx-1 mb-2 flex flex-wrap items-center gap-0.5 rounded-lg border border-zinc-200 bg-white/90 px-1.5 py-1 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90"
      role="toolbar"
      aria-label={t("Page menu")}
      onMouseDown={(e) => {
        // (A click on the bar must not take the caret out of the text.)
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      <Dropdown label={t("Edit")} className={MENU} wrapClassName="relative inline-block">
        {(close) => (
          <div className="w-52">
            <MenuItem disabled={!editor.can().undo()} onClick={() => (close(), c().undo().run())}>↶ {t("Undo")}</MenuItem>
            <MenuItem disabled={!editor.can().redo()} onClick={() => (close(), c().redo().run())}>↷ {t("Redo")}</MenuItem>
            <MenuItem onClick={() => (close(), c().selectAll().run())}>▣ {t("Select all")}</MenuItem>
          </div>
        )}
      </Dropdown>

      <Dropdown label={t("Insert")} className={MENU} wrapClassName="relative inline-block">
        {(close) => {
          const go = (fn: () => void) => () => (close(), fn());
          return (
            <div className="w-60">
              <MenuSection title={t("Text")}>
                <MenuItem onClick={go(() => c().toggleHeading({ level: 1 }).run())}>H1 {t("Heading 1")}</MenuItem>
                <MenuItem onClick={go(() => c().toggleHeading({ level: 2 }).run())}>H2 {t("Heading 2")}</MenuItem>
                <MenuItem onClick={go(() => c().toggleHeading({ level: 3 }).run())}>H3 {t("Heading 3")}</MenuItem>
                <MenuItem onClick={go(() => c().toggleBulletList().run())}>• {t("Bulleted list")}</MenuItem>
                <MenuItem onClick={go(() => c().toggleOrderedList().run())}>1. {t("Numbered list")}</MenuItem>
                <MenuItem onClick={go(() => c().toggleTaskList().run())}>☐ {t("To-do list")}</MenuItem>
                <MenuItem onClick={go(() => c().toggleBlockquote().run())}>❝ {t("Quote")}</MenuItem>
                <MenuItem onClick={go(() => c().setHorizontalRule().run())}>― {t("Divider")}</MenuItem>
              </MenuSection>
              <MenuSection title={t("Blocks")}>
                <MenuItem onClick={go(() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>▦ {t("Table")}</MenuItem>
                <MenuItem onClick={go(() => insert({ type: "callout", attrs: { icon: "💡", tone: "gray" }, content: [{ type: "paragraph" }] }))}>💬 {t("Info box")}</MenuItem>
                <MenuItem onClick={go(() => insert({ type: "panel", attrs: { title: "", desc: "", collapsed: false }, content: [{ type: "paragraph" }] }))}>🗂 {t("Panel")}</MenuItem>
                <MenuItem onClick={go(() => block("tablePipe", { name: "", from: "@above", steps: "" }))}>🔀 {t("Transform")}</MenuItem>
                <MenuItem onClick={go(() => block("pipeResult", { of: "@above", title: "" }))}>📋 {t("Result table")}</MenuItem>
              </MenuSection>
              <MenuSection title={t("Code")}>
                <MenuItem onClick={go(() => block("codeCell", { language: "python", source: "", outputs: "", count: 0 }))}>⌨️ Python</MenuItem>
                <MenuItem onClick={go(() => block("codeCell", { language: "node", source: "", outputs: "", count: 0 }))}>⌨️ Node.js</MenuItem>
                <MenuItem onClick={go(() => block("codeCell", { language: "rust", source: "", outputs: "", count: 0 }))}>⌨️ Rust</MenuItem>
              </MenuSection>
            </div>
          );
        }}
      </Dropdown>

      {text && (
        <Dropdown label={t("Format")} className={MENU} wrapClassName="relative inline-block">
          {(close) => {
            const go = (fn: () => void) => () => (close(), fn());
            return (
              <div className="w-56">
                <MenuItem checked={editor.isActive("bold")} onClick={go(() => c().toggleBold().run())}><b>B</b> {t("Bold")}</MenuItem>
                <MenuItem checked={editor.isActive("italic")} onClick={go(() => c().toggleItalic().run())}><i>I</i> {t("Italic")}</MenuItem>
                <MenuItem checked={editor.isActive("underline")} onClick={go(() => c().toggleUnderline().run())}><u>U</u> {t("Underline")}</MenuItem>
                <MenuItem checked={editor.isActive("strike")} onClick={go(() => c().toggleStrike().run())}><s>S</s> {t("Strikethrough")}</MenuItem>
                <MenuItem checked={editor.isActive("code")} onClick={go(() => c().toggleCode().run())}>{"</>"} {t("Code")}</MenuItem>
                <MenuSection title={t("Turn into")}>
                  <MenuItem checked={editor.isActive("paragraph")} onClick={go(() => c().setParagraph().run())}>¶ {t("Text")}</MenuItem>
                  <MenuItem checked={editor.isActive("heading", { level: 1 })} onClick={go(() => c().setHeading({ level: 1 }).run())}>H1</MenuItem>
                  <MenuItem checked={editor.isActive("heading", { level: 2 })} onClick={go(() => c().setHeading({ level: 2 }).run())}>H2</MenuItem>
                  <MenuItem checked={editor.isActive("heading", { level: 3 })} onClick={go(() => c().setHeading({ level: 3 }).run())}>H3</MenuItem>
                </MenuSection>
                <MenuItem onClick={go(() => c().unsetAllMarks().run())}>⌫ {t("Clear formatting")}</MenuItem>
              </div>
            );
          }}
        </Dropdown>
      )}

      {inTable && (
        <Dropdown label={t("Table")} className={`${MENU} text-emerald-700 dark:text-emerald-300`} wrapClassName="relative inline-block">
          {(close) => {
            const go = (fn: () => void) => () => (close(), fn());
            return (
              <div className="w-56">
                <MenuItem onClick={go(() => c().addRowBefore().run())}>↑ {t("Row above")}</MenuItem>
                <MenuItem onClick={go(() => c().addRowAfter().run())}>↓ {t("Row below")}</MenuItem>
                <MenuItem onClick={go(() => c().addColumnBefore().run())}>← {t("Column left")}</MenuItem>
                <MenuItem onClick={go(() => c().addColumnAfter().run())}>→ {t("Column right")}</MenuItem>
                <MenuItem onClick={go(() => c().toggleHeaderRow().run())}>▤ {t("Header row on / off")}</MenuItem>
                <MenuItem onClick={go(() => c().deleteRow().run())}>✕ {t("Remove the row")}</MenuItem>
                <MenuItem onClick={go(() => c().deleteColumn().run())}>✕ {t("Remove the column")}</MenuItem>
                <MenuItem
                  onClick={go(() => {
                    if (tablePos !== undefined && tableNode) editor.view.dispatch(editor.state.tr.setNodeMarkup(tablePos, undefined, { ...tableNode.attrs, locked: !locked }).setMeta(LOCK_META, true));
                  })}
                >
                  {locked ? `🔓 ${t("Allow editing")}` : `🔒 ${t("Protect against editing")}`}
                </MenuItem>
                <MenuItem danger onClick={go(() => c().deleteTable().run())}>🗑 {t("Remove the table")}</MenuItem>
              </div>
            );
          }}
        </Dropdown>
      )}

      {hasCode && (
        <Dropdown label={t("Run")} className={`${MENU} text-indigo-700 dark:text-indigo-300`} wrapClassName="relative inline-block">
          {(close) => (
            <div className="w-64">
              <MenuItem onClick={() => (close(), void runAll())}>▶▶ {t("Run all cells")}</MenuItem>
              <MenuItem onClick={() => (close(), stopAll())}>■ {t("Stop")}</MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  restartAll();
                  void runAll();
                }}
              >
                ↻ {t("Restart the sessions and run all")}
              </MenuItem>
              <MenuItem onClick={() => (close(), restartAll())}>↻ {t("Restart the sessions")}</MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  editor.state.doc.descendants((n, pos) => {
                    if (n.type.name === "codeCell" && n.attrs.outputs) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, outputs: "", count: 0 }));
                    return true;
                  });
                }}
              >
                🧹 {t("Clear all outputs")}
              </MenuItem>
            </div>
          )}
        </Dropdown>
      )}

      <Dropdown label={t("Notebook")} className={MENU} wrapClassName="relative inline-block">
        {(close) => (
          <div className="w-64">
            <MenuItem
              onClick={async () => {
                close();
                const r = await exportNotebookAction(pageId, "znb");
                if (r.ok) download(r.filename, r.json, "application/json;charset=utf-8");
                else toast(r.error, { tone: "error" });
              }}
            >
              📓 {t("Export as a notebook (.znb)")}
            </MenuItem>
            <MenuItem
              onClick={async () => {
                close();
                const r = await exportNotebookAction(pageId, "ipynb");
                if (r.ok) download(r.filename, r.json, "application/json;charset=utf-8");
                else toast(r.error, { tone: "error" });
              }}
            >
              📓 {t("Export for Jupyter (.ipynb)")}
            </MenuItem>
            <MenuItem
              onClick={async () => {
                close();
                const file = await pickFile(".znb,.ipynb,application/json");
                if (!file) return;
                const r = await importNotebookAction(await file.text(), pageId);
                if (r.ok) router.push(`/workspace/${r.id}`);
                else toast(r.error, { tone: "error" });
              }}
            >
              📥 {t("Import a notebook as a sub-page")}
            </MenuItem>
          </div>
        )}
      </Dropdown>

      {/* Sticky at the right: every code cell of the page, in the order of the page. */}
      {cells > 0 && (
        <span className="ml-auto flex items-center gap-1.5">
          <span className="hidden text-xs text-zinc-500 sm:inline">{t("{n} code cells", { n: cells })}</span>
          {busy || runningAll ? (
            <>
              <span className="text-xs text-indigo-600 dark:text-indigo-300" aria-live="polite">{runningAll ? t("Running all …") : t("Running …")}</span>
              <button type="button" className="btn btn-sm h-7" onClick={stopAll} title={t("Stop")}>
                ■ {t("Stop")}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm btn-primary h-7" onClick={() => void runAll()} title={t("Run every code cell of the page, in order")}>
              ▶▶ {t("Run all")}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * Only the sticky **Run all**: a small button at the top right of the page that stays in view while you scroll, when the page has code
 * cells. It runs every code cell in the order of the page, and becomes Stop while cells run. (The full menu bar above is not used.)
 */
export function RunAllButton({ editor, pageId }: { editor: Editor; pageId: number }) {
  const t = useT();
  const [runningAll, setRunningAll] = useState(false);
  const { cells, busy } = useCellRunState(pageId);
  if (cells === 0) return null;
  const session = `page-${pageId}`;
  const stopAll = () => {
    for (const l of codeLanguages(editor)) void interruptCellAction(session, l);
  };
  const runAll = async () => {
    if (runningAll) return;
    setRunningAll(true);
    try {
      await runAllCells(pageId);
    } finally {
      setRunningAll(false);
    }
  };
  return (
    <div className="pointer-events-none sticky top-2 z-30 mb-1 flex justify-end">
      <span className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/90 px-2 py-1 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
        <span className="hidden text-xs text-zinc-500 sm:inline">{t("{n} code cells", { n: cells })}</span>
        {busy || runningAll ? (
          <>
            <span className="text-xs text-indigo-600 dark:text-indigo-300" aria-live="polite">{runningAll ? t("Running all …") : t("Running …")}</span>
            <button type="button" className="btn btn-sm h-7" onClick={stopAll} title={t("Stop")}>
              ■ {t("Stop")}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm btn-primary h-7" onClick={() => void runAll()} title={t("Run every code cell of the page, in order")}>
            ▶▶ {t("Run all")}
          </button>
        )}
      </span>
    </div>
  );
}
