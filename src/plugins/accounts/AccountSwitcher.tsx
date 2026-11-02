"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMenuKeys } from "@/components/useMenuKeys";
import { useT } from "@/components/I18nProvider";
import { useDismiss } from "@/components/useDismiss";
import { DEFAULT_SLUG, PREFIX_ATTR, stripPrefix, withPrefix } from "@/lib/account-routes";

export type AccountChip = {
  id: string;
  name: string;
  color: string;
  /** Its route ("/privat"; "" the first account's): switching opens the same page there — the other tab keeps the one before. */
  prefix: string;
  /** A host of its own (Settings → Accounts), the older way: still served, not where switching goes. */
  host?: string;
};

/**
 * The same page (or `path`) in another account: under its prefix, on this host — or on localhost when this host is an
 * account's own (an unprefixed URL there would be that account's; the first account's "/standard" alias is used then).
 */
export const accountUrl = (target: { id: string; prefix: string }, hosts: (string | undefined)[], path?: string) => {
  const here = window.location;
  const mine = document.documentElement.getAttribute(PREFIX_ATTR) ?? "";
  const rest = path ?? `${stripPrefix(mine, here.pathname)}${here.search}${here.hash}`;
  const onHost = hosts.includes(here.hostname);
  const prefix = target.prefix || (onHost ? `/${DEFAULT_SLUG}` : "");
  const origin = onHost ? `${here.protocol}//localhost${here.port ? `:${here.port}` : ""}` : "";
  return `${origin}${withPrefix(prefix, rest)}`;
};

/** An account's color, as a dot (static class names, for Tailwind). */
export const ACCOUNT_DOT: Record<string, string> = {
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
};
export const dotOf = (color: string) => ACCOUNT_DOT[color] ?? ACCOUNT_DOT.indigo;

/** The header's account: which one you're in — click for the others, and to switch. */
export function AccountSwitcher({ current, list }: { current: AccountChip; list: AccountChip[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuKeys(open, menu, button, () => setOpen(false));

  useDismiss(box, open, () => setOpen(false));

  // Another account: the same page under its route, a page load (its own data, its own header) — this tab's account is the one
  // of its URL, so a switch never changes what another tab shows.
  const go = (id: string) => {
    const target = list.find((a) => a.id === id);
    if (!target) return;
    setOpen(false);
    window.location.assign(accountUrl(target, list.map((a) => a.host)));
  };

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        className="flex max-w-40 items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("Account: {name} — switch", { name: current.name })}
      >
        <span className={`size-2 shrink-0 rounded-full ${dotOf(current.color)}`} aria-hidden />
        <span className="truncate">{current.name}</span>
      </button>
      {open && (
        <div ref={menu} role="menu" className="absolute top-full left-0 z-50 mt-1 w-56 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {list.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitemradio"
              aria-checked={a.id === current.id}
              onClick={() => (a.id === current.id ? setOpen(false) : go(a.id))}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${a.id === current.id ? "font-semibold" : ""}`}
            >
              <span className={`size-2 shrink-0 rounded-full ${dotOf(a.color)}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              {a.id === current.id && <span className="text-xs text-zinc-500">{t("active")}</span>}
            </button>
          ))}
          <div role="separator" className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
          <Link href="/accounts" onClick={() => setOpen(false)} className="block rounded px-2 py-1.5 text-sm text-indigo-600 hover:bg-zinc-100 dark:text-indigo-400 dark:hover:bg-zinc-800" role="menuitem">
            {t("Manage accounts…")}
          </Link>
        </div>
      )}
    </div>
  );
}
