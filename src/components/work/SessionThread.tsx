"use client";

import { useEffect, useRef, useState } from "react";
import { duration, isActive, type WorkLogLine, type WorkRunView } from "@/lib/work/shared";
import { Markdown } from "../Markdown";

/** One message of yours and the run that answered it. `ask`: your words (null: the todo's own work, `label` says what). */
export type SessionTurn = { run: WorkRunView; ask: string | null; label: string };

const BACKEND: Record<string, string> = { claude: "Claude CLI", copilot: "Copilot CLI", zeff: "Zeff", agent: "Agent (MCP)" };

/** A run's log lines as they come: polled while it runs, read once when it's over. */
function useRunLog(id: number, active: boolean) {
  const [lines, setLines] = useState<WorkLogLine[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const next = useRef(0);
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
        if (j.status === "queued" || j.status === "running") timer = setTimeout(load, 1200);
      } catch {
        if (live) timer = setTimeout(load, 5000);
      }
    };
    load();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // A run that starts again (queued → running) is read on by the same poll; `active` only wakes a finished one.
  }, [id, active]);
  return { lines, errors, loaded };
}

type Step = Extract<WorkLogLine, { k: "tool" | "out" | "deny" }>;
type Block = { t: "say"; text: string } | { t: "steps"; steps: Step[] } | { t: "raw"; text: string };

/** The log as a conversation: the worker's words, its tool calls grouped between them, plain output kept together. */
function toBlocks(lines: WorkLogLine[]): { blocks: Block[]; model: string | null } {
  const blocks: Block[] = [];
  let model: string | null = null;
  for (const l of lines) {
    const last = blocks[blocks.length - 1];
    if (l.k === "start") model = l.model ?? model;
    else if (l.k === "say") blocks.push({ t: "say", text: l.text });
    else if (l.k === "tool" || l.k === "out" || l.k === "deny") {
      if (last?.t === "steps") last.steps.push(l);
      else blocks.push({ t: "steps", steps: [l] });
    } else if (l.k === "raw") {
      if (last?.t === "raw") last.text += `\n${l.text}`;
      else blocks.push({ t: "raw", text: l.text });
    }
  }
  return { blocks, model };
}

function Spinner() {
  return <span className="inline-block size-3 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500 align-[-2px] dark:border-zinc-700 dark:border-t-indigo-400" aria-hidden />;
}

function StepLine({ s }: { s: Step }) {
  if (s.k === "tool")
    return (
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-[9px] text-emerald-500" aria-hidden>
          ●
        </span>
        <span className="shrink-0 font-medium text-zinc-700 dark:text-zinc-200">{s.tool}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-zinc-500" title={s.text}>
          {s.text}
        </span>
      </div>
    );
  if (s.k === "deny")
    return (
      <div className="pl-4 text-amber-700 dark:text-amber-400">
        <span className="font-mono">⎿</span> refused: {s.text}
      </div>
    );
  return (
    <div className={`truncate pl-4 font-mono text-[11px] ${s.error ? "text-red-600 dark:text-red-400" : "text-zinc-400"}`} title={s.text}>
      ⎿ {s.text}
    </div>
  );
}

/** Tool calls between two things the worker said: a few in full, more folded into one line (the newest stay visible while it works). */
function Steps({ steps, working }: { steps: Step[]; working: boolean }) {
  const [open, setOpen] = useState(false);
  const calls = steps.filter((s) => s.k === "tool") as Extract<Step, { k: "tool" }>[];
  const names = [...new Set(calls.map((c) => c.tool))];
  const fold = steps.length > 4 && !open;
  const shown = fold ? (working ? steps.slice(-3) : []) : steps;
  return (
    <div className="space-y-0.5 text-xs">
      {steps.length > 4 && (
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" aria-expanded={open}>
          <span className="w-3 text-[10px]">{open ? "▾" : "▸"}</span>
          {calls.length} {calls.length === 1 ? "step" : "steps"}
          <span className="truncate text-zinc-400">· {names.slice(0, 5).join(", ")}{names.length > 5 ? " …" : ""}</span>
        </button>
      )}
      {shown.map((s, i) => (
        <StepLine key={i} s={s} />
      ))}
    </div>
  );
}

