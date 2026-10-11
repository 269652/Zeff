"use client";

import Link from "next/link";
import { ChevronIcon } from "./icons";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { saveMenuAction } from "@/app/actions";
import { inOrder, type Placement } from "@/lib/layout-shared";
import { UnseenActivityBadge } from "./boards/ActivitySeen";
import { SyncMenu } from "./SyncMenu";
import { TabSplit } from "./TabSplit";
import { LastTabLink } from "./LastTabLink";
import { LinkPending } from "./LinkPending";
import { AccountSwitcher, type AccountChip } from "@/plugins/accounts/AccountSwitcher";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";

/** A header tab: an installed application's (Work, Todos, the weekly and the monthly report). */
export type HeaderTab = { href: string; label: string; short: string; also?: string[]; /** Its plugin gives a dropdown (a split button). */ menu?: boolean };

/** A menu entry. */
export type MenuLink = { href: string; label: string; hint: string };
/** An application: in the header, in the menu's "Apps", or hidden. */
export type MenuApp = MenuLink & { place: Placement };
/** A plugin's entries — its pages and its settings — folded under its name. */
export type MenuGroup = { id: string; name: string; items: MenuLink[] };

/** Zeff's own pages, in the menu drawer (after the apps and the plugins'). */
const menuEntries = (t: T) => [
  // (the installed plugins' pages come first: Jobs, Projects, Schedule, Analysis — Zeiterfassung —, Jira, Calendar, Teams, Mail, GitLab, Repos …)
  { href: "/tags", label: t("Tags"), hint: t("Tags & entry types") },
  { href: "/context", label: t("Context"), hint: t("Colleagues' messages & links") },
  { href: "/mcp", label: "MCP", hint: t("Connect an agent") },
  { href: "/preferences", label: t("Settings"), hint: t("AI provider") },
  { href: "/auswerten", label: t("AI steps"), hint: t("What the AI reads at each step") },
  { href: "/sync-settings", label: t("Sync settings"), hint: t("How often each sync runs") },
  { href: "/logins", label: t("Sign-ins"), hint: t("Logins in the automation Chrome") },
  { href: "/plugins", label: t("Plugins"), hint: t("Connectors & AI tools") },
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
  waiting = [],
  apps = [],
  pluginGroups = [],
  hidden = [],
  order = [],
  tabs = [],
  account,
  bare = false,
}: {
  activityIds?: number[];
  /** What waits for you on a tab (a Work session's question or turn): a yellow dot on it. */
  waiting?: { href: string; title: string }[];
  /** Every application, with its place (the menu's "Apps" shows those put there). */
  apps?: MenuApp[];
  /** The other entries hidden from the menu (Menu → Anpassen). */
  hidden?: string[];
  /** The order you put things in (Menu → Anpassen, ↑↓). */
  order?: string[];
  /** Not set up yet: Zeff and the account — no menu, no tabs, no syncs (the setup assistant leads). */
  bare?: boolean;
  /** Each installed plugin's pages and settings — expandable. */
  pluginGroups?: MenuGroup[];
  tabs?: HeaderTab[];
  account?: { current: AccountChip; list: AccountChip[] };
}) {
  const t = useT();
  // The menu: the apps, the installed plugins' pages (a group each), then Zeff's own.
  const zeff = inOrder(menuEntries(t), (l) => l.href, order);
  const menu = [...apps.filter((a) => a.place === "menu"), ...pluginGroups.flatMap((g) => g.items), ...zeff];
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
  // ↑↓: an entry swapped with its neighbour in its section (`same`: only those that count as
  // neighbours — an app among the apps in the same place); the section's new order saved.
  const neighbour = (keys: string[], i: number, dir: -1 | 1, same?: (k: string) => boolean) => {
    let j = i + dir;
    while (j >= 0 && j < keys.length && same && !same(keys[j])) j += dir;
    return j >= 0 && j < keys.length ? j : -1;
  };
  const move = (keys: string[], i: number, dir: -1 | 1, same?: (k: string) => boolean) => {
    const j = neighbour(keys, i, dir, same);
    if (j < 0) return;
    const next = [...keys];
    [next[i], next[j]] = [next[j], next[i]];
    startSave(async () => {
      await saveMenuAction({ order: next });
      router.refresh();
    });
  };
  // Drag and drop: an entry dropped on another of its section takes its place (an app dropped on
  // one in another place — header, menu — moves there too).
  const [drag, setDrag] = useState<{ section: string; key: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dnd = (section: string, keys: string[], key: string, then?: (from: string) => Promise<unknown>) =>
    editing
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", key);
            setDrag({ section, key });
          },
          onDragEnd: () => {
            setDrag(null);
            setOver(null);
          },
          onDragOver: (e: React.DragEvent) => {
            if (drag?.section !== section || drag.key === key) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(key);
          },
          onDragLeave: () => setOver((o) => (o === key ? null : o)),
          onDrop: (e: React.DragEvent) => {
            const from = drag?.section === section ? drag.key : null;
            setDrag(null);
            setOver(null);
            if (!from || from === key) return;
            e.preventDefault();
            e.stopPropagation();
            const next = keys.filter((k) => k !== from);
            next.splice(next.indexOf(key) + (keys.indexOf(from) < keys.indexOf(key) ? 1 : 0), 0, from);
            startSave(async () => {
              await saveMenuAction({ order: next });
              await then?.(from);
              router.refresh();
            });
          },
        }
      : {};
  const dropMark = (key: string) => (editing ? `cursor-grab ${over === key ? "ring-2 ring-indigo-400" : ""} ${drag?.key === key ? "opacity-40" : ""}` : "");
  // The grip: drag it — or, focused, ↑/↓ moves the entry.
  const arrows = (label: string, keys: string[], i: number, same?: (k: string) => boolean) => (
    <button
      type="button"
      className="-ml-1.5 shrink-0 cursor-grab rounded px-0.5 text-zinc-400 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:hover:text-zinc-200"
      disabled={saving}
      title={t("Drag to reorder (or ↑/↓)")}
      aria-label={t("Move {label} (arrow keys)", { label })}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        move(keys, i, e.key === "ArrowUp" ? -1 : 1, same);
      }}
    >
      <svg viewBox="0 0 10 16" className="h-3.5 w-2" fill="currentColor" aria-hidden>
        {[3, 8, 13].flatMap((y) => [<circle key={`a${y}`} cx="2.5" cy={y} r="1.2" />, <circle key={`b${y}`} cx="7.5" cy={y} r="1.2" />])}
      </svg>
    </button>
  );
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

  /** An entry — while editing with its controls (`keys`, `i`: its section, for ↑↓). */
  const item = (l: MenuLink, sub = false, keys?: string[], i = 0) => {
    const active = isAt(l.href);
    if (editing) {
      const off = isHidden(l.href);
      return (
        <li key={l.href} {...(keys ? dnd(keys.join("|"), keys, l.href) : {})} className={`flex items-center gap-2 rounded-md py-1.5 ${sub ? "pr-2 pl-7" : "px-3"} ${off ? "opacity-50" : ""} ${dropMark(l.href)}`}>
          {keys && arrows(l.label, keys, i)}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.label}</span>
          <button type="button" className="icon-btn text-xs" disabled={saving} onClick={() => save({ href: l.href, hidden: !off })} title={off ? t("Show in the menu") : t("Hide from the menu")} aria-label={off ? t("Show {label}", { label: l.label }) : t("Hide {label}", { label: l.label })}>
            {off ? t("Show") : t("Off")}
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
          <div className="flex shrink-0 items-center gap-2">
            {!bare && (
              <button
                ref={burger}
                type="button"
                className="relative -ml-1.5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-600 transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:text-zinc-300 dark:hover:bg-zinc-800"
                aria-label={t("Menu")}
                aria-expanded={open}
                aria-controls="site-menu"
                title={inMenu ? t("Menu — {label}", { label: inMenu.label }) : t("Menu")}
                onClick={() => setOpen(true)}
              >
                <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                  <path d="M3 5.5h14M3 10h14M3 14.5h14" />
                </svg>
                {/* On one of the menu's pages. */}
                {inMenu && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-indigo-500" aria-hidden />}
              </button>
            )}
            <Link href="/" className="flex shrink-0 items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight">Zeff</span>
            </Link>
            {account && <AccountSwitcher current={account.current} list={account.list} />}
          </div>
          {!bare && (
            <div className="flex min-w-0 items-center gap-1 sm:gap-2">
              {/* The tabs: on a narrow screen they scroll sideways — the page never gets wider than the window. */}
              <nav className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]" aria-label={t("Reports")}>
                {tabs.map((tab) => {
                  const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
                  const current = active || (tab.also ?? []).some((p) => pathname.startsWith(p));
                  const inner = (
                    <>
                      <span className="sm:hidden">{tab.short}</span>
                      <span className="hidden sm:inline">{tab.label}</span>
                      {tab.href === "/todos" && <UnseenActivityBadge ids={activityIds} className="ml-1 align-[1px]" />}
                      {waiting.some((w) => w.href.startsWith(tab.href)) && (
                        <span
                          className="ml-1 inline-block size-2 rounded-full bg-amber-500 align-[1px]"
                          title={waiting
                            .filter((w) => w.href.startsWith(tab.href))
                            .map((w) => w.title)
                            .join("\n")}
                          aria-label={t("Waiting for you")}
                        />
                      )}
                      <LinkPending />
                    </>
                  );
                  // A tab with a dropdown (Kanban's boards) opens where you last were under it.
                  return tab.menu ? (
                    <TabSplit key={tab.href} tab={tab} current={current} pathname={pathname} className={`${pill(current)} rounded-r-none pr-2`} active={active}>
                      {inner}
                    </TabSplit>
                  ) : tab.href === "/work" ? (
                    // Work opens the session you had open last.
                    <LastTabLink key={tab.href} href={tab.href} label={tab.label} className={pill(current)} active={active}>
                      {inner}
                    </LastTabLink>
                  ) : (
                    <Link key={tab.href} href={tab.href} className={pill(current)} aria-current={active ? "page" : undefined}>
                      {inner}
                    </Link>
                  );
                })}
              </nav>
              <SyncMenu />
            </div>
          )}
        </div>
      </header>

      {/* The menu drawer (not while setting up: the assistant leads). */}
      {!bare && (
        <>
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
            aria-label={t("Menu")}
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
                aria-label={t("Close menu")}
                onClick={close}
              >
                <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2" aria-label={t("More pages")}>
              <ul className="space-y-0.5">
                {heading(t("Apps"), "/apps")}
                {editing
                  ? apps.map((a, i) => (
                      <li
                        key={a.href}
                        {...dnd(
                          "apps",
                          apps.map((x) => x.href),
                          a.href,
                          async (from) => {
                            if (apps.find((x) => x.href === from)?.place !== a.place) await saveMenuAction({ href: from, place: a.place });
                          },
                        )}
                        className={`flex items-center gap-2 rounded-md px-3 py-1.5 ${a.place === "hidden" ? "opacity-50" : ""} ${dropMark(a.href)}`}
                      >
                        {/* Among the apps in the same place: the header's tabs, the menu's apps. */}
                        {arrows(
                          a.label,
                          apps.map((x) => x.href),
                          i,
                          (k) => apps.find((x) => x.href === k)?.place === a.place,
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.label}</span>
                        <span className="flex overflow-hidden rounded-md border border-zinc-200 text-[11px] dark:border-zinc-700" role="group" aria-label={t("{label}: where", { label: a.label })}>
                          {(["header", "menu", "hidden"] as const).map((p) => (
                            <button
                              key={p}
                              type="button"
                              disabled={saving}
                              aria-pressed={a.place === p}
                              onClick={() => save({ href: a.href, place: p })}
                              className={`px-1.5 py-0.5 ${a.place === p ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                            >
                              {p === "header" ? t("Header") : p === "menu" ? t("Menu") : t("Off")}
                            </button>
                          ))}
                        </span>
                      </li>
                    ))
                  : (() => {
                      const inMenuApps = apps.filter((a) => a.place === "menu");
                      return inMenuApps.length ? inMenuApps.map((l) => item(l)) : <li className="px-3 py-1 text-xs text-zinc-400">{t("All apps are in the header.")}</li>;
                    })()}
                {pluginGroups.length > 0 && heading(t("Plugins"))}
                {pluginGroups
                  .map((g) => (editing ? g : { ...g, items: g.items.filter((i) => !isHidden(i.href)) }))
                  .filter((g) => g.items.length)
                  .map((g) =>
                  g.items.length === 1 && !editing ? (
                    item({ ...g.items[0], label: g.items[0].label === "Settings" || g.items[0].label === t("Settings") ? g.name : g.items[0].label })
                  ) : (
                    <li
                      key={g.id}
                      {...dnd(
                        "groups",
                        pluginGroups.map((x) => `group:${x.id}`),
                        `group:${g.id}`,
                      )}
                      className={editing ? `flex flex-wrap items-center rounded-md ${dropMark(`group:${g.id}`)}` : undefined}
                    >
                      {editing && <span className="pl-3">{arrows(g.name, pluginGroups.map((x) => `group:${x.id}`), pluginGroups.indexOf(g))}</span>}
                      <button
                        type="button"
                        onClick={() => toggle(g.id)}
                        aria-expanded={expanded.has(g.id)}
                        className={`flex ${editing ? "min-w-0 flex-1" : "w-full"} cursor-pointer items-center justify-between rounded-md px-3 py-1.5 text-left text-sm font-medium transition hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:hover:bg-zinc-800`}
                      >
                        {g.name}
                        <ChevronIcon open={expanded.has(g.id)} className="size-3.5 text-zinc-400" />
                      </button>
                      {(expanded.has(g.id) || editing) && (
                        <ul className="w-full space-y-0.5">
                          {g.items.map((l, i) =>
                            item(
                              l,
                              true,
                              g.items.map((x) => x.href),
                              i,
                            ),
                          )}
                        </ul>
                      )}
                    </li>
                  ),
                )}
                {heading("Zeff")}
                {editing
                  ? zeff.map((l, i) =>
                      item(
                        l,
                        false,
                        zeff.map((x) => x.href),
                        i,
                      ),
                    )
                  : zeff.filter((l) => !isHidden(l.href)).map((l) => item(l))}
              </ul>
              <div className="mt-3 border-t border-zinc-200 px-3 pt-2 dark:border-zinc-800">
                <button type="button" className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200" onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
                  {editing ? t("Done") : t("Customize menu")}
                </button>
                {editing && (
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {t(
                      "Apps: into the header, into the menu or off. The other items: show or hide them. Drag the handle (or focus it and press ↑/↓) to reorder — for apps that is also the order of the tabs at the top; an app dragged onto one in the header moves into the header.",
                    )}
                  </p>
                )}
              </div>
            </nav>
          </div>
        </>
      )}
    </>
  );
}
