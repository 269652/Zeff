"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { SessionItem, SessionTicket } from "@/lib/work/sessions";
import { archiveSessionAction, deleteSessionAction } from "@/plugins/work/server-actions";
import { useT } from "../I18nProvider";
import { toast } from "../Toaster";
import { WORK_STATUS_LABELS } from "@/lib/work/shared";
import { formatAgo } from "@/lib/format";
import { groupSessions, isSort, stamp, type Group, type SortKey } from "./session-groups";

/** How long ago, as short as a list row wants it: "now", "48m", "2h", "5d", "3w" (the full words are in the row's tooltip). */
const ago = (iso: string) => {
  const at = stamp(iso);
  if (!at) return "";
  const min = Math.max(0, Math.round((Date.now() - at) / 60000));
  return min < 1 ? "now" : min < 60 ? `${min}m` : min < 1440 ? `${Math.floor(min / 60)}h` : min < 14 * 1440 ? `${Math.floor(min / 1440)}d` : `${Math.floor(min / (7 * 1440))}w`;
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
 * The sessions, like Claude Code's: one thin row each (a dot for how it stands, its title, its ticket,
 * how long ago), under headings you can fold — by time (Today, Yesterday …), by what needs you, or by
 * ticket — or in one list by name. Sorted by newest, priority, ticket or A–Z (kept in the browser). A
 * session picked opens its conversation on the right; a ticket heading opens the ticket's page.
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
    <div ref={ref} className="absolute top-1/2 right-0.5 -translate-y-1/2">
      <button type="button" className={`icon-btn size-6 text-sm group-hover:opacity-100 focus-visible:opacity-100 ${open ? "opacity-100" : "opacity-0"}`} onClick={() => setOpen(!open)} aria-label={t("Session menu")} aria-expanded={open} disabled={pending}>
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

