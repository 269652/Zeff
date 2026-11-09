"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { Markdown } from "@/components/Markdown";
import { SnapshotFrame, WidgetFrame } from "@/components/widgets/WidgetFrame";
import { useRunLog } from "@/components/work/SessionThread";
import { formatDateTime } from "@/lib/format";
import type { WorkLogLine } from "@/lib/work/shared";
import { buildTimeline, type TimelineItem, type TimelineResult } from "../timeline";
import { useWidgetResults } from "./LessonWidgets";

export type TimelineRun = { id: number; startedAt: string; prompts: string[]; active: boolean; live: boolean };
export type TimelineWidget = { id: number; title: string; html: string; libs: string[]; createdAt: string; bestScore: number | null };

/** One run's log, as it comes (polled while it runs) — handed up to the timeline. */
function RunFeed({ run, onLines }: { run: TimelineRun; onLines: (id: number, lines: WorkLogLine[]) => void }) {
  const { lines } = useRunLog(run.id, run.active, run.live);
  useEffect(() => onLines(run.id, lines), [run.id, lines, onLines]);
  return null;
}

/**
 * A lesson as a timeline down a line: left of it you — your messages, the exercises (the newest one to do right here,
 * the earlier ones a tap away) and how you did each time (every answer, right or wrong); right of it the teacher's
 * explanations. Sessions and the step mastered sit on the line. Scroll back to see how you solved what was asked.
 */
export function LessonTimeline({ runs, widgets, results, sessionRunId }: { runs: TimelineRun[]; widgets: TimelineWidget[]; results: TimelineResult[]; sessionRunId?: number }) {
  const t = useT();
  const [logs, setLogs] = useState<Record<number, WorkLogLine[]>>({});
  const onLines = useCallback((id: number, lines: WorkLogLine[]) => setLogs((l) => (l[id] === lines ? l : { ...l, [id]: lines })), []);
  const items = useMemo(
    () => buildTimeline({ runs: runs.map((r) => ({ id: r.id, startedAt: r.startedAt, prompts: r.prompts, lines: logs[r.id] ?? [] })), widgets, results }),
    [runs, widgets, results, logs],
  );
  const byId = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);
  // The newest exercise is open to do; earlier ones fold (opened again on a tap).
  const lastWidget = [...items].reverse().find((i) => i.kind === "widget");
  const onResult = useWidgetResults(sessionRunId);

  // Follow the end while new things come (unless you scrolled up to read).
  const end = useRef<HTMLDivElement>(null);
  const count = items.length;
  useEffect(() => {
    const box = end.current?.closest("[data-timeline-scroll]") as HTMLElement | null;
    if (!box) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 400) end.current?.scrollIntoView({ block: "end" });
  }, [count]);

  return (
    <div className="relative">
      {runs.map((r) => (
        <RunFeed key={r.id} run={r} onLines={onLines} />
      ))}
      {/* The line itself: down the middle on a wide screen, at the left on a phone. */}
      <div className="absolute top-0 bottom-0 left-3 w-px bg-zinc-200 md:left-1/2 dark:bg-zinc-800" aria-hidden />
      <ol className="relative space-y-3" aria-label={t("The lesson so far")}>
        {items.map((it, i) => (
          <li key={i} className={rowClass(it)}>
            {it.side !== "center" && <Dot item={it} />}
            <Item item={it} widget={it.kind === "widget" || it.kind === "result" ? byId.get(it.widgetId ?? -1) : undefined} open={it === lastWidget} onResult={onResult} />
          </li>
        ))}
      </ol>
      <div ref={end} />
    </div>
  );
}

/** Where a row sits: left of the line, right of it, or on it (on a phone: all right of the line at the left edge). */
const rowClass = (it: TimelineItem) =>
  it.side === "center"
    ? "relative flex justify-start pl-8 md:justify-center md:pl-0"
    : it.side === "left"
      ? "relative pl-8 md:w-1/2 md:pr-8 md:pl-0"
      : "relative pl-8 md:ml-auto md:w-1/2 md:pl-8";

function Dot({ item }: { item: TimelineItem }) {
  const tone = item.kind === "result" ? scoreTone(item.score).dot : item.side === "left" ? "bg-indigo-500" : item.side === "right" ? "bg-zinc-400 dark:bg-zinc-500" : "bg-emerald-500";
  const pos = item.side === "center" ? "md:left-1/2" : item.side === "left" ? "md:right-0 md:left-auto md:translate-x-1/2" : "md:left-0";
  return <span className={`absolute top-3 left-3 size-2.5 -translate-x-1/2 rounded-full ring-4 ring-white dark:ring-zinc-950 ${tone} ${pos}`} aria-hidden />;
}

