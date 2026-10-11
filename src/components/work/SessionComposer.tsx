"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { startSessionAction } from "@/plugins/work/server-actions";
import { toast } from "@/components/Toaster";

/**
 * The message box, like Claude Code's: it grows with what you write, Enter sends, Shift+Enter is a
 * new line. A new session also picks its ticket, repo and CLI; in a session (`continueRunId`) your
 * message goes on with its conversation. `busy`: the worker is still answering — wait for it.
 */
export function SessionComposer({
  ticket,
  todoId,
  continueRunId,
  tickets = [],
  repos = [],
  providers = [],
  busy = null,
  placeholder = "What should we work on?",
  autoFocus = false,
}: {
  ticket?: string;
  todoId?: number;
  continueRunId?: number;
  /** For a new session: the tickets to pick from (none: the given one, or none). */
  tickets?: { key: string; summary: string | null }[];
  repos?: { id: number; name: string }[];
  providers?: { id: string; label: string }[];
  /** Why you can't send right now (the worker is answering), or null. */
  busy?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [pick, setPick] = useState(ticket ?? "");
  const [repo, setRepo] = useState("");
  const [provider, setProvider] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);
  const blocked = pending || !!busy;
  const send = () =>
    text.trim() &&
    !blocked &&
    start(async () => {
      const r = await startSessionAction({
        instruction: text,
        ticket: pick || ticket || "",
        todoId,
        continueRunId,
        repoId: repo ? Number(repo) : undefined,
        provider: provider || undefined,
      });
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setText("");
      router.push(`/work?run=${r.runId}`);
    });
  const select = "rounded-md border-0 bg-transparent py-0.5 pr-6 pl-1.5 text-xs text-zinc-500 hover:bg-zinc-100 focus:ring-1 focus:ring-indigo-400 dark:hover:bg-zinc-800";
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-2xl border border-zinc-300 bg-white shadow-sm transition focus-within:border-indigo-400 focus-within:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-indigo-500">
        <textarea
          ref={area}
          rows={1}
          className="block max-h-80 min-h-12 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-zinc-400"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={busy ?? placeholder}
          aria-label={continueRunId ? "Reply" : "Instruction"}
          disabled={pending}
          autoFocus={autoFocus}
        />
        <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2">
          {tickets.length > 0 && (
            <select className={`${select} max-w-56`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Ticket">
              <option value="">No ticket</option>
              {tickets.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key}
                  {t.summary ? ` · ${t.summary.slice(0, 40)}` : ""}
                </option>
              ))}
            </select>
          )}
          {repos.length > 0 && !continueRunId && (
            <select className={`${select} max-w-48`} value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repo">
              <option value="">Repo: the ticket&apos;s</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          {providers.length > 1 && (
            <select className={select} value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Backend">
              <option value="">{continueRunId ? "Same backend" : "Default backend"}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto hidden text-[11px] text-zinc-400 sm:inline">Enter to send · Shift+Enter for a new line</span>
          <button
            type="button"
            className="ml-2 grid size-8 place-items-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
            disabled={blocked || !text.trim()}
            onClick={send}
            aria-label="Send"
            title="Send"
          >
            {pending ? (
              <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
                <path d="M10 3.5a.75.75 0 0 1 .53.22l5 5a.75.75 0 1 1-1.06 1.06l-3.72-3.72v9.19a.75.75 0 0 1-1.5 0V6.06L5.53 9.78a.75.75 0 0 1-1.06-1.06l5-5A.75.75 0 0 1 10 3.5Z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
