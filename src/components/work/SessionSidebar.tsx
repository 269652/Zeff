"use client";

import Link from "next/link";
import { useState } from "react";
import type { SessionTicket } from "@/lib/work/sessions";
import { WORK_STATUS_LABELS } from "@/lib/work/shared";

const ago = (iso: string) => {
  if (!iso) return "";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const m = (Date.now() - t) / 60000;
  return m < 1 ? "jetzt" : m < 60 ? `${Math.floor(m)} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} T`;
};

const DOT: Record<string, string> = {
  running: "bg-indigo-500 animate-pulse",
  queued: "bg-zinc-400",
  done: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-300",
  interrupted: "bg-amber-500",
};

/**
 * The sessions, like Claude Code's: a new one on top; then every ticket with work — its key, what
 * it is, how many open todos and sessions, a live dot — the ones at work first. A ticket opened
 * shows its sessions; one picked, its conversation on the right.
 */
export function SessionSidebar({ tickets, selected }: { tickets: SessionTicket[]; selected: { ticket?: string; run?: number; isNew?: boolean } }) {
  const [q, setQ] = useState("");
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const words = q.trim().toLowerCase();
  const shown = tickets.filter((t) => !words || `${t.ticket} ${t.summary ?? ""} ${t.sessions.map((s) => s.title).join(" ")}`.toLowerCase().includes(words));
  const selectedTicket = selected.ticket ?? tickets.find((t) => t.sessions.some((s) => s.id === selected.run))?.ticket;
  return (
    <div className="space-y-3">
      <Link href="/work?new=1" className={`btn w-full justify-start ${selected.isNew ? "btn-primary" : ""}`}>
        + Neue Session
      </Link>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tickets, Sessions suchen …" aria-label="Suchen" />
      <ul className="space-y-1">
        {shown.map((t) => {
          const open = openTicket === t.ticket || selectedTicket === t.ticket || (!!words && t.sessions.some((s) => s.title.toLowerCase().includes(words)));
          const live = t.sessions.filter((s) => s.live || s.status === "running");
          const waiting = t.sessions.some((s) => s.waiting);
          return (
            <li key={t.ticket || "—"}>
              <div className={`flex items-start gap-1 rounded-md ${selectedTicket === t.ticket && !selected.run ? "bg-indigo-50 dark:bg-indigo-950/50" : ""}`}>
                <button type="button" className="icon-btn mt-1 size-5 text-[10px]" onClick={() => setOpenTicket(open && openTicket === t.ticket ? "" : t.ticket)} aria-label={open ? "Zuklappen" : "Aufklappen"} disabled={!t.sessions.length}>
                  {t.sessions.length ? (open ? "▾" : "▸") : "·"}
                </button>
                <Link href={`/work?ticket=${encodeURIComponent(t.ticket || "-")}`} className="min-w-0 flex-1 rounded-md px-1 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold">{t.ticket || "Ohne Ticket"}</span>
                    {live.length > 0 && <span className={`size-1.5 rounded-full ${waiting ? "bg-amber-500" : "animate-pulse bg-indigo-500"}`} title={waiting ? "Wartet auf dich" : "Arbeitet"} />}
                    <span className="ml-auto text-[10px] text-zinc-400" suppressHydrationWarning>{ago(t.lastAt)}</span>
                  </span>
                  {t.summary && <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">{t.summary}</span>}
                  <span className="flex gap-2 text-[10px] text-zinc-500">
                    {t.status && <span>{t.status}</span>}
                    {t.openTodos > 0 && <span>☐ {t.openTodos}</span>}
                    {t.sessions.length > 0 && <span>{t.sessions.length} Session{t.sessions.length === 1 ? "" : "s"}</span>}
                  </span>
                </Link>
              </div>
              {open && t.sessions.length > 0 && (
                <ul className="mt-0.5 ml-6 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
                  {t.sessions.slice(0, 12).map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/work?run=${s.id}`}
                        className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selected.run === s.id ? "bg-indigo-50 font-medium dark:bg-indigo-950/50" : ""}`}
                        title={`${s.ref} · ${WORK_STATUS_LABELS[s.status]}`}
                      >
                        <span className={`size-1.5 shrink-0 rounded-full ${s.waiting ? "bg-amber-500" : (DOT[s.status] ?? "bg-zinc-300")}`} />
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="shrink-0 text-[10px] text-zinc-400" suppressHydrationWarning>{ago(s.at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {!shown.length && <li className="text-sm text-zinc-500">Nichts gefunden.</li>}
      </ul>
      <nav className="flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800" aria-label="Weitere Ansichten">
        {(
          [
            ["todos", "Todos"],
            ["runs", "Läufe"],
            ["branches", "Branches"],
            ["settings", "Einstellungen"],
          ] as const
        ).map(([k, label]) => (
          <Link key={k} href={`/work?tab=${k}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
