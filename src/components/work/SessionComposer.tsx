"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startSessionAction } from "@/app/actions";
import { toast } from "@/components/Toaster";

/**
 * The bar to start a session (or go on in a new one): what the worker is to do — Enter sends,
 * Shift+Enter a new line — and, for a new one, on which ticket and in which repo.
 */
export function SessionComposer({
  ticket,
  todoId,
  tickets = [],
  repos = [],
  providers = [],
  placeholder = "Was soll der Worker tun? (Enter: los, Shift+Enter: neue Zeile)",
  label = "Session starten",
}: {
  ticket?: string;
  todoId?: number;
  /** For a new session: the tickets to pick from (none: the given one, or none). */
  tickets?: { key: string; summary: string | null }[];
  repos?: { id: number; name: string }[];
  providers?: { id: string; label: string }[];
  placeholder?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [pick, setPick] = useState(ticket ?? "");
  const [repo, setRepo] = useState("");
  const [provider, setProvider] = useState("");
  const send = () =>
    text.trim() &&
    start(async () => {
      const r = await startSessionAction({ instruction: text, ticket: pick || ticket || "", todoId, repoId: repo ? Number(repo) : undefined, provider: provider || undefined });
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setText("");
      router.push(`/work?run=${r.runId}`);
    });
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <textarea
        className="block min-h-20 w-full resize-y bg-transparent px-2 py-1.5 text-sm outline-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={placeholder}
        aria-label="Anweisung"
        disabled={pending}
      />
      <div className="flex flex-wrap items-center gap-2 px-1">
        {tickets.length > 0 && (
          <select className="input w-auto max-w-56 py-1 text-xs" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Ticket">
            <option value="">Ohne Ticket</option>
            {tickets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.key}
                {t.summary ? ` · ${t.summary.slice(0, 40)}` : ""}
              </option>
            ))}
          </select>
        )}
        {repos.length > 0 && (
          <select className="input w-auto max-w-48 py-1 text-xs" value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repo">
            <option value="">Repo: wie beim Ticket</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        {providers.length > 1 && (
          <select className="input w-auto py-1 text-xs" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="CLI">
            <option value="">CLI: Standard</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-primary btn-sm ml-auto" disabled={pending || !text.trim()} onClick={send}>
          {pending ? "startet …" : label}
        </button>
      </div>
    </div>
  );
}
