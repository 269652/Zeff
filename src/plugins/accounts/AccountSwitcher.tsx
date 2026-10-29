"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useMenuKeys } from "@/components/useMenuKeys";
import { switchAccountAction } from "@/plugins/accounts/server-actions";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";

export type AccountChip = { id: string; name: string; color: string; /** Its own address (Settings → Accounts): switching opens it there — the other tab keeps the one before. */ host?: string };

/** The same page at an account's own address (its host, this port and scheme). */
export const accountUrl = (host: string, path?: string) => {
  const here = window.location;
  return `${here.protocol}//${host}${here.port ? `:${here.port}` : ""}${path ?? `${here.pathname}${here.search}`}`;
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
  const [pending, start] = useTransition();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuKeys(open, menu, button, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const go = (id: string) => {
    // An account at its own address: the same page there (both run side by side — this one stays as it is).
    const target = list.find((a) => a.id === id);
    if (target?.host) {
      setOpen(false);
      window.location.assign(accountUrl(target.host));
      return;
    }
    // The one account without an address while the others have theirs: it is every other address (localhost) — opened there, not switched to.
    if (target && list.filter((a) => !a.host).length === 1 && list.some((a) => a.host)) {
      setOpen(false);
      if (list.some((a) => a.host === window.location.hostname)) window.location.assign(accountUrl("localhost"));
      return;
    }
    start(async () => {
      const r = await switchAccountAction(id);
      if (!r.ok) {
        toast(r.error ?? t("That didn't work."), { tone: "error" });
        return;
      }
      setOpen(false);
      toast(r.message ?? t("Switched."), { tone: "ok" });
      router.push(r.href ?? "/");
      router.refresh();
    });
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
        disabled={pending}
        title={t("Account: {name} — switch", { name: current.name })}
      >
        <span className={`size-2 shrink-0 rounded-full ${dotOf(current.color)}`} aria-hidden />
        <span className="truncate">{pending ? t("switching…") : current.name}</span>
      </button>
      {open && (
        <div ref={menu} role="menu" className="absolute top-full left-0 z-50 mt-1 w-56 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {list.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitemradio"
              aria-checked={a.id === current.id}
              disabled={pending}
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
