"use client";

import { InputRule, mergeAttributes, Node, type EditorEvents } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { mentionSearchAction, type MentionItem } from "../actions";
import { sheetRef } from "../model";
import { loadNames, mentionInsert, mentionQuery, metricRef, type Names } from "./sheet";
import { evalInline, tableFormulasKey } from "./table-formulas";

/**
 * A formula in running text ({=Datum(@Schuldenfrei in)}): a chip with its value in the line; a click on it (or "{=" typed, or
 * /Formel) opens it to write — with the functions, Kennzahlen, people and tables offered as you type, its value beside.
 * Selected, Backspace removes it (a failing one too); ✕ while writing does as well. In Markdown it is {=…}.
 */

// A formula just put in opens to be written (the node view that mounts next takes it).
let openNext = false;
// What is typed between "{=" and its box taking the focus (the node view mounts a moment later): kept for the box, not
// written into the page — so "{=1+2" typed fast arrives whole. null: no box on its way.
let typedAhead: string | null = null;
let aheadTimer: ReturnType<typeof setTimeout> | null = null;
export const openNextFormula = () => {
  openNext = true;
  typedAhead = "";
  if (aheadTimer) clearTimeout(aheadTimer);
  aheadTimer = setTimeout(() => (typedAhead = null), 3000);
};
/** What was typed ahead for the box now open (once). */
const takeTypedAhead = (): string => {
  const s = typedAhead ?? "";
  typedAhead = null;
  return s;
};

type Suggestion = { key: string; icon: string; label: string; hint: string; insert: string };

/** The functions as they are written here (German names first, as the help says them), with what each does. */
const BUILTINS: { name: string; sig: string; what: string }[] = [
  { name: "Datum", sig: "Datum(127 Monate)", what: "The day a duration from today ends — or a date as it is" },
  { name: "Heute", sig: "Heute()", what: "Today" },
  { name: "Summe", sig: "Summe(…)", what: "The sum" },
  { name: "Mittelwert", sig: "Mittelwert(…)", what: "The mean" },
  { name: "Min", sig: "Min(…)", what: "The smallest" },
  { name: "Max", sig: "Max(…)", what: "The largest" },
  { name: "Runden", sig: "Runden(Zahl; Stellen)", what: "Rounded" },
  { name: "Wenn", sig: "Wenn(Bedingung; dann; sonst)", what: "One value or the other" },
  { name: "Anzahl", sig: "Anzahl(…)", what: "How many numbers" },
  { name: "Jahr", sig: "Jahr(Datum)", what: "The year of a date" },
  { name: "Monat", sig: "Monat(Datum)", what: "The month of a date" },
  { name: "Tag", sig: "Tag(Datum)", what: "The day of a date" },
  { name: "dateBetween", sig: 'dateBetween(Datum; Datum; "days")', what: "The time between two dates" },
  { name: "formatDate", sig: 'formatDate(Datum; "DD.MM.YYYY")', what: "A date written as you like" },
];

function InlineFormulaView({ node, updateAttributes, deleteNode, editor, selected, getPos }: NodeViewProps) {
  const t = useT();
  const src = String(node.attrs.src ?? "");
  const [editing, setEditing] = useState(() => {
    const open = openNext;
    openNext = false;
    return open;
  });
  const [draft, setDraft] = useState(src);
  // Worked out again when the page changes or what the server knows comes in (Kennzahlen, a plugin's function).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = ({ transaction }: EditorEvents["transaction"]) => {
      if (transaction.docChanged || transaction.getMeta(tableFormulasKey)) setTick((x) => x + 1);
    };
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor]);
  const live = editing ? draft : src;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick: the page or the server's data changed
  const res = useMemo(() => evalInline(editor, live), [editor, live, tick]);

  const after = () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos !== undefined) editor.chain().focus().setTextSelection(pos + node.nodeSize).run();
  };
  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next) return deleteNode();
    if (next !== src) updateAttributes({ src: next });
    after();
  };
  const cancel = () => {
    setEditing(false);
    setDraft(src);
    if (!src.trim()) return deleteNode();
    after();
  };
  const open = () => {
    if (!editor.isEditable) return;
    setDraft(src);
    setEditing(true);
  };

  return (
    <NodeViewWrapper as="span" className="relative">
      <span
        className={`ws-iformula-value ${res.error ? "is-error" : ""} ${res.warned ? "has-warning" : ""} ${selected || editing ? "is-selected" : ""}`}
        title={[`=${src}`, res.error, ...(res.warnings ?? [])].filter(Boolean).join("\n")}
        onMouseDown={(e) => {
          if (!editor.isEditable) return;
          e.preventDefault();
          open();
        }}
      >
        {src ? res.shown || " " : "="}
      </span>
      {editing && <FormulaPopover draft={draft} setDraft={setDraft} res={res} commit={commit} cancel={cancel} remove={() => (setEditing(false), deleteNode())} t={t} />}
    </NodeViewWrapper>
  );
}

