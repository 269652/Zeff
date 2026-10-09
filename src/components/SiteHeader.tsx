"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UnseenActivityBadge } from "./boards/ActivitySeen";
import { SyncMenu } from "./SyncMenu";
import { LinkPending } from "./LinkPending";

/** The header's tabs: the two reports (an entry and the exports belong to the week). */
const TABS = [
  { href: "/work", label: "Work", short: "Work", also: [] },
  { href: "/boards", label: "Boards", short: "Boards", also: [] },
  { href: "/", label: "Weekly report", short: "Weekly", also: ["/entries", "/export"] },
  { href: "/month", label: "Monthly report", short: "Monthly", also: [] },
];

/** Everything else, in the menu drawer. */
const MENU = [
  { href: "/jobs", label: "Jobs", hint: "Job numbers to book on" },
  { href: "/projects", label: "Projects", hint: "Work grouped under a job" },
  { href: "/settings", label: "Schedule", hint: "Working hours & absences" },
  { href: "/tags", label: "Tags", hint: "Tags & entry types" },
  { href: "/analysis", label: "Analysis", hint: "Charts of your bookings" },
  { href: "/jira", label: "Jira", hint: "Boards, tickets & sync" },
  { href: "/calendar", label: "Calendar", hint: "Outlook meetings to import" },
  { href: "/teams", label: "Teams", hint: "Your mentions & PMs" },
  { href: "/mail", label: "Mail", hint: "Your inbox (Outlook)" },
  { href: "/gitlab", label: "GitLab", hint: "Merge requests, comments & branches" },
  { href: "/repos", label: "Repos", hint: "Where workers implement" },
  { href: "/context", label: "Context", hint: "Colleagues' messages & links" },
  { href: "/mcp", label: "MCP", hint: "Connect an agent" },
  { href: "/preferences", label: "Settings", hint: "AI provider" },
];

const pill = (active: boolean) =>
  "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition " +
  (active
    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800");

/**
 * The header — the menu button, Zeff, the weekly and monthly report — and the menu drawer
 * with all other pages, sliding in from the left. The drawer sits beside the header, not in
 * it: the header's backdrop blur would otherwise pin the fixed drawer inside the header.
 */
/** `activityIds`: the recent todo events that are news — Boards shows how many you haven't seen. */
export function SiteHeader({ activityIds = [] }: { activityIds?: number[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [shownFor, setShownFor] = useState(pathname);
  const burger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const inMenu = MENU.find((l) => pathname.startsWith(l.href));

  // Another page (a link, the back button): the drawer closes.
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  const close = () => {
    setOpen(false);
    burger.current?.focus();
  };

  // While open: focus is in the drawer (and stays there), Escape closes it, the page behind doesn't scroll.
  useEffect(() => {
    if (!open) return;
    const root = panel.current;
    (root?.querySelector<HTMLElement>('[aria-current="page"]') ?? root?.querySelector<HTMLElement>("nav a"))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        burger.current?.focus();
      } else if (e.key === "Tab" && root) {
        const items = [...root.querySelectorAll<HTMLElement>("a[href], button")];
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      <header className="relative z-30 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              ref={burger}
              type="button"
              className="relative -ml-1.5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-600 transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-label="Menu"
              aria-expanded={open}
              aria-controls="site-menu"
              title={inMenu ? `Menu — ${inMenu.label}` : "Menu"}
              onClick={() => setOpen(true)}
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                <path d="M3 5.5h14M3 10h14M3 14.5h14" />
              </svg>
              {/* On one of the menu's pages. */}
              {inMenu && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-indigo-500" aria-hidden />}
            </button>
            <Link href="/" className="flex shrink-0 items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight">Zeff</span>
              <span className="hidden text-xs text-zinc-500 sm:inline dark:text-zinc-400">Zeiterfassung</span>
            </Link>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <nav className="flex items-center gap-1" aria-label="Reports">
              {TABS.map((t) => {
                const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
                const current = active || t.also.some((p) => pathname.startsWith(p));
                return (
                  <Link key={t.href} href={t.href} className={pill(current)} aria-current={active ? "page" : undefined}>
                    <span className="sm:hidden">{t.short}</span>
                    <span className="hidden sm:inline">{t.label}</span>
                    {t.href === "/boards" && <UnseenActivityBadge ids={activityIds} className="ml-1 align-[1px]" />}
                    <LinkPending />
                  </Link>
                );
              })}
            </nav>
            <SyncMenu />
          </div>
        </div>
      </header>

      <div
        className={`fixed inset-0 z-40 bg-zinc-950/40 transition-opacity duration-200 motion-reduce:transition-none ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={close}
        aria-hidden
      />
      <div
        id="site-menu"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        inert={!open}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-zinc-200 bg-white transition-[translate,box-shadow] duration-200 ease-out motion-reduce:transition-none dark:border-zinc-800 dark:bg-zinc-950 ${open ? "translate-x-0 shadow-xl" : "-translate-x-full shadow-none"}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <span className="flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight">Zeff</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Zeiterfassung</span>
          </span>
          <button
            type="button"
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:hover:bg-zinc-800"
            aria-label="Close menu"
            onClick={close}
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="More pages">
          <ul className="space-y-0.5">
            {MENU.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`block rounded-md px-3 py-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                      active ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="block text-sm font-medium">{l.label}</span>
                    <span className={`block text-xs ${active ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400"}`}>{l.hint}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}
