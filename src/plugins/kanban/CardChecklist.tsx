"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCardTodoAction, setTodoStatusAction } from "@/plugins/todos/server-actions";
import { toast } from "@/components/Toaster";
import { dueText, dueTone } from "@/lib/boards/due-shared";
import type { CardTodo } from "./shared";

/**
 * A card's todos as a checklist — ticked off here (they're todos like any other: in the Todos tab,
 * the Lage, the agents' context), a new one added to the card; the done ones folded away.
 */
export function CardChecklist({ cardRef, todos }: { cardRef: string; todos: CardTodo[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const open = todos.filter((t) => t.status !== "done");
  const done = todos.filter((t) => t.status === "done");
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string } | null>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r?.ok) toast(r?.error ?? "Ging nicht.", { tone: "error" });
      else after?.();
      router.refresh();
    });
  const add = () => text.trim() && act(() => addCardTodoAction(cardRef, text), () => setText(""));
  const item = (t: CardTodo) => (
    <li key={t.id} className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0"
        checked={t.status === "done"}
        disabled={pending}
        onChange={(e) => act(() => setTodoStatusAction(t.id, e.target.checked ? "done" : "open"))}
        aria-label={`T-${t.id} ${t.status === "done" ? "wieder öffnen" : "erledigt"}`}
      />
      <span className={`min-w-0 flex-1 ${t.status === "done" ? "text-zinc-400 line-through" : ""}`}>
        {t.owner === "other" && t.status !== "done" && <span title="Wartet auf andere">⏳ </span>}
        {t.text}
        {t.due && t.status !== "done" && <span className={`ml-1.5 text-xs ${dueTone(t.due)}`}>{dueText(t.due)}</span>}
      </span>
      <Link href={`/t/${t.id}`} className="shrink-0 font-mono text-xs text-zinc-400 hover:text-indigo-600 hover:underline">
        T-{t.id}
      </Link>
    </li>
  );

  return (
    <section className="space-y-2">
      <h3 className="label flex items-center gap-2">
        Todos
        {todos.length > 0 && (
          <span className="font-normal normal-case">
            {done.length}/{todos.length} erledigt
          </span>
        )}
      </h3>
      {todos.length > 0 && (
        <div className="h-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(done.length / todos.length) * 100}%` }} />
        </div>
      )}
      {open.length > 0 && <ul className="space-y-1.5">{open.map(item)}</ul>}
      {done.length > 0 && (
        <div>
          <button type="button" className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            {showDone ? "▾" : "▸"} Erledigt ({done.length})
          </button>
          {showDone && <ul className="mt-1.5 space-y-1.5">{done.map(item)}</ul>}
        </div>
      )}
      <div className="flex gap-2">
        <input
          className="input"
          value={text}
          placeholder="Neues Todo zur Karte …"
          disabled={pending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-sm shrink-0" disabled={pending || !text.trim()} onClick={add}>
          Hinzufügen
        </button>
      </div>
    </section>
  );
}
