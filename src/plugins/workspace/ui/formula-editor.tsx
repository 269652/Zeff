"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { checkFormula, evalFormula, formulaCompletions, formulaRefs, formulaToStored, FORMULA_SIGNATURES, type FormulaValue } from "../formula";
import { formatNumber, type Property, type Row } from "../model";
import type { CellCtx } from "./cells";
import { useDismiss } from "./kit";

/**
 * A formula cell opened: the column's formula to change (it is the whole column's), its references in colours (the same
 * colours on the columns they name in the table), the functions and properties offered as you type, what it gives for this row.
 */

/** The references' colours: the first property named the first colour … */
export const REF_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7", "#ec4899", "#84cc16"];

/** Each property a formula names with its colour (by where it is first named; names as written, lower-cased). */
export function refColors(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of formulaRefs(src)) {
    const k = r.name.toLowerCase();
    if (!(k in out)) out[k] = REF_COLORS[Object.keys(out).length % REF_COLORS.length];
  }
  return out;
}

export function FormulaEditor({ p, row, ctx, done }: { p: Property; row: Row; ctx: CellCtx; done: () => void }) {
  const t = useT();
  const schema = ctx.data.schema;
  const [src, setSrc] = useState(p.formula ?? "");
  const [caret, setCaret] = useState((p.formula ?? "").length);
  const [pick, setPick] = useState(0);
  const [closed, setClosed] = useState(true);
  // The whole list (Ctrl+Space, the button): every function and property, also with nothing typed.
  const [all, setAll] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // A click elsewhere: closed, unchanged.
  useDismiss(box, true, done);
  // Opened: the caret at the end.
  useEffect(() => {
    const n = area.current?.value.length ?? 0;
    area.current?.setSelectionRange(n, n);
  }, []);
  const names = useMemo(() => [schema.titleName, ...schema.properties.filter((q) => q.id !== p.id).map((q) => q.name)], [schema, p.id]);
  const colors = refColors(src);
  const refs = formulaRefs(src);
  const error = src.trim() ? checkFormula(src) : null;
  // What it gives for this row (the other cells as they are now).
  const preview = useMemo(() => {
    if (!src.trim() || error) return null;
    const r = evalFormula(src, {
      prop: (name) => {
        const w = name.toLowerCase();
        if (w === schema.titleName.toLowerCase() || w === "title") return row.title;
        const q = schema.properties.find((x) => x.name.toLowerCase() === w);
        if (!q) throw new Error(t("No property “{name}”", { name }));
        return row.cells[q.id];
      },
    });
    return r;
  }, [src, error, schema, row, t]);
  const offer = closed ? { from: caret, to: caret, items: [] } : formulaCompletions(src, caret, names, { all });
  const at = Math.min(pick, Math.max(0, offer.items.length - 1));

  // The cells it names (in this row — a formula reads its own row), coloured in the table while it is open.
  const show = ctx.showRefs;
  const key = JSON.stringify(colors);
  useEffect(() => {
    show?.({ rowId: row.id, colors: JSON.parse(key) as Record<string, string> });
  }, [show, key, row.id]);
  useEffect(() => () => show?.(null), [show]);

  const take = (i: number) => {
    const c = offer.items[i];
    if (!c) return;
    const next = src.slice(0, offer.from) + c.insert + src.slice(offer.to);
    const pos = offer.from + c.insert.length;
    setSrc(next);
    setCaret(pos);
    setPick(0);
    setAll(false);
    // A property's name ends it; a function's arguments come next (prop(": its names offered).
    setClosed(c.kind === "property" || c.insert !== 'prop("');
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(pos, pos);
    });
  };
  const save = () => {
    if (error || !src.trim()) return;
    if (src !== (p.formula ?? "")) ctx.setFormula?.(p.id, src);
    done();
  };

  // The text with its references marked — under the (transparent) text field, the same letters in the same places.
  const marked: React.ReactNode[] = [];
  let i = 0;
  for (const r of refs) {
    if (r.from > i) marked.push(src.slice(i, r.from));
    const c = colors[r.name.toLowerCase()];
    marked.push(
      <span key={r.from} className="rounded-sm" style={{ color: c, background: `${c}22`, boxShadow: `0 0 0 1px ${c}55` }}>
        {src.slice(r.from, r.to)}
      </span>,
    );
    i = r.to;
  }
  marked.push(src.slice(i) + "\n");
  const shown = (v: FormulaValue) => {
    const s = formulaToStored(v);
    if (typeof s === "number") return formatNumber(p, s);
    if (typeof s === "boolean") return s ? t("Yes") : t("No");
    return Array.isArray(s) ? s.join(", ") : String(s ?? "—");
  };

  return (
    <div ref={box} className="w-[26rem] max-w-full space-y-2 p-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-500">
          {t("Formula of “{name}”", { name: p.name })} · <span className="text-zinc-400">{t("for the whole column")}</span>
        </span>
        <button
          type="button"
          className={`rounded-md px-1.5 py-0.5 font-mono text-xs ${all && !closed ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
          aria-pressed={all && !closed}
          title={t("All functions and properties (Ctrl+Space)")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const open = !(all && !closed);
            setAll(open);
            setClosed(!open);
            setPick(0);
            area.current?.focus();
          }}
        >
          ƒ {t("Functions")}
        </button>
      </div>
      <div className="relative rounded-lg border border-zinc-300 bg-white focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200 dark:border-zinc-700 dark:bg-zinc-950 dark:focus-within:ring-indigo-900">
        <div ref={mirror} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden px-2.5 py-2 font-mono text-[13px] leading-5 break-words whitespace-pre-wrap text-zinc-800 dark:text-zinc-100">
          {marked}
        </div>
        <textarea
          ref={area}
          autoFocus
          rows={3}
          spellCheck={false}
          value={src}
          aria-label={t("Formula")}
          placeholder={'prop("Pro Monat") * 12'}
          className="relative block w-full resize-y bg-transparent px-2.5 py-2 font-mono text-[13px] leading-5 break-words whitespace-pre-wrap text-transparent caret-zinc-900 outline-none placeholder:text-zinc-400 dark:caret-zinc-100"
          onScroll={(e) => mirror.current && (mirror.current.scrollTop = e.currentTarget.scrollTop)}
          onChange={(e) => {
            setSrc(e.target.value);
            setCaret(e.target.selectionStart);
            setPick(0);
            setAll(false);
            setClosed(false);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (offer.items.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((at + (e.key === "ArrowDown" ? 1 : -1) + offer.items.length) % offer.items.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                take(at);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setClosed(true);
                setAll(false);
                return;
              }
            }
            if (e.key === "Escape") done();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
            if (e.key === " " && e.ctrlKey) {
              e.preventDefault();
              setAll(true);
              setClosed(false);
            }
          }}
        />
        {offer.items.length > 0 && (
          <ul className="absolute top-full left-0 z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900" role="listbox" aria-label={t("Suggestions")}>
            {offer.items.map((c, n) => (
              <li key={`${c.kind}:${c.label}`} role="option" aria-selected={n === at}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${n === at ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setPick(n)}
                  onClick={() => take(n)}
                >
                  <span className={`w-5 shrink-0 text-center font-mono text-xs ${c.kind === "function" ? "text-violet-600 dark:text-violet-400" : "text-emerald-600 dark:text-emerald-400"}`}>{c.kind === "function" ? "ƒ" : "#"}</span>
                  <span className="shrink-0 font-mono">{c.label}</span>
                  <span className="ml-auto truncate pl-2 font-mono text-[11px] text-zinc-400">{c.kind === "function" ? (FORMULA_SIGNATURES[c.label] ?? t("Function")) : t("Property")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* The references with their colours — as the columns are coloured in the table. */}
      {Object.keys(colors).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(colors).map(([name, c]) => {
            const known = name === schema.titleName.toLowerCase() || name === "title" || schema.properties.some((q) => q.name.toLowerCase() === name);
            const label = schema.properties.find((q) => q.name.toLowerCase() === name)?.name ?? (known ? schema.titleName : name);
            return (
              <span key={name} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${known ? "" : "line-through"}`} style={{ background: `${c}1f`, color: c }} title={known ? undefined : t("No property “{name}”", { name: label })}>
                <span className="size-1.5 rounded-full" style={{ background: c }} />
                {label}
              </span>
            );
          })}
        </div>
      )}
      <div className="min-h-5 text-xs">
        {error ? (
          <span className="text-red-600 dark:text-red-400">{error}</span>
        ) : preview && "error" in preview ? (
          <span className="text-red-600 dark:text-red-400">{preview.error}</span>
        ) : preview ? (
          <span className="text-zinc-500">
            {t("This row:")} <span className="font-medium text-zinc-800 tabular-nums dark:text-zinc-100">{shown(preview.value)}</span>
          </span>
        ) : (
          <span className="text-zinc-400">{t("Type a function or a property — Ctrl+Space offers them.")}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={!!error || !src.trim()} onClick={save}>
          {t("Save")}
        </button>
        <button type="button" className="btn btn-sm" onClick={done}>
          {t("Cancel")}
        </button>
        <span className="ml-auto text-[11px] text-zinc-400">{t("Enter saves · Shift+Enter a new line")}</span>
      </div>
    </div>
  );
}
