"use client";

import Link from "next/link";
import { ChevronIcon } from "./icons";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { saveMenuAction } from "@/app/actions";
import type { Placement } from "@/lib/layout-shared";
import { UnseenActivityBadge } from "./boards/ActivitySeen";
import { SyncMenu } from "./SyncMenu";
import { TabSplit } from "./TabSplit";
import { LinkPending } from "./LinkPending";
import { AccountSwitcher, type AccountChip } from "@/plugins/accounts/AccountSwitcher";

/** A header tab: an installed application's (Work, Todos, the weekly and the monthly report). */
export type HeaderTab = { href: string; label: string; short: string; also?: string[]; /** Its plugin gives a dropdown (a split button). */ menu?: boolean };

/** A menu entry. */
export type MenuLink = { href: string; label: string; hint: string };
/** An application: in the header, in the menu's "Apps", or hidden. */
export type MenuApp = MenuLink & { place: Placement };
/** A plugin's entries — its pages and its settings — folded under its name. */
export type MenuGroup = { id: string; name: string; items: MenuLink[] };

/** Zeff's own pages, in the menu drawer (after the apps and the plugins'). */
const MENU = [
  // (the installed plugins' pages come first: Jobs, Projects, Schedule, Analysis — Zeiterfassung —, Jira, Calendar, Teams, Mail, GitLab, Repos …)
  { href: "/tags", label: "Tags", hint: "Tags & entry types" },
  { href: "/context", label: "Context", hint: "Colleagues' messages & links" },
  { href: "/mcp", label: "MCP", hint: "Connect an agent" },
  { href: "/preferences", label: "Settings", hint: "AI provider" },
  { href: "/auswerten", label: "Auswerten", hint: "Was die KI bei jedem Schritt liest" },
  { href: "/sync-settings", label: "Sync-Einstellungen", hint: "Wie oft jeder Sync läuft" },
  { href: "/logins", label: "Anmeldungen", hint: "Logins im Automations-Chrome" },
  { href: "/plugins", label: "Plugins", hint: "Connectors & AI tools" },
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
/**
 * `activityIds`: the recent todo events that are news — Boards shows how many you haven't seen.
 * `account`: the account you're in and the others (Accounts plugin installed).
 */
export function SiteHeader({
  activityIds = [],
  apps = [],
  pluginGroups = [],
  hidden = [],
  tabs = [],
  account,
}: {
  activityIds?: number[];
  /** Every application, with its place (the menu's "Apps" shows those put there). */
  apps?: MenuApp[];
  /** The other entries hidden from the menu (Menu → Anpassen). */
  hidden?: string[];
  /** Each installed plugin's pages and settings — expandable. */
  pluginGroups?: MenuGroup[];
  tabs?: HeaderTab[];
  account?: { current: AccountChip; list: AccountChip[] };
}) {
  // The menu: the apps, the installed plugins' pages (a group each), then Zeff's own.
  const menu = [...apps.filter((a) => a.place === "menu"), ...pluginGroups.flatMap((g) => g.items), ...MENU];
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // "Anpassen": every entry with its controls — pinned to the header, in the menu, hidden.
  const [editing, setEditing] = useState(false);
  const [saving, startSave] = useTransition();
  const save = (change: { href: string; place?: Placement; hidden?: boolean }) =>
    startSave(async () => {
      await saveMenuAction(change);
      router.refresh();
    });
  const isHidden = (href: string) => hidden.includes(href);
  const [shownFor, setShownFor] = useState(pathname);
  const burger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const isAt = (href: string) => pathname === href.split("#")[0] || pathname.startsWith(`${href.split("#")[0]}/`);
  const inMenu = menu.find((l) => isAt(l.href));
  // The plugin you're on: its group open.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(pluginGroups.filter((g) => g.items.some((i) => isAt(i.href))).map((g) => g.id)));
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Another page (a link, the back button): the drawer closes.
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  const item = (l: MenuLink, sub = false) => {
    const active = isAt(l.href);
    if (editing) {
      const off = isHidden(l.href);
      return (
        <li key={l.href} className={`flex items-center gap-2 rounded-md py-1.5 ${sub ? "pr-2 pl-7" : "px-3"} ${off ? "opacity-50" : ""}`}>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.label}</span>
          <button type="button" className="icon-btn text-xs" disabled={saving} onClick={() => save({ href: l.href, hidden: !off })} title={off ? "Im Menü zeigen" : "Im Menü ausblenden"} aria-label={`${l.label} ${off ? "zeigen" : "ausblenden"}`}>
            {off ? "Zeigen" : "Aus"}
          </button>
        </li>
      );
    }
    return (
      <li key={l.href}>
        <Link
          href={l.href}
          aria-current={active ? "page" : undefined}
          onClick={() => setOpen(false)}
          className={`block rounded-md py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${sub ? "pr-3 pl-7" : "px-3"} ${
            active ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <span className="block text-sm font-medium">{l.label}</span>
          <span className={`block text-xs ${active ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400"}`}>{l.hint}</span>
        </Link>
      </li>
    );
  };
  const heading = (text: string, href?: string) => (
    <li className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
      {href ? (
        <Link href={href} onClick={() => setOpen(false)} className="hover:text-zinc-600 hover:underline dark:hover:text-zinc-200">
          {text}
        </Link>
      ) : (
        text
      )}
    </li>
  );

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
            </Link>
            {account && <AccountSwitcher current={account.current} list={account.list} />}
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <nav className="flex items-center gap-1" aria-label="Reports">
              {tabs.map((t) => {
                const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
                const current = active || (t.also ?? []).some((p) => pathname.startsWith(p));
                const inner = (
                  <>
                    <span className="sm:hidden">{t.short}</span>
                    <span className="hidden sm:inline">{t.label}</span>
                    {t.href === "/todos" && <UnseenActivityBadge ids={activityIds} className="ml-1 align-[1px]" />}
                    <LinkPending />
                  </>
                );
                // A tab with a dropdown (Kanban's boards) opens where you last were under it.
                return t.menu ? (
                  <TabSplit key={t.href} tab={t} current={current} pathname={pathname} className={`${pill(current)} rounded-r-none pr-2`} active={active}>
                    {inner}
                  </TabSplit>
                ) : (
                  <Link key={t.href} href={t.href} className={pill(current)} aria-current={active ? "page" : undefined}>
                    {inner}
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
            {heading("Apps", "/apps")}
            {editing
              ? apps.map((a) => (
                  <li key={a.href} className={`flex items-center gap-2 rounded-md px-3 py-1.5 ${a.place === "hidden" ? "opacity-50" : ""}`}>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.label}</span>
                    <span className="flex overflow-hidden rounded-md border border-zinc-200 text-[11px] dark:border-zinc-700" role="group" aria-label={`${a.label}: wo`}>
                      {(["header", "menu", "hidden"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          disabled={saving}
                          aria-pressed={a.place === p}
                          onClick={() => save({ href: a.href, place: p })}
                          className={`px-1.5 py-0.5 ${a.place === p ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                        >
                          {p === "header" ? "Kopfzeile" : p === "menu" ? "Menü" : "Aus"}
                        </button>
                      ))}
                    </span>
                  </li>
                ))
              : (() => {
                  const inMenuApps = apps.filter((a) => a.place === "menu");
                  return inMenuApps.length ? inMenuApps.map((l) => item(l)) : <li className="px-3 py-1 text-xs text-zinc-400">Alle Apps in der Kopfzeile.</li>;
                })()}
            {pluginGroups.length > 0 && heading("Plugins")}
            {pluginGroups
              .map((g) => (editing ? g : { ...g, items: g.items.filter((i) => !isHidden(i.href)) }))
              .filter((g) => g.items.length)
              .map((g) =>
              g.items.length === 1 && !editing ? (
                item({ ...g.items[0], label: g.items[0].label === "Einstellungen" ? g.name : g.items[0].label })
              ) : (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => toggle(g.id)}
                    aria-expanded={expanded.has(g.id)}
                    className="flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-1.5 text-left text-sm font-medium transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:hover:bg-zinc-800"
                  >
                    {g.name}
                    <ChevronIcon open={expanded.has(g.id)} className="size-3.5 text-zinc-400" />
                  </button>
                  {(expanded.has(g.id) || editing) && <ul className="space-y-0.5">{g.items.map((l) => item(l, true))}</ul>}
                </li>
              ),
            )}
            {heading("Zeff")}
            {MENU.filter((l) => editing || !isHidden(l.href)).map((l) => item(l))}
          </ul>
          <div className="mt-3 border-t border-zinc-200 px-3 pt-2 dark:border-zinc-800">
            <button type="button" className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200" onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
              {editing ? "Fertig" : "Menü anpassen"}
            </button>
            {editing && <p className="mt-1 text-[11px] text-zinc-400">Apps: in die Kopfzeile, ins Menü oder aus. Die anderen Einträge: ein- oder ausblenden.</p>}
          </div>
        </nav>
      </div>
    </>
  );
}
