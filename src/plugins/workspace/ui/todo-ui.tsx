"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { autoHideTitlesAction } from "../actions";
import { Dropdown, MenuItem } from "./kit";

/**
 * The one look of a to-do list, wherever it is: a list block in a page, a list shown in another page, a database with its Todo view. The
 * pieces - the box, the date, the head (title, count, Todo-engine mark, "…" menu), the add line, the grouped rows - are used by all three,
 * so they cannot drift apart.
 */

export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function TodoCheck({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <input type="checkbox" className="ws-todo-check" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} contentEditable={false} />;
}

/** A due date: red when it is past and the item is open; quiet (shown on hover) while there is none. */
export function TodoDue({ value, onChange, disabled, done, label }: { value: string | null | undefined; onChange: (v: string | null) => void; disabled?: boolean; done?: boolean; label: string }) {
  const late = !!value && !done && value < todayIso();
  return (
    <input
      type="date"
      className={`ws-todo-due ${late ? "is-late" : ""} ${value ? "" : "is-empty"}`}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={label}
      contentEditable={false}
    />
  );
}

// ---------------------------------------------------------------------------
// The head that hides: out of the way until the list is clicked
// ---------------------------------------------------------------------------

let autoHide: boolean | null = null;
const watchers = new Set<() => void>();

/** The setting "Hide titles automatically" (on unless switched off), shared by every list on the page. */
export function useAutoHideTitles(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(autoHide ?? true);
  useEffect(() => {
    const sync = () => setValue(autoHide ?? true);
    watchers.add(sync);
    if (autoHide === null)
      void autoHideTitlesAction().then((r) => {
        if (!r.ok) return;
        autoHide = r.value;
        watchers.forEach((w) => w());
      });
    return () => void watchers.delete(sync);
  }, []);
  return [
    value,
    (v) => {
      autoHide = v;
      watchers.forEach((w) => w());
      void autoHideTitlesAction(v);
    },
  ];
}

/**
 * Whether a list shows its head: always, or - with "Hide titles automatically" - only after a click on the list, until a click elsewhere or
 * the head's own "hide". `frame` goes on the element around the list (a click inside it, a menu of its head included, counts as inside).
 */
export function useCollapsibleHead() {
  const [auto] = useAutoHideTitles();
  const [open, setOpen] = useState(false);
  const inside = useRef(false);
  useEffect(() => {
    if (!open) return;
    inside.current = false;
    const down = () => {
      if (!inside.current) setOpen(false);
      inside.current = false;
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);
  return {
    visible: !auto || open,
    hide: auto ? () => setOpen(false) : undefined,
    frame: {
      onMouseDownCapture: () => void (inside.current = true),
      onFocus: () => setOpen(true),
      onClick: () => setOpen(true),
    },
  };
}

/** The head of a list: ☑, its title (typed, or a link to where the list lives), how many are done, whether it feeds the Todo engine, a menu. */
export function TodoHeader({
  title,
  onTitle,
  href,
  placeholder,
  done,
  total,
  engine,
  disabled,
  menu,
  onHide,
}: {
  /** null: no title (the database it is in has one). */
  title: string | null;
  onTitle?: (v: string) => void;
  href?: string;
  placeholder: string;
  done: number;
  total: number;
  engine: boolean;
  disabled?: boolean;
  /** The items of the "…" menu (given the way to close it); none: no menu. */
  menu?: (close: () => void) => ReactNode;
  /** Set when the head can be put away again (the setting "Hide titles automatically" is on). */
  onHide?: () => void;
}) {
  const t = useT();
  const [auto, setAuto] = useAutoHideTitles();
  return (
    <div className="ws-todo-head" contentEditable={false}>
      <span aria-hidden>☑</span>
      {title === null ? (
        <span className="flex-1" />
      ) : href ? (
        <Link href={href} className="ws-todo-title-link" title={title}>
          {title || placeholder}
        </Link>
      ) : (
        <input className="ws-todo-title" value={title} placeholder={placeholder} aria-label={t("Title of the list")} disabled={disabled || !onTitle} onChange={(e) => onTitle?.(e.target.value)} />
      )}
      <span className="ws-todo-count" title={t("{done} of {n} done", { done, n: total })}>
        {done}/{total}
      </span>
      {engine && (
        <span className="ws-tag" title={t("Its open items are todos of the Todo engine")}>
          ✓ {t("Todos")}
        </span>
      )}
      {onHide && (
        <button
          type="button"
          className="icon-btn"
          title={t("Hide the title")}
          aria-label={t("Hide the title")}
          onClick={(e) => {
            e.stopPropagation();
            onHide();
          }}
        >
          ▴
        </button>
      )}
      {menu && !disabled && (
        <Dropdown label="…" align="right" title={t("List settings")} className="icon-btn">
          {(close) => (
            <>
              {menu(close)}
              <MenuItem onClick={() => (close(), setAuto(!auto))}>
                {auto ? "☑" : "☐"} {t("Hide titles automatically")}
              </MenuItem>
            </>
          )}
        </Dropdown>
      )}
    </div>
  );
}

export function TodoAddLine({ onAdd, disabled }: { onAdd: (text: string) => void; disabled?: boolean }) {
  const t = useT();
  const [text, setText] = useState("");
  if (disabled) return null;
  return (
    <input
      className="ws-todo-add"
      value={text}
      placeholder={t("+ Add a todo")}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || !text.trim()) return;
        const v = text.trim();
        setText("");
        onAdd(v);
      }}
      aria-label={t("Add a todo")}
    />
  );
}

