"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkLogLine } from "@/lib/work/shared";

/** One log line. */
function Line({ l }: { l: WorkLogLine }) {
  switch (l.k) {
    case "start":
      return <div className="text-zinc-500">▶ {l.text}</div>;
    case "say":
      return <div className="font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-zinc-100">{l.text}</div>;
    case "tool":
      return (
        <div className="text-zinc-300">
          <span className="mr-1.5 rounded bg-zinc-800 px-1 text-[11px] text-sky-300">{l.tool}</span>
          {l.text}
        </div>
      );
    case "out":
      return <div className={`pl-4 ${l.error ? "text-red-400" : "text-zinc-500"}`}>{l.error ? "✗ " : "↳ "}{l.text}</div>;
    case "deny":
      return <div className="text-amber-400">⛔ refused — {l.text}</div>;
    case "end":
      return <div className={`font-semibold ${l.ok ? "text-emerald-400" : "text-red-400"}`}>{l.ok ? "■" : "✗"} {l.text}</div>;
    default:
      return <div className="whitespace-pre-wrap text-zinc-400">{l.text}</div>;
  }
}

/**
 * A run's log, as it happens: read from where it was every 1.5 s while the run goes (only the
 * new lines), kept scrolled to the end unless you scroll up. Then it stays as it ended.
 */
export function RunLog({ id, fill = false }: { id: number; /** The whole height it's given (a session's page), not a box. */ fill?: boolean }) {
  const [lines, setLines] = useState<WorkLogLine[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const next = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const r = await fetch(`/api/work/${id}/log?from=${next.current}`, { cache: "no-store" });
        if (!live) return;
        if (!r.ok) {
          timer = setTimeout(load, 5000);
          return;
        }
        const j = (await r.json()) as { status: string; lines: WorkLogLine[]; next: number; errors: string[] };
        if (!live) return;
        if (j.lines.length) setLines((l) => [...l, ...j.lines]);
        next.current = j.next;
        setErrors(j.errors ?? []);
        setLoaded(true);
        if (j.status === "queued" || j.status === "running") timer = setTimeout(load, 1500);
      } catch {
        if (live) timer = setTimeout(load, 5000);
      }
    };
    load();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, errors]);

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className={`${fill ? "min-h-0 flex-1" : "max-h-96"} space-y-1 overflow-auto rounded-md bg-zinc-950 p-2.5 font-mono text-xs leading-snug break-words text-zinc-300`}
      role="log"
      aria-live="polite"
      aria-label="Worker log"
    >
      {lines.map((l, i) => (
        <Line key={i} l={l} />
      ))}
      {errors.length > 0 && (
        <div className="mt-1 border-t border-zinc-800 pt-1 text-red-300/80">
          {errors.map((e, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {e}
            </div>
          ))}
        </div>
      )}
      {loaded && !lines.length && !errors.length && <div className="text-zinc-500">Nothing in the log yet.</div>}
      {!loaded && <div className="text-zinc-500">Loading…</div>}
    </div>
  );
}