const SORT_KEY = "zeff:work:sort";
const SORT_EVENT = "zeff:work-sort";
/** The saved sort (this browser's), and the minute — both read the way an external store is, so the server and the first render agree. */
const subscribeSort = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(SORT_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(SORT_EVENT, cb);
  };
};
const savedSort = (): SortKey => {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return isSort(v) ? v : "newest";
  } catch {
    return "newest";
  }
};
const subscribeMinute = (cb: () => void) => {
  const id = setInterval(cb, 60000);
  return () => clearInterval(id);
};
/** Rows shown before "Show more" — a long history stays one scroll. */
const FIRST = 60;

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
  // Time-dependent headings (Today …) only once mounted (null on the server): it and the browser may not agree on the day.
  const now = useSyncExternalStore(subscribeMinute, () => Math.floor(Date.now() / 60000) * 60000, () => null);
  const stored = useSyncExternalStore(subscribeSort, savedSort, () => "newest" as SortKey);
  // (Where the browser keeps nothing, the pick still holds for this page.)
  const [local, setLocal] = useState<SortKey | null>(null);
  const sort = local ?? stored;
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  const pick = (v: SortKey) => {
    setLocal(v);
    try {
      localStorage.setItem(SORT_KEY, v);
      window.dispatchEvent(new Event(SORT_EVENT));
    } catch {
      // not kept
    }
  };
  const words = q.trim().toLowerCase();
  const found = tickets
    .map((tk) => ({ ...tk, sessions: tk.sessions.filter((s) => !words || `${tk.ticket} ${tk.summary ?? ""} ${s.title} ${s.branch ?? ""}`.toLowerCase().includes(words)) }))
    .filter((tk) => tk.sessions.length);
  const groups = groupSessions(found, sort, now);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const headings: Record<Group["id"], string> = {
    all: "",
    today: t("Today"),
    yesterday: t("Yesterday"),
    week: t("Previous 7 days"),
    older: t("Earlier"),
    waiting: t("Needs you"),
    working: t("Working"),
    attention: t("Failed or cut off"),
    other: t("Other"),
    ticket: "",
  };
  const fold = (key: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // The first FIRST rows (open groups only); the rest behind "Show more".
  const shown: { g: Group; rows: Group["rows"] }[] = [];
  let left = all ? Infinity : FIRST;
  for (const g of groups) {
    const rows = folded.has(g.key) ? [] : g.rows.slice(0, Math.max(0, left));
    left -= rows.length;
    shown.push({ g, rows });
  }
  const hidden = groups.reduce((n, g) => n + (folded.has(g.key) ? 0 : g.rows.length), 0) - shown.reduce((n, x) => n + x.rows.length, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Link href="/work?new=1" className={`btn btn-sm shrink-0 ${selected.isNew ? "btn-primary" : ""}`} title={t("New session")}>
          + {t("New")}
        </Link>
        <input className="input h-8 min-w-0 flex-1 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search sessions…")} aria-label={t("Search")} />
      </div>
      <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        {t("Sort")}
        <select className="input h-6 flex-1 py-0 text-[11px]" value={sort} onChange={(e) => pick(e.target.value as SortKey)} aria-label={t("Sort sessions")}>
          <option value="newest">{t("Newest")}</option>
          <option value="priority">{t("Priority")}</option>
          <option value="ticket">{t("Ticket")}</option>
          <option value="alpha">{t("A–Z")}</option>
        </select>
      </label>
      <div className="space-y-0.5">
        {shown.map(({ g, rows }) => {
          const isFolded = folded.has(g.key);
          return (
            <section key={g.key}>
              {g.id !== "all" && (
                <div className="flex items-center gap-1 px-0.5 pt-2 pb-0.5 text-[11px] text-zinc-500">
                  <button type="button" className="flex min-w-0 items-center gap-1 rounded px-0.5 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => fold(g.key)} aria-expanded={!isFolded} aria-label={isFolded ? t("Expand") : t("Collapse")}>
                    <span className="w-3 shrink-0 text-[9px]">{isFolded ? "▸" : "▾"}</span>
                    {g.id !== "ticket" && <span className="font-medium tracking-wide uppercase">{headings[g.id]}</span>}
                  </button>
                  {g.id === "ticket" && (
                    <Link href={`/work?ticket=${encodeURIComponent(g.ticket || "-")}`} className="min-w-0 flex-1 truncate hover:text-zinc-800 dark:hover:text-zinc-200" title={g.summary ?? undefined}>
                      <span className="font-mono font-semibold">{g.ticket || t("No ticket")}</span>
                      {g.summary && <span className="ml-1.5 font-normal">{g.summary}</span>}
                    </Link>
                  )}
                  <span className="ml-auto shrink-0 tabular-nums text-zinc-400">{g.rows.length}</span>
                </div>
              )}
              {rows.length > 0 && (
                <ul>
                  {rows.map((s) => (
                    <li key={s.id} className="group relative">
                      <Link
                        href={`/work?run=${s.id}`}
                        className={`flex min-w-0 items-center gap-2 rounded px-1.5 py-[5px] text-[13px] leading-tight hover:bg-zinc-100 dark:hover:bg-zinc-800 ${selected.run === s.id ? "bg-indigo-50 font-medium dark:bg-indigo-950/50" : ""} ${s.archived ? "opacity-60" : ""}`}
                        title={`${s.ref} · ${WORK_STATUS_LABELS[s.status]}${s.ticket ? ` · ${s.ticket}` : ""}${s.branch ? ` · ⎇ ${s.branch}` : ""}`}
                      >
                        <span className={`size-1.5 shrink-0 rounded-full ${s.waiting ? "bg-amber-500" : (DOT[s.status] ?? "bg-zinc-300")}`} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        {g.id !== "ticket" && s.ticket && <span className="shrink-0 font-mono text-[10px] text-zinc-400">{s.ticket}</span>}
                        <span className="w-7 shrink-0 text-right text-[10px] whitespace-nowrap text-zinc-400 group-focus-within:invisible group-hover:invisible" title={formatAgo(stamp(s.at))} suppressHydrationWarning>
                          {ago(s.at)}
                        </span>
                      </Link>
                      <SessionMenu s={s} active={s.status === "running" || s.status === "queued"} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        {!total && <p className="px-1 text-sm text-zinc-500">{t("Nothing found.")}</p>}
        {hidden > 0 && (
          <button type="button" className="px-1.5 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => setAll(true)}>
            {t("Show more ({n})", { n: hidden })}
          </button>
        )}
      </div>
      {extTabs.length > 0 && (
        <nav className="space-y-0.5 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-800" aria-label={t("Plugin views")}>
          {extTabs.map((x) => (
            <Link key={x.id} href={x.href} className="flex items-baseline gap-1.5 rounded px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" title={x.plugin}>
              <span className="font-medium">{x.title}</span>
              <span className="truncate text-[10px] text-zinc-400">{x.plugin}</span>
            </Link>
          ))}
        </nav>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-800">
        <Link href="/settings#work" className="text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Code settings")}
        </Link>
        {(archivedCount > 0 || showArchived) && (
          <Link href={showArchived ? "/work" : "/work?archived=1"} className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            {showArchived ? t("Hide archived") : t("Show archived ({n})", { n: archivedCount })}
          </Link>
        )}
      </div>
    </div>
  );
}
