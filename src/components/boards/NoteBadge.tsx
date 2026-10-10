"use client";

import { useTransition } from "react";
import { removeTodoNoteAction } from "@/plugins/todos/server-actions";
import type { TodoUserNote } from "@/lib/boards/shared";
import { NoteIcon, SparkIcon } from "../icons";
import { toast } from "../Toaster";
import { TodoRefs } from "./TodoRefs";

const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** A note on a todo as a badge, like a comment: a run's report (✨, violet) or yours (💬); ↗ opens what it links to. */
export function NoteBadge({ n, className = "" }: { n: TodoUserNote; className?: string }) {
  const ai = !!n.by;
  const tone = ai
    ? "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100"
    : "border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100";
  return (
    <div className={`flex min-w-0 items-stretch overflow-hidden rounded-md border text-xs ${tone} ${className}`}>
      <span className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-1.5">
        {ai || n.kind === "instruction" ? <SparkIcon className={`size-4 shrink-0 ${ai ? "text-violet-600 dark:text-violet-400" : "text-indigo-600 dark:text-indigo-400"}`} /> : <NoteIcon className="size-4 shrink-0 text-indigo-600 dark:text-indigo-400" />}
        <span className="shrink-0 font-medium">{n.by ?? (n.kind === "instruction" ? `Deine Anweisung${n.run ? ` → W-${n.run}` : ""}` : "Deine Notiz")}</span>
        {n.from && <span className="shrink-0 font-mono opacity-70">an T-{n.from}</span>}
        <span className="shrink-0 opacity-70">{when(n.at)}</span>
        <span className="min-w-0 truncate opacity-80">
          <TodoRefs text={n.text.replace(/\s+/g, " ")} />
        </span>
      </span>
      {n.url && (
        <a href={n.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center px-2 hover:bg-violet-100 dark:hover:bg-violet-950" title={n.urlLabel ?? "Öffnen"} aria-label="Öffnen">
          ↗
        </a>
      )}
    </div>
  );
}

/** A note in full, as a card: what it says, who and when, where it links — yours can go. */
export function NoteDetails({ n, todoId }: { n: TodoUserNote; todoId?: number }) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          {n.by ? `Bericht von ${n.by}` : n.kind === "instruction" ? `Deine Anweisung${n.run ? ` an W-${n.run}` : ""}` : "Deine Notiz"} · {when(n.at)}
          {n.from && (
            <>
              {" · an "}
              <TodoRefs text={`T-${n.from}`} />
            </>
          )}
        </span>
        {todoId !== undefined && (
          <button
            type="button"
            className="font-medium text-zinc-500 hover:text-red-600 disabled:opacity-40"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await removeTodoNoteAction(todoId, n.at);
                if (!r?.ok) toast(r?.error ?? "Ging nicht.", { tone: "error" });
              })
            }
          >
            Entfernen
          </button>
        )}
      </div>
      <p className="leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">
        <TodoRefs text={n.text} />
      </p>
      {n.url && (
        <a href={n.url} target="_blank" rel="noreferrer" className="block font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          {n.urlLabel ?? n.url} ↗
        </a>
      )}
    </div>
  );
}