export type TodoItemData = { id: string | number; text: string; done: boolean; due?: string | null; depth?: number };

/**
 * The rows of a list as React (a list shown in another page, a database): each with its box, its text (written in place), its date. `grouped`:
 * by what is due - overdue, today, later, no date - with the done ones folded below; else in the order they have.
 */
export function TodoList({
  items,
  grouped,
  withDue,
  disabled,
  onCheck,
  onText,
  onDue,
  onOpen,
  onRemove,
  empty,
}: {
  items: TodoItemData[];
  grouped?: boolean;
  withDue?: boolean;
  disabled?: boolean;
  onCheck: (id: TodoItemData["id"], done: boolean) => void;
  onText: (id: TodoItemData["id"], text: string) => void;
  onDue?: (id: TodoItemData["id"], due: string | null) => void;
  onOpen?: (id: TodoItemData["id"]) => void;
  onRemove?: (id: TodoItemData["id"]) => void;
  empty?: string;
}) {
  const t = useT();
  const [showDone, setShowDone] = useState(false);
  const today = todayIso();

  const row = (i: TodoItemData) => (
    <li key={i.id} className="ws-todo-row" data-checked={i.done} style={i.depth ? { marginLeft: `${i.depth * 1.25}rem` } : undefined}>
      <TodoCheck checked={i.done} disabled={disabled} onChange={(v) => onCheck(i.id, v)} label={i.text || t("Untitled")} />
      <input
        className="ws-todo-text ws-todo-text-input"
        defaultValue={i.text}
        key={`${i.id}:${i.text}`}
        disabled={disabled}
        placeholder={t("Untitled")}
        onBlur={(e) => e.target.value.trim() !== i.text && onText(i.id, e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label={t("Todo")}
      />
      {withDue && onDue && <TodoDue value={i.due} done={i.done} disabled={disabled} onChange={(v) => onDue(i.id, v)} label={t("Due")} />}
      {onOpen && (
        <button type="button" className="icon-btn ws-todo-hover" title={t("Open")} aria-label={t("Open")} onClick={() => onOpen(i.id)}>
          ↗
        </button>
      )}
      {onRemove && !disabled && (
        <button type="button" className="icon-btn ws-todo-hover" title={t("Remove")} aria-label={t("Remove")} onClick={() => onRemove(i.id)}>
          ✕
        </button>
      )}
    </li>
  );

  if (!grouped) return <ul className="ws-todo-items">{items.map(row)}</ul>;

  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const byDue = (list: TodoItemData[]) => [...list].sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));
  const groups = [
    { key: "overdue", label: t("Overdue"), tone: "is-late", rows: open.filter((i) => !!i.due && i.due < today) },
    { key: "today", label: t("Today"), tone: "", rows: open.filter((i) => i.due === today) },
    { key: "later", label: t("Later"), tone: "", rows: open.filter((i) => !!i.due && i.due > today) },
    { key: "none", label: withDue ? t("No date") : "", tone: "", rows: open.filter((i) => !i.due) },
  ];
  return (
    <div className="space-y-2">
      {groups.map(
        (g) =>
          g.rows.length > 0 && (
            <section key={g.key}>
              {g.label && (
                <h4 className={`ws-todo-group ${g.tone}`}>
                  {g.label} · {g.rows.length}
                </h4>
              )}
              <ul className="ws-todo-items">{byDue(g.rows).map(row)}</ul>
            </section>
          ),
      )}
      {open.length === 0 && <p className="px-1 text-sm text-zinc-500">{items.length ? t("Everything is done. 🎉") : (empty ?? t("Nothing here yet."))}</p>}
      {done.length > 0 && (
        <section>
          <button type="button" className="ws-todo-group hover:underline" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            {showDone ? "▾" : "▸"} {t("Done")} · {done.length}
          </button>
          {showDone && <ul className="ws-todo-items">{done.map(row)}</ul>}
        </section>
      )}
    </div>
  );
}
