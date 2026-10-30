"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { ReviewItem, ReviewQueue } from "@/lib/review";
import { reviewKey } from "@/lib/review/keys";
import { reviewActAction } from "./actions";

type Group = { source: string; kind: string; rows: { item: ReviewItem; index: number }[] };

/**
 * The review queue's list: grouped by kind, an item a line with its evidence under it and its buttons. An answered
 * item goes at once (back, with the error, if it failed) and the next one has the focus — so the keys walk through
 * it: j/k or ↓/↑, y for the item's yes, n for no, e or Enter to open where it lives.
 */
export function ReviewList({ items, links, errors, scoped = false }: Pick<ReviewQueue, "items" | "links" | "errors"> & { /** On a page with more (Today): the keys only while the focus is in the list. */ scoped?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [cursor, setCursor] = useState(0);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const box = useRef<HTMLDivElement>(null);
  // The focus follows the cursor only after a key or an answer — not when the page loads or refreshes.
  const moved = useRef(false);
  const shown = useMemo(() => items.filter((i) => !gone.has(i.key)), [items, gone]);
  const at = Math.min(cursor, Math.max(0, shown.length - 1));
  const groups = useMemo(() => {
    const out: Group[] = [];
    shown.forEach((item, index) => {
      const last = out[out.length - 1];
      if (last?.source === item.source) last.rows.push({ item, index });
      else out.push({ source: item.source, kind: item.kind, rows: [{ item, index }] });
    });
    return out;
  }, [shown]);
  const waiting = shown.length + links.reduce((n, l) => n + l.count, 0);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const el = rows.current.get(shown[at]?.key ?? "");
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  }, [at, shown]);

  const act = useCallback(
    async (item: ReviewItem, action: string) => {
      moved.current = true;
      setGone((g) => new Set(g).add(item.key));
      const r = await reviewActAction(item.key, action);
      if (r && !r.ok) {
        setGone((g) => new Set([...g].filter((k) => k !== item.key)));
        toast(r.error ?? t("Failed."), { tone: "error" });
      } else if (r?.message) toast(r.message);
    },
    [t],
  );

  const open = useCallback(
    (item: ReviewItem) => {
      if (!item.href) return;
      if (item.href.startsWith("/")) router.push(item.href);
      else window.open(item.href, "_blank", "noopener");
    },
    [router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = reviewKey(e);
      if (!k || !shown.length || (scoped && !box.current?.contains(e.target as Node))) return;
      e.preventDefault();
      if (k === "next" || k === "prev") {
        moved.current = true;
        setCursor(Math.max(0, Math.min(shown.length - 1, at + (k === "next" ? 1 : -1))));
        return;
      }
      const item = shown[at];
      if (k === "open") return open(item);
      const a = k === "yes" ? item.actions.find((x) => x.primary) : item.actions.find((x) => x.id === "no");
      if (a) void act(item, a.id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shown, at, act, open, scoped]);

  return (
    <div ref={box} className="space-y-4">
      <section className="card p-4" aria-live="polite">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("{n} waiting", { n: waiting })}</h2>
        {waiting === 0 && <EmptyState variant="centered">{t("Nothing to review — all caught up.")}</EmptyState>}
        {links.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {links.map((l) => (
              <li key={l.id}>
                <Link href={l.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {l.label}
                </Link>{" "}
                <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 tabular-nums dark:bg-zinc-800">{l.count}</span>
              </li>
            ))}
          </ul>
        )}
        {errors.map((e) => (
          <p key={e.source} className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            {e.label}: {e.message}
          </p>
        ))}
      </section>
      {groups.map((g) => (
        <section key={g.source} className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-zinc-500 uppercase">
            {g.kind}
            <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-500 tabular-nums dark:bg-zinc-800">{g.rows.length}</span>
          </h2>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {g.rows.map(({ item, index }) => (
              <li
                key={item.key}
                ref={(el) => {
                  if (el) rows.current.set(item.key, el);
                  else rows.current.delete(item.key);
                }}
                tabIndex={index === at ? 0 : -1}
                aria-current={index === at ? "true" : undefined}
                onFocus={() => setCursor(index)}
                onClick={() => setCursor(index)}
                className={`flex flex-wrap items-start gap-x-3 gap-y-1 rounded px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${index === at ? "bg-indigo-50 dark:bg-indigo-950/40" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {item.href ? (
                      <Link href={item.href} className="hover:underline" tabIndex={-1}>
                        {item.title}
                      </Link>
                    ) : (
                      item.title
                    )}
                    {item.confidence !== undefined && <span className="ml-2 text-xs text-zinc-400 tabular-nums">{Math.round(item.confidence * 100)}%</span>}
                  </p>
                  {item.detail && <p className="mt-0.5 line-clamp-3 text-xs text-zinc-500">{item.detail}</p>}
                </div>
                <span className="flex shrink-0 gap-1">
                  {item.actions.map((a) => (
                    <button key={a.id} type="button" tabIndex={index === at ? 0 : -1} className={`btn btn-sm ${a.primary ? "btn-primary" : ""}`} onClick={() => void act(item, a.id)}>
                      {a.label}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