function Raw({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > 12;
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
      <pre className="max-h-[60vh] overflow-auto p-2.5 font-mono text-[11px] leading-snug whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{long && !open ? lines.slice(-12).join("\n") : text}</pre>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="w-full border-t border-zinc-200 px-2.5 py-1 text-left text-[11px] text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-200">
          {open ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

/** Your message, right-aligned like in a chat. */
function Ask({ turn }: { turn: SessionTurn }) {
  if (!turn.ask)
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{turn.label}</span>
      </div>
    );
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-100 px-4 py-2.5 text-sm whitespace-pre-wrap text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">{turn.ask}</div>
    </div>
  );
}

/** What answered it: the worker's words and steps as they happen, its answer, then which backend and model, how long, what it cost. */
function Answer({ run }: { run: WorkRunView }) {
  const active = isActive(run.status);
  const { lines, errors, loaded } = useRunLog(run.id, active);
  const { blocks, model } = toBlocks(lines);
  const summary = run.summary?.trim() || run.result?.draft?.trim() || "";
  const lastSay = [...blocks].reverse().find((b) => b.t === "say");
  const showSummary = !!summary && !(lastSay?.t === "say" && lastSay.text.trim() === summary);
  const res = run.result;
  const meta = [
    BACKEND[run.provider] ?? run.provider,
    model ?? run.model ?? (run.provider === "claude" || run.provider === "copilot" ? "default model" : null),
    run.durationMs ? duration(run.durationMs) : null,
    run.turns ? `${run.turns} turns` : null,
    run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-3">
      {blocks.map((b, i) =>
        b.t === "say" ? (
          <Markdown key={i} text={b.text} className="text-zinc-800 dark:text-zinc-200" />
        ) : b.t === "steps" ? (
          <Steps key={i} steps={b.steps} working={active && i === blocks.length - 1} />
        ) : (
          <Raw key={i} text={b.text} />
        ),
      )}
      {active && (
        <div className="flex items-center gap-2 text-sm text-zinc-500" role="status">
          <Spinner />
          {run.status === "queued" ? "Waiting for a free worker …" : run.live && !run.live.busy ? "Waiting for you" : "Working …"}
        </div>
      )}
      {!active && showSummary && <Markdown text={summary} className="text-zinc-800 dark:text-zinc-200" />}
      {!active && res?.draft && summary !== res.draft.trim() && (
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-1 text-xs font-medium text-zinc-500">Draft{res.channel ? ` · ${res.channel}` : ""}</div>
          <Markdown text={res.draft} />
        </div>
      )}
      {!active && run.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {run.error}
          {errors.length > 0 && !run.error.includes(errors[errors.length - 1]) && <pre className="mt-1 text-xs whitespace-pre-wrap opacity-80">{errors.slice(-5).join("\n")}</pre>}
        </div>
      )}
      {!active && run.gitSummary && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200">Changes</summary>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">{run.gitSummary}</pre>
        </details>
      )}
      {loaded && !active && !blocks.length && !summary && !run.error && <p className="text-sm text-zinc-500">No answer.</p>}
      {!active && (
        <p className="text-[11px] text-zinc-400" title={run.sessionId ? `Session ${run.sessionId}` : undefined}>
          {meta.join(" · ")}
          {res?.outcome && res.outcome !== "done" ? ` · ${res.outcome}` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * A session as a conversation, like Claude Code: each message of yours, then what answered it —
 * the worker's words, its tool calls folded between them, its answer as Markdown — with the
 * backend and model under each answer. Stays scrolled to the newest unless you scroll up.
 */
export function SessionThread({ turns }: { turns: SessionTurn[] }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const follow = new MutationObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    follow.observe(el, { childList: true, subtree: true, characterData: true });
    return () => follow.disconnect();
  }, []);
  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
      role="log"
      aria-label="Conversation"
    >
      <div className="mx-auto max-w-3xl space-y-6 px-1 py-4">
        {turns.map((t) => (
          <section key={t.run.id} className="space-y-4" aria-label={t.run.ref}>
            <Ask turn={t} />
            <Answer run={t.run} />
          </section>
        ))}
      </div>
    </div>
  );
}