const scoreTone = (s: number) =>
  s >= 0.8
    ? { dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" }
    : s >= 0.5
      ? { dot: "bg-amber-500", badge: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" }
      : { dot: "bg-red-500", badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" };

function Item({ item, widget, open, onResult }: { item: TimelineItem; widget?: TimelineWidget; open: boolean; onResult: ReturnType<typeof useWidgetResults> }) {
  const t = useT();
  switch (item.kind) {
    case "session":
      return <span className="rounded-full border border-zinc-200 bg-white px-3 py-0.5 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">{formatDateTime(item.at)}</span>;
    case "mastered":
      return <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">✓ {t("Step mastered")}</span>;
    case "you":
      return (
        <div className="rounded-xl rounded-tl-sm bg-indigo-50 px-3 py-2 text-sm dark:bg-indigo-950/40" aria-label={t("You")}>
          <Markdown text={item.text} />
        </div>
      );
    case "say":
      return (
        <div className="rounded-xl rounded-tl-sm border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900" aria-label={t("Teacher")}>
          <Markdown text={item.text} className="text-zinc-800 dark:text-zinc-200" />
        </div>
      );
    case "widget":
      if (!widget) return null;
      return open ? (
        <section className="space-y-1.5 rounded-xl border border-indigo-200 bg-white p-2 dark:border-indigo-900 dark:bg-zinc-900" aria-label={widget.title}>
          <h3 className="px-1 text-sm font-semibold">🧪 {widget.title}</h3>
          <WidgetFrame html={widget.html} libs={widget.libs} title={widget.title} onResult={(r) => void onResult(widget, r)} />
        </section>
      ) : (
        <details className="rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
          <summary className="cursor-pointer px-1 text-sm font-semibold">
            🧪 {widget.title}
            {widget.bestScore !== null && <span className="ml-2 text-xs font-normal text-zinc-500">{t("best {n}%", { n: Math.round(widget.bestScore * 100) })}</span>}
          </summary>
          <div className="mt-2">
            <WidgetFrame html={widget.html} libs={widget.libs} title={widget.title} onResult={(r) => void onResult(widget, r)} />
          </div>
        </details>
      );
    case "result": {
      const tone = scoreTone(item.score);
      return (
        <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900" aria-label={t("Result: {title}", { title: item.title })}>
          <header className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 font-semibold">✍️ {item.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone.badge}`}>
              {item.correct !== undefined && item.total ? t("{correct} of {total} right", { correct: item.correct, total: item.total }) : `${Math.round(item.score * 100)} %`}
            </span>
          </header>
          {item.answers && item.answers.length > 0 && (
            <ol className="space-y-1">
              {item.answers.map((a, k) => (
                <li key={k} className="flex gap-2">
                  <span className={`shrink-0 font-bold ${a.ok === true ? "text-emerald-600" : a.ok === false ? "text-red-600" : "text-zinc-400"}`} aria-label={a.ok === true ? t("right") : a.ok === false ? t("wrong") : undefined}>
                    {a.ok === true ? "✓" : a.ok === false ? "✗" : "·"}
                  </span>
                  <span className="min-w-0">
                    <span className="text-zinc-500">{a.q}</span> → <span className="font-medium">{a.a}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {item.note && <p className="text-xs text-zinc-500">{item.note}</p>}
          {item.snapshotId && <Snapshot id={item.snapshotId} />}
          {item.at && <p className="text-[11px] text-zinc-400">{formatDateTime(item.at)}</p>}
        </section>
      );
    }
  }
}


/** A try as the widget looked then (its drawing, what was typed): opened on a tap, fetched then. */
function Snapshot({ id }: { id: number }) {
  const t = useT();
  const [snap, setSnap] = useState<{ html: string; title: string; libs: string[] } | null | "loading">(null);
  return (
    <details
      className="rounded-lg border border-zinc-200 dark:border-zinc-800"
      onToggle={(e) => {
        if (!(e.currentTarget as HTMLDetailsElement).open || snap) return;
        setSnap("loading");
        void fetch(`/api/learn/snapshots/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => setSnap(s));
      }}
    >
      <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">🖼 {t("As it looked")}</summary>
      <div className="p-1.5">{snap === "loading" ? <p className="text-xs text-zinc-500">…</p> : snap ? <SnapshotFrame html={snap.html} libs={snap.libs} title={snap.title} /> : null}</div>
    </details>
  );
}
