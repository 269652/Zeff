"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkLogLine } from "@/lib/work/shared";
import { useT } from "../I18nProvider";
import { Markdown } from "../Markdown";
import { EditDiff } from "./Diff";

type Variant = "chat" | "terminal";

/** Its colours: a session's page reads like a conversation (Claude Code's), a run's box like a terminal. */
const STYLE: Record<Variant, Record<string, string>> = {
  terminal: {
    box: "bg-zinc-950 p-2.5 font-mono text-xs leading-snug text-zinc-300",
    start: "text-zinc-500",
    say: "font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-zinc-100",
    chip: "bg-zinc-800 text-sky-300",
    tool: "text-zinc-300",
    out: "text-zinc-500",
    err: "text-red-400",
    deny: "text-amber-400",
    note: "text-zinc-500",
    raw: "whitespace-pre-wrap text-zinc-400",
    user: "rounded-lg bg-indigo-950/60 px-2.5 py-1.5 font-sans text-[13px] whitespace-pre-wrap text-indigo-100",
    ask: "rounded bg-amber-950/50 px-2 py-1 text-amber-200",
    shell: "rounded bg-zinc-900 px-2 py-1",
  },
  chat: {
    box: "bg-white p-3 text-sm leading-relaxed text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800",
    start: "font-mono text-[11px] text-zinc-400",
    say: "",
    chip: "bg-zinc-100 text-sky-700 dark:bg-zinc-800 dark:text-sky-300",
    tool: "font-mono text-xs text-zinc-600 dark:text-zinc-300",
    out: "font-mono text-xs text-zinc-500",
    err: "font-mono text-xs text-red-600 dark:text-red-400",
    deny: "text-xs text-amber-700 dark:text-amber-400",
    note: "text-center text-[11px] text-zinc-400",
    raw: "font-mono text-xs whitespace-pre-wrap text-zinc-500",
    user: "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 whitespace-pre-wrap text-white",
    ask: "rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
    shell: "rounded-lg bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-200",
  },
};

