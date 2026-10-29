"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/I18nProvider";
import { colLetters } from "../formula";
import { sheetRef } from "../model";
import { Dropdown, MenuItem } from "./kit";
import { cellAt } from "./table-formulas";

/**
 * A page's table (/Tabelle) while the caret is in it: at its top right the cell's address (B3, as formulas name it) and a
 * small ⋯ menu — rows and columns added or removed, the header row, the table's name for formulas (the page's other tables
 * read it as Name!A1), the table removed.
 */
export function TableTools({ editor }: { editor: Editor | null }) {
  const t = useT();
  const [at, setAt] = useState<{ top: number; right: number; addr: string; name: string } | null>(null);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const c = editor.isEditable ? cellAt(editor.state) : null;
      if (!c) return setAt(null);
      const dom = editor.view.nodeDOM(c.table.pos) as HTMLElement | null;
      const rect = dom?.getBoundingClientRect();
      if (!rect) return setAt(null);
      setAt({ top: rect.top, right: rect.right, addr: `${colLetters(c.col)}${c.row + 1}`, name: c.table.name });
    };
    editor.on("selectionUpdate", update);
    editor.on("update", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("update", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor]);
  if (!at || !editor) return null;
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => fn(editor.chain().focus()).run();
  return createPortal(
    <div className="fixed z-40 flex -translate-x-full items-center gap-1" style={{ top: Math.max(4, at.top - 30), left: at.right }} onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}>
      <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={t("This cell, as formulas name it")}>
        {at.name ? `${sheetRef(at.name)}!` : ""}
        {at.addr}
      </span>
      <Dropdown label="⋯" align="right" title={t("Table")} className="btn btn-sm px-2 py-0.5">
        {(close) => (
          <div className="w-64">
            <MenuItem onClick={() => (close(), run((c) => c.addRowBefore()))}>↑ {t("Row above")}</MenuItem>
            <MenuItem onClick={() => (close(), run((c) => c.addRowAfter()))}>↓ {t("Row below")}</MenuItem>
            <MenuItem onClick={() => (close(), run((c) => c.addColumnBefore()))}>← {t("Column left")}</MenuItem>
            <MenuItem onClick={() => (close(), run((c) => c.addColumnAfter()))}>→ {t("Column right")}</MenuItem>
            <MenuItem onClick={() => (close(), run((c) => c.toggleHeaderRow()))}>▤ {t("Header row on / off")}</MenuItem>
            <MenuItem onClick={() => (close(), run((c) => c.deleteRow()))}>✕ {t("Remove the row")}</MenuItem>
            <MenuItem onClick={() => (close(), run((c) => c.deleteColumn()))}>✕ {t("Remove the column")}</MenuItem>
            <div className="my-1 border-t border-zinc-100 px-2 pt-2 dark:border-zinc-800">
              <label className="block space-y-1 text-xs">
                <span className="font-medium">{t("Its name in formulas")}</span>
                <input
                  className="input w-full text-sm"
                  defaultValue={at.name}
                  placeholder={t("e.g. Kosten")}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const name = e.currentTarget.value.replace(/[^\p{L}\p{N}_ -]+/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
                    close();
                    run((c) => c.updateAttributes("table", { name }));
                  }}
                />
                <span className="block text-zinc-500">{t("Enter to keep. The page's other tables then read it as Name!A1, SUMME(Name!B:B).")}</span>
              </label>
            </div>
            <MenuItem danger onClick={() => (close(), run((c) => c.deleteTable()))}>
              🗑 {t("Remove the table")}
            </MenuItem>
          </div>
        )}
      </Dropdown>
    </div>,
    document.body,
  );
}
