"use client";

import { useState } from "react";
import { isMe } from "@/plugins/jira-lage/pick";
import { useT } from "@/components/I18nProvider";
import type { TicketExtras } from "@/lib/items/shared";
import type { DatabaseData } from "../actions";
import { WS_CHANGED } from "./ChatPanel";
import { TodoBlock } from "@/components/todos/TodoBlock";

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

/** The card's todos: "▸ ☑ done/all" (or "+ Todo"), opened in place — the todo block (tick, change, add …). */
export function CardTodos({ k, ticket, open: initiallyOpen = false }: { k: string; ticket: TicketExtras | null; open?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(initiallyOpen);
  const list = ticket?.todos ?? [];
  const done = list.filter((x) => x.status === "done").length;
  const changed = () => window.dispatchEvent(new Event(WS_CHANGED));
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
        <div className="mt-1.5">
          <TodoBlock k={k} todos={list} onChanged={changed} compact />
        </div>
      )}
    </div>
  );
}

const ME = "zeff.jira.me";
const readMe = () => {
  try {
    return localStorage.getItem(ME) ?? "";
  } catch {
    return "";
  }
};

/**
 * "Assign to me" on a mirrored Jira board's card: the ticket assigned to you in Jira and on the card at once (POST
 * /api/workspace/jira-assign). Not shown once it's yours (who you are in Jira: learnt from the first assignment).
 */
export function AssignToMe({ rowId, assignee, jiraMe = [] }: { rowId: number; assignee: string; /** The names Zeff knows you by in Jira (server side). */ jiraMe?: string[] }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [me] = useState(readMe);
  if ((me && assignee.trim() === me) || isMe(assignee, jiraMe)) return null;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-950/50"
      disabled={busy}
      title={t("Assign this ticket to you — in Jira and here")}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        const r = await fetch("/api/workspace/jira-assign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rowId }) })
          .then((x) => x.json() as Promise<{ ok: boolean; key?: string; assignee?: string; error?: string }>)
          .catch((err: unknown) => ({ ok: false, error: String(err) }) as { ok: boolean; key?: string; assignee?: string; error?: string });
        setBusy(false);
        const { toast } = await import("@/components/Toaster");
        if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error" });
        try {
          if (r.assignee) localStorage.setItem(ME, r.assignee);
        } catch {
          // remembered next time, then
        }
        toast(t("{key} is assigned to you — in Jira too.", { key: r.key ?? "" }), { tone: "ok" });
        window.dispatchEvent(new Event(WS_CHANGED));
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {busy ? "…" : "👤"} {t("Assign to me")}
    </button>
  );
}