/** Something long, folded: its first words, the rest on a click. */
function Fold({ summary, children, className = "" }: { summary: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <details className={className}>
      <summary className="cursor-pointer select-none marker:text-zinc-400">{summary}</summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}

/** One log line. */
function Line({ l, v }: { l: WorkLogLine; v: Variant }) {
  const t = useT();
  const s = STYLE[v];
  switch (l.k) {
    case "start":
      return <div className={s.start}>▶ {l.text}</div>;
    case "say":
      return v === "chat" ? <Markdown text={l.text} /> : <div className={s.say}>{l.text}</div>;
    case "you": {
      const long = l.text.length > 1200;
      return (
        <div className={s.user}>
          {long ? (
            <Fold summary={`${l.text.slice(0, 300)}…`}>
              <div className="whitespace-pre-wrap">{l.text}</div>
            </Fold>
          ) : (
            l.text
          )}
          {l.images ? <span className="mt-1 block text-xs opacity-80">🖼 {t("{n} image(s)", { n: l.images })}</span> : null}
        </div>
      );
    }
    case "tool": {
      const head = (
        <>
          <span className={`mr-1.5 rounded px-1 text-[11px] ${s.chip}`}>{l.tool}</span>
          <span className="break-all">{l.text}</span>
        </>
      );
      if (l.diff?.length)
        return (
          <Fold className={s.tool} summary={head}>
            <div className="space-y-1">
              {l.diff.map((d, i) => (
                <EditDiff key={i} old={d.old} new={d.new} />
              ))}
            </div>
          </Fold>
        );
      if (l.detail)
        return (
          <Fold className={s.tool} summary={head}>
            {l.tool === "ExitPlanMode" && v === "chat" ? <Markdown text={l.detail} /> : <pre className="max-h-96 overflow-auto font-mono text-xs whitespace-pre-wrap">{l.detail}</pre>}
          </Fold>
        );
      return <div className={s.tool}>{head}</div>;
    }
    case "out": {
      const head = (
        <>
          {l.error ? "✗ " : "↳ "}
          {l.text}
        </>
      );
      return l.full ? (
        <Fold className={`pl-4 ${l.error ? s.err : s.out}`} summary={head}>
          <pre className="max-h-96 overflow-auto rounded bg-zinc-950 p-2 text-[11px] whitespace-pre-wrap text-zinc-300">{l.full}</pre>
        </Fold>
      ) : (
        <div className={`pl-4 ${l.error ? s.err : s.out}`}>{head}</div>
      );
    }
    case "ask":
      return (
        <div className={s.ask}>
          ❓ {l.text}
          {l.answer ? <span className={`ml-2 font-semibold ${l.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>→ {l.answer}</span> : <span className="ml-2 opacity-70">{t("(waiting)")}</span>}
        </div>
      );
    case "shell":
      return (
        <Fold className={s.shell} summary={<span className={l.ok ? "text-amber-300" : "text-red-300"}>! {l.cmd}</span>}>
          <pre className="max-h-96 overflow-auto text-[11px] whitespace-pre-wrap text-zinc-300">{l.text || t("(no output)")}</pre>
        </Fold>
      );
    case "note":
      return <div className={s.note}>— {l.text} —</div>;
    case "deny":
      return <div className={s.deny}>⛔ {t("refused")} — {l.text}</div>;
    case "end":
      return <div className={`font-semibold ${l.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{l.ok ? "■" : "✗"} {l.text}</div>;
    default:
      return <div className={s.raw}>{(l as { text?: string }).text}</div>;
  }
}

/**
 * A run's log, as it happens: read from where it was while the run goes (only the new lines —
 * every 0.7 s for a live session, else 1.5 s), kept scrolled to the end unless you scroll up.
 * Then it stays as it ended.
 */
export function RunLog({ id, fill = false, live = false }: { id: number; /** The whole height it's given (a session's page), not a box — read like a conversation. */ fill?: boolean; live?: boolean }) {
  const t = useT();
  const v: Variant = fill ? "chat" : "terminal";
  const [lines, setLines] = useState<WorkLogLine[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const next = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let on = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        // A live session's recent lines can change (your answer added to its question): its last 50 read again.
        const from = live ? Math.max(0, next.current - 50) : next.current;
        const r = await fetch(`/api/work/${id}/log?from=${from}`, { cache: "no-store" });
        if (!on) return;
        if (!r.ok) {
          timer = setTimeout(load, 5000);
          return;
        }
        const j = (await r.json()) as { status: string; lines: WorkLogLine[]; next: number; errors: string[] };
        if (!on) return;
        if (live) setLines((l) => (JSON.stringify(l.slice(from)) === JSON.stringify(j.lines) ? l : [...l.slice(0, from), ...j.lines]));
        else if (j.lines.length) setLines((l) => [...l, ...j.lines]);
        next.current = j.next;
        setErrors(j.errors ?? []);
        setLoaded(true);
        if (j.status === "queued" || j.status === "running") timer = setTimeout(load, live ? 700 : 1500);
      } catch {
        if (on) timer = setTimeout(load, 5000);
      }
    };
    load();
    return () => {
      on = false;
      if (timer) clearTimeout(timer);
    };
  }, [id, live]);

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
      className={`${fill ? "min-h-0 flex-1 space-y-2" : "max-h-96 space-y-1"} flex flex-col overflow-auto rounded-md break-words ${STYLE[v].box}`}
      role="log"
      aria-live="polite"
      aria-label={t("Worker log")}
    >
      {lines.map((l, i) => (
        <Line key={i} l={l} v={v} />
      ))}
      {errors.length > 0 && (
        <div className="mt-1 border-t border-zinc-300 pt-1 font-mono text-xs text-red-600 dark:border-zinc-800 dark:text-red-300/80">
          {errors.map((e, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {e}
            </div>
          ))}
        </div>
      )}
      {loaded && !lines.length && !errors.length && <div className="text-zinc-500">{t("Nothing in the log yet.")}</div>}
      {!loaded && <div className="text-zinc-500">{t("Loading…")}</div>}
    </div>
  );
}
