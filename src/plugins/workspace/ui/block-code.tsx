"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/I18nProvider";
import type { ActionMeta, PartMeta } from "../view-template";

/**
 * A block's code in a drawer at the window's right edge (the </> of its bar; on a phone a sheet from below): the view language in the
 * editor of VS Code — completion, its mistakes at their lines — while the block, marked on the page beside it, shows what is typed
 * (the page keeps the saved code until Save). Ctrl+S saves, Escape leaves. `scope` says what saving changes (only this block, or every page that uses the block).
 */

const TemplateEditor = dynamic(() => import("./template-editor").then((m) => m.TemplateEditor), { ssr: false, loading: () => <div className="h-72 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" /> });

export function BlockCode({
  value,
  saved,
  onChange,
  onSave,
  onClose,
  onReset,
  errors,
  scope,
  parts = [],
  actions = [],
  extra,
  title,
}: {
  /** What is being changed (the block's name), at the drawer's top. */
  title?: string;
  /** What is typed (the block shows it). */
  value: string;
  /** What is saved (Save does nothing while they are the same). */
  saved: string;
  onChange: (v: string) => void;
  /** Saves; a text: why it could not. */
  onSave: (v: string) => Promise<string | null> | string | null;
  onClose: () => void;
  /** Back to the code as it comes (a widget's template) — none: no such button. */
  onReset?: () => void;
  errors: { line: number; message: string }[];
  scope: string;
  parts?: PartMeta[];
  actions?: ActionMeta[];
  /** More on the bar (a link to the Studio). */
  extra?: React.ReactNode;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = value !== saved;
  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    const r = await onSave(value);
    setBusy(false);
    setProblem(r);
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <section
      className="ws-block-code fixed inset-x-0 bottom-0 z-50 flex h-[70vh] flex-col overflow-hidden border-t border-zinc-200 bg-white shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:h-auto sm:w-[min(40rem,50vw)] sm:border-t-0 sm:border-l dark:border-zinc-700 dark:bg-zinc-900"
      aria-label={t("Code")}
      data-no-pick
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      {title && <h2 className="truncate border-b border-zinc-200 px-3 pt-2 pb-1 text-sm font-semibold dark:border-zinc-800">{title}</h2>}
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
        <span className="font-mono font-semibold text-indigo-700 dark:text-indigo-300">&lt;/&gt;</span>
        <span className="font-medium text-zinc-700 dark:text-zinc-200">{t("View language")}</span>
        <span className="min-w-0 flex-1 truncate text-zinc-500">{scope}</span>
        {errors.length > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t("{n} mistakes", { n: errors.length })}</span>
        ) : (
          dirty && <span className="text-zinc-400">{t("Shown on the page as you type")}</span>
        )}
        {extra}
        {onReset && (
          <button type="button" className="rounded px-2 py-0.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-700 dark:hover:text-zinc-100" onClick={onReset}>
            {t("As it comes")}
          </button>
        )}
        <button type="button" className="rounded px-2 py-0.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-700 dark:hover:text-zinc-100" onClick={onClose}>
          {dirty ? t("Cancel") : t("Close")}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} title="Ctrl+S" onClick={() => void save()}>
          {busy ? "…" : t("Save")}
        </button>
      </header>
      {problem && <p className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{problem}</p>}
      <div className="min-h-0 flex-1">
        <TemplateEditor value={value} onChange={onChange} errors={errors} fields={[]} parts={parts} actions={actions} onSave={() => void save()} height="100%" />
      </div>
      {errors.length > 0 && (
        <ul className="max-h-28 overflow-y-auto border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {errors.slice(0, 20).map((e, i) => (
            <li key={i}>
              {t("line {n}", { n: e.line })}: {e.message}
            </li>
          ))}
        </ul>
      )}
    </section>,
    document.body,
  );
}
