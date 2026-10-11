"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { SessionItem, SessionTicket } from "@/lib/work/sessions";
import { archiveSessionAction, deleteSessionAction } from "@/plugins/work/server-actions";
import { useT } from "../I18nProvider";
import { toast } from "../Toaster";
import { WORK_STATUS_LABELS } from "@/lib/work/shared";
import { formatAgo } from "@/lib/format";

const ago = (iso: string) => {
  if (!iso) return "";
  return formatAgo(Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`));
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
/** A session's ⋯: archive it (out of the list) or back, or delete it (its runs and logs; its todo stays). */
function SessionMenu({ s, active }: { s: SessionItem; active: boolean }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const act = (fn: () => Promise<{ ok: boolean; error?: string } | null>) =>
    start(async () => {
      const r = await fn();
      setOpen(false);
      if (r && !r.ok) toast(r.error ?? t("Didn't work."), { tone: "error" });
      router.refresh();
    });
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" className="icon-btn size-6 text-sm opacity-60 group-hover:opacity-100" onClick={() => setOpen(!open)} aria-label={t("Session menu")} aria-expanded={open} disabled={pending}>
        ⋯
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-30 mt-1 w-44 rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => act(() => archiveSessionAction(s.todoId, !s.archived))}>
            {s.archived ? t("Unarchive") : t("Archive")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40"
            disabled={active}
            title={active ? t("It's working — stop it first.") : undefined}
            onClick={() => confirm(t("Delete this session? Its conversation and logs are gone; its todo stays.")) && act(() => deleteSessionAction(s.todoId))}
          >
            {t("Delete …")}
          </button>
        </div>
      )}
    </div>
  );
}

export function SessionSidebar({
  tickets,
  selected,
  showArchived = false,
  archivedCount = 0,
  extTabs = [],
}: {
  tickets: SessionTicket[];
  selected: { ticket?: string; run?: number; isNew?: boolean };
  /** Your archived sessions shown too (marked), and how many there are. */
  showArchived?: boolean;
  archivedCount?: number;
  /** Views external plugins add to Work (src/lib/ext): a link each. */
  extTabs?: { id: string; title: string; plugin: string; href: string }[];
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const words = q.trim().toLowerCase();
  const shown = tickets.filter((t) => !words || `${t.ticket} ${t.summary ?? ""} ${t.sessions.map((s) => s.title).join(" ")}`.toLowerCase().includes(words));
  const selectedTicket = selected.ticket ?? tickets.find((t) => t.sessions.some((s) => s.id === selected.run))?.ticket;
  return (
    <div className="space-y-3">
      <Link href="/work?new=1" className={`btn w-full justify-start ${selected.isNew ? "btn-primary" : ""}`}>
        + New session
      </Link>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tickets, sessions…" aria-label="Search" />
      <ul className="space-y-1">
        {shown.map((t) => {
          const open = openTicket === t.ticket || selectedTicket === t.ticket || (!!words && t.sessions.some((s) => s.title.toLowerCase().includes(words)));
          const live = t.sessions.filter((s) => s.live || s.status === "running");
          const waiting = t.sessions.some((s) => s.waiting);
          return (
            <li key={t.ticket || "—"}>
              <div className={`flex items-start gap-1 rounded-md ${selectedTicket === t.ticket && !selected.run ? "bg-indigo-50 dark:bg-indigo-950/50" : ""}`}>
                <button type="button" className="icon-btn mt-1 size-5 text-[10px]" onClick={() => setOpenTicket(open && openTicket === t.ticket ? "" : t.ticket)} aria-label={open ? "Collapse" : "Expand"} disabled={!t.sessions.length}>
                  {t.sessions.length ? (open ? "▾" : "▸") : "·"}
                </button>
                <Link href={`/work?ticket=${encodeURIComponent(t.ticket || "-")}`} className="min-w-0 flex-1 rounded-md px-1 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold">{t.ticket || "No ticket"}</span>
                    {live.length > 0 && <span className={`size-1.5 rounded-full ${waiting ? "bg-amber-500" : "animate-pulse bg-indigo-500"}`} title={waiting ? "Waiting for you" : "Working"} />}
                    <span className="ml-auto text-[10px] text-zinc-400" suppressHydrationWarning>{ago(t.lastAt)}</span>
                  </span>
                  {t.summary && <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">{t.summary}</span>}
                  <span className="flex gap-2 text-[10px] text-zinc-500">
                    {t.status && <span>{t.status}</span>}
                    {t.openTodos > 0 && <span>☐ {t.openTodos}</span>}
                    {t.sessions.length > 0 && <span>{t.sessions.length} session{t.sessions.length === 1 ? "" : "s"}</span>}
                  </span>
                </Link>
              </div>
              {open && t.sessions.length > 0 && (
                <ul className="mt-0.5 ml-6 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
                  {t.sessions.slice(0, 12).map((s) => (
                    <li key={s.id} className="group flex items-center gap-0.5">
                      <Link
                        href={`/work?run=${s.id}`}
                        className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selected.run === s.id ? "bg-indigo-50 font-medium dark:bg-indigo-950/50" : ""} ${s.archived ? "opacity-60" : ""}`}
                        title={`${s.ref} · ${WORK_STATUS_LABELS[s.status]}`}
                      >
                        <span className={`size-1.5 shrink-0 rounded-full ${s.waiting ? "bg-amber-500" : (DOT[s.status] ?? "bg-zinc-300")}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{s.title}</span>
                          {s.branch && (
                            <span className="block truncate font-mono text-[10px] text-zinc-400" title={s.branch}>
                              ⎇ {s.branch}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-[10px] text-zinc-400" suppressHydrationWarning>{ago(s.at)}</span>
                      </Link>
                      <SessionMenu s={s} active={s.status === "running" || s.status === "queued"} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {!shown.length && <li className="text-sm text-zinc-500">Nothing found.</li>}
      </ul>
      {(archivedCount > 0 || showArchived) && (
        <Link href={showArchived ? "/work" : "/work?archived=1"} className="block text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          {showArchived ? t("Hide archived") : t("Show archived ({n})", { n: archivedCount })}
        </Link>
      )}
      {extTabs.length > 0 && (
        <nav className="space-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800" aria-label={t("Plugin views")}>
          {extTabs.map((x) => (
            <Link key={x.id} href={x.href} className="flex items-baseline gap-1.5 rounded px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" title={x.plugin}>
              <span className="font-medium">{x.title}</span>
              <span className="truncate text-[10px] text-zinc-400">{x.plugin}</span>
            </Link>
          ))}
        </nav>
      )}
      <div className="border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
        <Link href="/settings#work" className="text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Work settings")}
        </Link>
      </div>
    </div>
  );
}
