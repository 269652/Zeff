"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useMenuKeys } from "@/components/useMenuKeys";
import { linkEntryAction, unlinkEntryAction } from "@/app/entry-group-actions";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { setSpanModeAction, ungroupSpanAction } from "@/app/parallel-actions";
import { modeText } from "./ParallelControls";
import type { GroupOption } from "@/lib/entry-parallel";
import { useDismiss } from "@/components/useDismiss";

const GroupIcon = ({ filled }: { filled: boolean }) =>
  filled ? (
    <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
      <path d="M10 2.5 2.5 6.4 10 10.3l7.5-3.9L10 2.5Z" />
      <path d="m2.5 10 7.5 3.9 7.5-3.9-1.6-.8-5.9 3.1-5.9-3.1L2.5 10Z" opacity=".75" />
      <path d="m2.5 13.4 7.5 3.9 7.5-3.9-1.6-.8-5.9 3.1-5.9-3.1-1.6.8Z" opacity=".5" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="10" cy="10" r="6.5" />
    </svg>
  );

/**
 * The group mark of an entry, beside its words: a group icon when it is grouped (or is a group's own
 * entry), an empty circle when it could be grouped (a group exists that day), nothing otherwise. Click it:
 *  - a grouped entry or a group's own entry: how the group books — all on the group, the time divided on its
 *    tasks, sequential, sequential with the remainder on the group (the last one for a collecting entry of yours) —,
 *    and Ungroup; a task also the day's groups (its own ticked: pick another to move it) and "leave";
 *  - a loose entry: the groups it can join.
 * A day can have several groups.
 */
export function GroupMenu({ entryId, currentSpanId, headOfSpan, options }: { entryId: number; currentSpanId: string | null; /** This entry is the head of that group. */ headOfSpan: string | null; options: GroupOption[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // The menu floats over the page (fixed, at the icon): inside the table's scrolling container it would be cut off or make it scroll.
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [pending, start] = useTransition();
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuKeys(open, menu, button, () => setOpen(false));
  useDismiss(box, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // (the page scrolling away from the icon closes it; the menu's own list scrolling does not)
    const scrolled = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);
  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) {
      const width = Math.min(320, window.innerWidth - 16);
      // (below the icon, its right edge level with the icon's; up instead when there is no room below)
      const top = r.bottom + 4 + 360 > window.innerHeight && r.top > 380 ? Math.max(8, r.top - 4 - 360) : r.bottom + 4;
      setPos({ top, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
    }
    setOpen((o) => !o);
  };

  // The group this entry is the head of, or belongs to: how it books is chosen here.
  const grp = options.find((o) => o.spanId === (headOfSpan ?? currentSpanId));
  const grouped = !!currentSpanId || !!headOfSpan;
  if (!grouped && !options.length) return null;
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string } | null>) =>
    start(async () => {
      const r = await fn();
      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
      setOpen(false);
      router.refresh();
    });
  const m = modeText(t);
  // The ways a group books: a collecting entry of yours has all four; parallel work (or a combined entry of Zeff's) three.
  const ways = grp?.headOwn ? (["collect", "divide", "sequential", "remainder"] as const) : (["combine", "divide", "sequential"] as const);
  const active = grp?.mode === "combine" && grp.headOwn ? "collect" : grp?.mode;
  const row = "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-50 disabled:opacity-60 dark:hover:bg-zinc-800";
  const heading = "px-2 pt-1 pb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase";

  return (
    <span ref={box} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        className={`inline-flex size-6 items-center justify-center rounded transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${grouped ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-400 hover:text-indigo-600 dark:text-zinc-500"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={grouped ? t("Group") : t("Not grouped — click to join a group")}
        title={grouped ? (headOfSpan ? t("This is a group's entry — click for how it books") : t("In a group — click to change it")) : t("Not grouped — click to join a group of this day")}
        onClick={toggle}
      >
        <GroupIcon filled={grouped} />
      </button>
      {open && (
        <div ref={menu} role="menu" style={{ position: "fixed", top: pos.top, left: pos.left }} className="z-50 max-h-[80vh] w-80 max-w-[calc(100vw-1rem)] overflow-auto rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {grp && (
            <>
              <p className={heading}>{t("How this group books")}</p>
              {ways.map((w) => (
                <button key={w} type="button" role="menuitemradio" aria-checked={w === active} disabled={pending} className={`${row} ${w === active ? "bg-indigo-50 dark:bg-indigo-950/50" : ""}`} onClick={() => w !== active && run(() => setSpanModeAction(grp.spanId, w))}>
                  <span className="mt-0.5 w-3 shrink-0 text-indigo-600">{w === active ? "✓" : ""}</span>
                  <span>
                    <span className="block font-medium">{m[w].label}</span>
                    <span className="block text-xs text-zinc-500">{m[w].what}</span>
                  </span>
                </button>
              ))}
            </>
          )}
          {!headOfSpan && options.length > 0 && (
            <>
              <p className={`${heading} ${grp ? "mt-1 border-t border-zinc-100 pt-2 dark:border-zinc-800" : ""}`}>{grouped ? t("In group") : t("Join a group")}</p>
              {options.map((o) => {
                const on = o.spanId === currentSpanId;
                return (
                  <button key={o.spanId} type="button" role="menuitemradio" aria-checked={on} disabled={pending} className={`${row} ${on ? "bg-indigo-50 dark:bg-indigo-950/50" : ""}`} onClick={() => !on && run(() => linkEntryAction(entryId, o.spanId))}>
                    <span className="mt-0.5 w-3 shrink-0 text-indigo-600">{on ? "✓" : ""}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{o.label}</span>
                      <span className="block text-xs text-zinc-500">{o.kind === "collect" ? t("Collecting entry") : t("Parallel work")}</span>
                    </span>
                  </button>
                );
              })}
            </>
          )}
          {currentSpanId && (
            <button type="button" role="menuitem" disabled={pending} className={`${row} mt-1 border-t border-zinc-100 dark:border-zinc-800`} onClick={() => run(() => unlinkEntryAction(entryId))}>
              <span className="w-3 shrink-0" />
              {t("Leave the group — book it on its own")}
            </button>
          )}
          {grp && (
            <button type="button" role="menuitem" disabled={pending} className={`${row} ${currentSpanId ? "" : "mt-1 border-t border-zinc-100 dark:border-zinc-800"} text-red-700 dark:text-red-400`} onClick={() => confirmAction(t("Ungroup? Every entry books what it worked again.")) && run(() => ungroupSpanAction(grp.spanId))}>
              <span className="w-3 shrink-0" />
              {t("Ungroup")}
            </button>
          )}
        </div>
      )}
    </span>
  );
}
