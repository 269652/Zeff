"use client";

import { useState, useTransition } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { DateField } from "@/components/DateField";
import type { ExtraTodo } from "@/lib/items/shared";
import { setTodoStatusConfirmed } from "@/components/boards/todo-status";
import { addCardTodoAction, setTodoDueAction, setTodoStatusAction, setTodoTextAction } from "@/plugins/todos/server-actions";
import { TodoCheck } from "@/components/TodoCheck";

/**
 * The todos of a ticket, a card, a row — the one block that shows them everywhere (a card's checklist, a row's panel, a
 * page's /Todos): ticked, their text changed in place (a click on it), a due date, dismissed, opened, a new one added.
 */
export function TodoBlock({ k, todos, onChanged, compact = false }: { k: string; todos: ExtraTodo[]; onChanged?: () => void; compact?: boolean }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const size = compact ? "text-xs" : "text-sm";
  const act = (fn: () => Promise<{ ok?: boolean; error?: string; cancelled?: boolean } | null | undefined>) =>
    start(async () => {
      const r = await fn();
      if (r && r.ok === false && !r.cancelled) toast(r.error ?? t("Failed."), { tone: "error" });
      onChanged?.();
    });
  const save = (id: number) => {
    const v = draft.trim();
    setEditing(null);
    if (!v || v === todos.find((x) => x.id === id)?.text) return;
    act(() => setTodoTextAction(id, v));
  };
  const add = () => {
    const v = text.trim();
    if (!v) return;
    act(async () => {
      const r = await addCardTodoAction(k, v);
      if (r?.ok !== false) setText("");
      return r;
    });
  };
  return (
    <ul className={`space-y-1 ${size}`} data-todo-block onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {todos.map((x) => (
        <li key={x.id} className="group/todo flex items-start gap-1.5">
          <TodoCheck className="mt-0.5 size-3.5 shrink-0" checked={x.status === "done"} disabled={pending} onChange={(v) => act(() => setTodoStatusConfirmed(x.id, v ? "done" : "open"))} label={x.text} />
          {editing === x.id ? (
            <input
              autoFocus
              className={`input min-w-0 flex-1 py-0.5 ${size}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => save(x.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.preventDefault(), save(x.id));
                else if (e.key === "Escape") setEditing(null);
              }}
              aria-label={t("Todo text")}
            />
          ) : (
            <button type="button" className={`min-w-0 flex-1 cursor-text text-left break-words ${x.status === "done" ? "text-zinc-400 line-through" : ""}`} title={t("Click to change")} onClick={() => (setEditing(x.id), setDraft(x.text))}>
              {x.owner === "other" && <span className="mr-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t("waiting")}</span>}
              {x.text}
            </button>
          )}
          {/* Its due date: shown when set, else on hover — a date picker. */}
          <label className={`shrink-0 text-[11px] ${x.due ? "text-rose-600 dark:text-rose-400" : "invisible text-zinc-400 group-hover/todo:visible"}`} title={t("Due")}>
            {x.due ? x.due.slice(5).split("-").reverse().join(".") : "📅"}
            <DateField className="sr-only" value={x.due} onCommit={(v) => act(() => setTodoDueAction(x.id, v))} aria-label={t("Due")} />
          </label>
          <a href={`/t/${x.id}`} className="invisible shrink-0 text-[11px] text-zinc-400 group-hover/todo:visible hover:text-zinc-700" title={t("Open the todo")}>
            T-{x.id}
          </a>
          <button
            type="button"
            className="invisible shrink-0 text-[11px] text-zinc-400 group-hover/todo:visible hover:text-rose-600"
            title={t("Dismiss")}
            aria-label={t("Dismiss")}
            onClick={() => confirmAction(t("Dismiss “{text}”?", { text: x.text })) && act(() => setTodoStatusAction(x.id, "dismissed"))}
          >
            ✕
          </button>
        </li>
      ))}
      <li>
        <input
          className={`input py-1 ${size}`}
          value={text}
          disabled={pending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t("+ Todo (Enter)")}
          aria-label={t("New todo")}
        />
      </li>
    </ul>
  );
}
