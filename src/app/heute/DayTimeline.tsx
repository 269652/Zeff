"use client";

import { useEffect, useState } from "react";
import { formatTime } from "@/lib/format";

type Span = { from: number; to: number };
type Block = { subject: string; start: number; end: number; online: boolean };

/** Position in the frame, 0–100. */
const pct = (ms: number, f: Span) => Math.max(0, Math.min(100, ((ms - f.from) / (f.to - f.from)) * 100));

/**
 * The day as a strip of time: the meetings as blocks, the free windows as dashed gaps, what has
 * passed dimmed, and a "now" line that moves by itself. `labels` are the page's (translated) texts.
 */
export function DayTimeline({ frame, meetings, windows, initialNow, labels }: { frame: Span; meetings: Block[]; windows: (Span & { text: string })[]; initialNow: number; labels: { now: string; online: string } }) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const hours: number[] = [];
  for (let h = new Date(frame.from).getHours(); new Date(frame.from).setHours(h, 0, 0, 0) <= frame.to; h++) {
    const ms = new Date(frame.from).setHours(h, 0, 0, 0);
    if (ms >= frame.from) hours.push(ms);
  }
  const inFrame = now >= frame.from && now <= frame.to;
  const nowAt = pct(now, frame);

  return (
    <div className="select-none">
      <div className="relative h-20 overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-zinc-200 dark:bg-zinc-800/60 dark:ring-zinc-700">
        {/* grid: one line per hour */}
        {hours.map((h) => (
          <div key={h} className="absolute inset-y-0 w-px bg-zinc-200 dark:bg-zinc-700/70" style={{ left: `${pct(h, frame)}%` }} />
        ))}
        {/* free windows: where focused work fits */}
        {windows.map((w) => (
          <div
            key={w.from}
            className="absolute inset-y-2 flex items-end justify-center overflow-hidden rounded-md border border-dashed border-emerald-400/70 bg-emerald-400/10 pb-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
            style={{ left: `${pct(w.from, frame)}%`, width: `${pct(w.to, frame) - pct(w.from, frame)}%` }}
            title={`${formatTime(w.from)}–${formatTime(w.to)}`}
          >
            <span className="truncate px-1">{w.text}</span>
          </div>
        ))}
        {/* meetings */}
        {meetings.map((m) => {
          const past = m.end < now;
          const live = now >= m.start && now < m.end;
          return (
            <div
              key={`${m.start}-${m.subject}`}
              className={`absolute top-2 h-9 overflow-hidden rounded-md border px-1.5 py-0.5 text-xs leading-tight shadow-sm ${
                live
                  ? "border-indigo-500 bg-indigo-500 text-white"
                  : past
                    ? "border-zinc-300 bg-zinc-200/80 text-zinc-500 dark:border-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-400"
                    : "border-indigo-300 bg-indigo-100 text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100"
              }`}
              style={{ left: `${pct(m.start, frame)}%`, width: `max(${pct(m.end, frame) - pct(m.start, frame)}%, 0.5rem)` }}
              title={`${formatTime(m.start)}–${formatTime(m.end)} · ${m.subject}${m.online ? ` · ${labels.online}` : ""}`}
            >
              <div className="truncate font-medium">{m.subject}</div>
              <div className="truncate opacity-75 tabular-nums">{formatTime(m.start)}</div>
            </div>
          );
        })}
        {/* what has passed */}
        {inFrame && <div className="pointer-events-none absolute inset-y-0 left-0 bg-white/40 dark:bg-zinc-950/30" style={{ width: `${nowAt}%` }} />}
        {/* now */}
        {inFrame && (
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-500 transition-[left] duration-1000" style={{ left: `${nowAt}%` }}>
            <span className="absolute -top-0 -left-[3px] size-2 rounded-full bg-rose-500 ring-2 ring-rose-300/60 motion-safe:animate-pulse" />
            <span className="absolute bottom-0.5 left-1 rounded bg-rose-500 px-1 text-xs font-semibold text-white">{labels.now}</span>
          </div>
        )}
      </div>
      <div className="relative mt-1 h-4 text-xs text-zinc-400 tabular-nums">
        {hours.map((h, i) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${pct(h, frame)}%`, ...(i === 0 ? { transform: "none" } : {}) }}>
            {new Date(h).getHours()}
          </span>
        ))}
      </div>
    </div>
  );
}
