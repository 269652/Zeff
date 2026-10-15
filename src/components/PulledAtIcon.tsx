"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { currentLocale, formatAgo } from "@/lib/format";
import { useT } from "./I18nProvider";

/** How long ago `then` was, as of now — read when the tooltip opens (an event, never during render). */
const ageOf = (then: Date) => formatAgo(then);

type Tip = { top?: number; bottom?: number; right: number; age: string | null };

const TONE = { blue: "text-blue-600 dark:text-blue-400", emerald: "text-emerald-600 dark:text-emerald-400" };

/**
 * The icon at the end of a "Pull …" button: a check when Zeff and the source are in sync, else
 * a clock (dashed while never pulled). Hover it for when the status was last pulled, how long
 * ago, and what the button reads. The tooltip is rendered into <body> (fixed, under the icon —
 * above it near the window's bottom), so no card or scroll box clips it.
 */
export function PulledAtIcon({
  source,
  pulledAt,
  reads,
  synced = false,
  syncedNote,
  tone = "emerald",
}: {
  source: string;
  pulledAt: string | null;
  reads: string;
  /** Everything is in the source as in Zeff (as of the last pull). */
  synced?: boolean;
  /** What "in sync" means here, for the tooltip. */
  syncedNote?: string;
  tone?: keyof typeof TONE;
}) {
  const t = useT();
  const [tip, setTip] = useState<Tip | null>(null);
  const pulled = pulledAt ? new Date(pulledAt) : null;
  const inSync = synced && !!pulled;

  const show = (e: React.MouseEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    setTip({
      ...(window.innerHeight - r.bottom > 120 ? { top: r.bottom + 8 } : { bottom: window.innerHeight - r.top + 8 }),
      right: Math.max(8, width - r.right - 6),
      age: pulled ? ageOf(pulled) : null,
    });
  };

  return (
    <span className="-mr-0.5 inline-flex" onMouseEnter={show} onMouseLeave={() => setTip(null)}>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`size-3.5 ${inSync ? TONE[tone] : pulled ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-300 dark:text-zinc-600"}`}
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.25" strokeDasharray={pulled ? undefined : "2.5 2.5"} />
        {inSync ? <path d="M7 10.5l2 2 4-4.5" /> : <path d="M10 6v4.25l2.75 1.75" />}
      </svg>
      {tip &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: "fixed", top: tip.top, bottom: tip.bottom, right: tip.right }}
            className="pointer-events-none z-[100] w-max max-w-64 rounded-md bg-zinc-900 px-2.5 py-1.5 text-left text-xs leading-snug font-normal text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
          >
            <span className="block font-medium">
              {pulled
                ? t("{source} status from {when}", {
                    source,
                    when: pulled.toLocaleString(currentLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                  })
                : t("Not pulled from {source} yet", { source })}
              {tip.age && <span className="font-normal opacity-75"> · {tip.age}</span>}
            </span>
            {inSync && syncedNote && <span className="block">✓ {syncedNote}</span>}
            <span className="block opacity-75">{reads}</span>
          </span>,
          document.body,
        )}
    </span>
  );
}