function FormulaPopover({ draft, setDraft, res, commit, cancel, remove, t }: { draft: string; setDraft: (s: string) => void; res: ReturnType<typeof evalInline>; commit: () => void; cancel: () => void; remove: () => void; t: ReturnType<typeof useT> }) {
  const input = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(draft.length);
  const [names, setNames] = useState<Names | null>(null);
  const [found, setFound] = useState<MentionItem[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    void loadNames().then(setNames);
    const ahead = takeTypedAhead();
    const text = draft + ahead;
    if (ahead) {
      setDraft(text);
      setCaret(text.length);
    }
    const el = input.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(text.length, text.length));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when it opens
  }, []);

  const before = draft.slice(0, caret);
  const at = mentionQuery(before, true);
  // After an @: Kennzahlen, people, circles (as the @ menu has them).
  useEffect(() => {
    if (!at) return setFound([]);
    let alive = true;
    const timer = setTimeout(() => void mentionSearchAction(at.q).then((r) => alive && setFound(r.filter((x) => ["metric", "person", "circle"].includes(x.kind))), () => alive && setFound([])), 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [at?.q, at === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: (Suggestion & { from: number })[] = useMemo(() => {
    if (at) return found.slice(0, 10).map((it) => ({ key: `${it.kind}:${it.ref}`, icon: it.icon, label: it.label, hint: it.hint, insert: mentionInsert(it, true), from: at.at }));
    const word = /(^|[^\p{L}\p{N}_@[\]!])([\p{L}_][\p{L}\p{N}_]*)$/u.exec(before);
    const q = word?.[2] ?? "";
    // Nothing begun: the whole list where a value can go (at the start, after "(", an operator, a ";").
    if (!word && !/(^|[(;,+\-*/<>=&\s])$/.test(before)) return [];
    const w = q.toLowerCase();
    const hit = (s: string) => !w || s.toLowerCase().startsWith(w) || s.toLowerCase().includes(w);
    const from = caret - q.length;
    const fns: (Suggestion & { from: number })[] = [
      ...BUILTINS.filter((f) => hit(f.name)).map((f) => ({ key: `f:${f.name}`, icon: "ƒ", label: f.sig, hint: t(f.what), insert: `${f.name}(`, from })),
      ...(names?.functions ?? []).filter((f) => hit(f.name)).map((f) => ({ key: `p:${f.name}`, icon: "ƒ", label: f.signature, hint: `${f.what}${f.unit ? ` (${f.unit})` : ""}`, insert: `${f.name}(`, from })),
    ];
    const metrics = (names?.metrics ?? []).filter(hit).map((m) => ({ key: `m:${m}`, icon: "📊", label: `@${m}`, hint: t("Kennzahl"), insert: metricRef(m), from }));
    const tables = (names?.tables ?? []).filter((x) => hit(x.name)).map((x) => ({ key: `s:${x.name}`, icon: "▦", label: `${sheetRef(x.name)}!A1`, hint: x.title, insert: `${sheetRef(x.name)}!`, from }));
    return [...fns, ...metrics, ...tables].slice(0, 12);
  }, [at, found, before, caret, names, t]);
  useEffect(() => setActive(0), [items.length, before]);

  const pick = (s: Suggestion & { from: number }) => {
    const next = `${draft.slice(0, s.from)}${s.insert}${draft.slice(caret)}`;
    const pos = s.from + s.insert.length;
    setDraft(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
    });
  };
  const sync = () => setCaret(input.current?.selectionStart ?? draft.length);

  return (
    <span contentEditable={false} className="absolute top-full left-0 z-40 mt-1 block w-[28rem] max-w-[90vw] rounded-xl border border-zinc-200 bg-white p-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900" onMouseDown={(e) => e.target !== input.current && e.preventDefault()}>
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-zinc-400">=</span>
        <input
          ref={input}
          className="input min-w-0 flex-1 py-1 font-mono text-sm"
          value={draft}
          placeholder={t("Datum(@Schuldenfrei in), @Kennzahl * 12 …")}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={sync}
          onClick={sync}
          onBlur={commit}
          onKeyDown={(e) => {
            if (items.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
            } else if (items.length && (e.key === "Tab" || (e.key === "Enter" && (at || /[\p{L}_]$/u.test(before))))) {
              e.preventDefault();
              pick(items[active] ?? items[0]);
            } else if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            } else if (e.key === "Backspace" && !draft) {
              e.preventDefault();
              remove();
            }
          }}
        />
        <button type="button" className="grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800" title={t("Remove the formula")} aria-label={t("Remove the formula")} onClick={remove}>
          ✕
        </button>
      </span>
      {/* Its value as it is written. */}
      <span className={`mt-1 block px-1 text-xs ${res.error ? "text-red-600" : res.warned ? "text-amber-600" : "text-zinc-500"}`}>
        {draft.trim() ? `= ${res.shown}${res.warnings?.length ? ` — ${res.warnings.join("; ")}` : ""}` : t("Functions, @Kennzahlen, people and tables are offered as you type. Enter keeps it, Esc goes back.")}
      </span>
      {items.length > 0 && (
        <span role="listbox" className="mt-1 block max-h-64 overflow-y-auto border-t border-zinc-100 pt-1 dark:border-zinc-800">
          {items.map((s, i) => (
            <button key={s.key} type="button" role="option" aria-selected={i === active} className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left ${i === active ? "bg-zinc-100 dark:bg-zinc-800" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => pick(s)}>
              <span className="w-4 shrink-0 text-center text-zinc-500">{s.icon}</span>
              <span className="min-w-0 truncate font-mono text-[13px]">{s.label}</span>
              <span className="ml-auto min-w-0 shrink truncate text-xs text-zinc-500">{s.hint}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export const InlineFormula = Node.create({
  name: "inlineFormula",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { src: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-src") ?? "", renderHTML: (a: { src?: string }) => ({ "data-src": a.src ?? "" }) } };
  },
  parseHTML() {
    return [{ tag: "span[data-inline-formula]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-inline-formula": "" }), `{=${String(node.attrs.src ?? "")}}`];
  },
  renderText({ node }) {
    return `{=${String(node.attrs.src ?? "")}}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(InlineFormulaView);
  },
  addProseMirrorPlugins() {
    // Typed while the box is on its way: into the box, not the page.
    return [
      new Plugin({
        key: new PluginKey("inlineFormulaTypeAhead"),
        props: {
          handleTextInput: (_view, _from, _to, text) => {
            if (typedAhead === null) return false;
            typedAhead += text;
            return true;
          },
        },
      }),
    ];
  },
  addInputRules() {
    // "{=" or "{{" typed: a formula, open to be written (it is one piece — nothing to close).
    return [
      new InputRule({
        find: /\{[={]$/,
        handler: ({ state, range }) => {
          openNextFormula();
          state.tr.replaceWith(range.from, range.to, this.type.create({ src: "" }));
        },
      }),
    ];
  },
});
