"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import type { TicketExtras } from "@/lib/items/shared";
import { addCardTodoAction, setTodoStatusAction } from "@/plugins/todos/server-actions";
import type { DatabaseData } from "../actions";
import { WS_CHANGED } from "./ChatPanel";

/**
 * What a card shows beyond its cells, as Kanban's cards did: its ticket key (KB-…, WS-…), what the
 * Lage says (the lead; the attention is the card's stripe), its subtasks, and its todos — a checklist
 * to tick and add to right on the card.
 */

export type CardExtrasData = { key: string | null; ticket: TicketExtras | null; subtasks: { done: number; total: number } | null };

export const extrasOf = (data: DatabaseData, rowId: number): CardExtrasData => {
  const key = data.extras?.keys[rowId] ?? null;
  return { key, ticket: key ? (data.extras?.tickets[key] ?? null) : null, subtasks: data.extras?.subtasks[rowId] ?? null };
};

/** The key, small and quiet, top right of the title. */
export function CardKey({ k }: { k: string | null }) {
  return k ? <span className="shrink-0 font-mono text-[11px] text-zinc-400">{k}</span> : null;
}

/** The Lage's one line about the card. */
export function CardLead({ ticket }: { ticket: TicketExtras | null }) {
  return ticket?.lead ? (
    <p className="text-xs text-zinc-500 dark:text-zinc-400" title={ticket.attentionLabel ?? undefined}>
      {ticket.lead}
    </p>
  ) : null;
}

/** "⧉ done/total" — its subtasks, green when all are done. */
export function SubtaskBadge({ s }: { s: { done: number; total: number } | null }) {
  const t = useT();
  if (!s?.total) return null;
  return (
    <span className={`ws-chip ${s.done === s.total ? "text-emerald-700 dark:text-emerald-300" : ""}`} title={t("Subtasks")}>
      ⧉ {s.done}/{s.total}
    </span>
  );
}

/** The card's todos: "▸ ☑ done/all" (or "+ Todo"), opened in place — tick, and add one with Enter. */
export function CardTodos({ k, ticket, open: initiallyOpen = false }: { k: string; ticket: TicketExtras | null; open?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(initiallyOpen);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const list = ticket?.todos ?? [];
  const done = list.filter((x) => x.status === "done").length;
  const changed = () => window.dispatchEvent(new Event(WS_CHANGED));
  const tick = (id: number, on: boolean) =>
    start(async () => {
      const r = await setTodoStatusAction(id, on ? "done" : "open");
      if (r?.error) toast(r.error, { tone: "error" });
      changed();
    });
  const add = () => {
    const v = text.trim();
    if (!v) return;
    start(async () => {
      const r = await addCardTodoAction(k, v);
      if (r?.error) toast(r.error, { tone: "error" });
      else setText("");
      changed();
    });
  };
  return (
    <div className="mt-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${list.length && done === list.length ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"}`}
        title={t("{open} open, {done} done — click to expand", { open: list.length - done, done })}
      >
        {open ? "▾" : "▸"} {list.length ? `☑ ${done}/${list.length}` : t("+ Todo")}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1">
          {list.map((x) => (
            <li key={x.id} className="flex items-start gap-1.5 text-xs">
              <input type="checkbox" className="mt-0.5 size-3.5 shrink-0" checked={x.status === "done"} disabled={pending} onChange={(e) => tick(x.id, e.target.checked)} aria-label={x.status === "done" ? t("T-{id} reopen", { id: x.id }) : t("T-{id} done", { id: x.id })} />
              <span className={`min-w-0 flex-1 break-words ${x.status === "done" ? "text-zinc-400 line-through" : ""}`}>{x.text}</span>
            </li>
          ))}
          <li>
            <input
              className="input py-1 text-xs"
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
              aria-label={t("New todo for the card")}
            />
          </li>
        </ul>
      )}
    </div>
  );
}
