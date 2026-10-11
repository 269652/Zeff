"use client";

import { useEffect, useRef, useState } from "react";
import { duration, isActive, type WorkLogLine, type WorkRunView } from "@/lib/work/shared";
import { useT } from "../I18nProvider";
import { Markdown } from "../Markdown";
import { EditDiff } from "./Diff";

/** One message of yours and the run that answered it. `ask`: your words (null: the todo's own work, `label` says what). */
export type SessionTurn = { run: WorkRunView; ask: string | null; label: string };

const BACKEND: Record<string, string> = { claude: "Claude CLI", copilot: "Copilot CLI", codex: "ChatGPT", zeff: "Zeff", agent: "Agent (MCP)" };

/**
 * A run's log lines as they come: polled while it runs, read once when it's over. A live session's
 * recent lines can change (your answer added to its question): its last 50 are read again each time.
 */
function useRunLog(id: number, active: boolean, live: boolean) {
  const [lines, setLines] = useState<WorkLogLine[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const next = useRef(0);
  useEffect(() => {
    let on = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
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
        if (j.status === "queued" || j.status === "running") timer = setTimeout(load, live ? 700 : 1200);
      } catch {
        if (on) timer = setTimeout(load, 5000);
      }
    };
    load();
    return () => {
      on = false;
      if (timer) clearTimeout(timer);
    };
    // A run that starts again (queued → running) is read on by the same poll; `active` only wakes a finished one.
  }, [id, active, live]);
  return { lines, errors, loaded };
}

type Step = Extract<WorkLogLine, { k: "tool" | "out" | "deny" | "ask" }>;
type Block =
  | { t: "say"; text: string }
  | { t: "steps"; steps: Step[] }
  | { t: "raw"; text: string }
  | { t: "you"; text: string; images?: number }
  | { t: "shell"; cmd: string; text: string; ok: boolean }
  | { t: "note"; text: string };

/**
 * The log as a conversation: the worker's words, its tool calls (and what it asked you) grouped
 * between them, plain output kept together; in a live session also what you wrote meanwhile, your
 * !commands, and what happened to the session.
 */
function toBlocks(lines: WorkLogLine[]): { blocks: Block[]; model: string | null } {
  const blocks: Block[] = [];
  let model: string | null = null;
  for (const l of lines) {
    const last = blocks[blocks.length - 1];
    if (l.k === "start") model = l.model ?? model;
    else if (l.k === "say") blocks.push({ t: "say", text: l.text });
    else if (l.k === "tool" || l.k === "out" || l.k === "deny" || l.k === "ask") {
      if (last?.t === "steps") last.steps.push(l);
      else blocks.push({ t: "steps", steps: [l] });
    } else if (l.k === "raw") {
      if (last?.t === "raw") last.text += `\n${l.text}`;
      else blocks.push({ t: "raw", text: l.text });
    } else if (l.k === "you") blocks.push({ t: "you", text: l.text, images: l.images });
    else if (l.k === "shell") blocks.push({ t: "shell", cmd: l.cmd, text: l.text, ok: l.ok });
    else if (l.k === "note") blocks.push({ t: "note", text: l.text });
  }
  return { blocks, model };
}

function Spinner() {
  return <span className="inline-block size-3 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500 align-[-2px] dark:border-zinc-700 dark:border-t-indigo-400" aria-hidden />;
}

function StepLine({ s }: { s: Step }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (s.k === "tool") {
    const more = !!(s.diff?.length || s.detail);
    return (
      <div>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[9px] text-emerald-500" aria-hidden>
            ●
          </span>
          <span className="shrink-0 font-medium text-zinc-700 dark:text-zinc-200">{s.tool}</span>
          {more ? (
            <button type="button" onClick={() => setOpen(!open)} className="min-w-0 truncate text-left font-mono text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" title={s.text} aria-expanded={open}>
              {open ? "▾" : "▸"} {s.text}
            </button>
          ) : (
            <span className="min-w-0 truncate font-mono text-[11px] text-zinc-500" title={s.text}>
              {s.text}
            </span>
          )}
        </div>
        {open && (
          <div className="mt-1 mb-2 ml-4 space-y-1">
            {s.diff?.map((d, i) => <EditDiff key={i} old={d.old} new={d.new} />)}
            {s.detail && (s.tool === "ExitPlanMode" ? <Markdown text={s.detail} /> : <pre className="max-h-96 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-200">{s.detail}</pre>)}
          </div>
        )}
      </div>
    );
  }
  if (s.k === "ask")
    return (
      <div className="flex min-w-0 items-baseline gap-2 rounded-md bg-amber-50 px-1.5 py-0.5 dark:bg-amber-950/40">
        <span className="text-[10px] text-amber-600" aria-hidden>
          ?
        </span>
        <span className="min-w-0 truncate text-amber-900 dark:text-amber-100" title={s.text}>
          {s.text}
        </span>
        <span className={`shrink-0 font-medium ${s.answer ? (s.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400") : "text-amber-700 dark:text-amber-300"}`}>
          {s.answer ? `→ ${s.answer}` : t("waiting for you")}
        </span>
      </div>
    );
  if (s.k === "deny")
    return (
      <div className="pl-4 text-amber-700 dark:text-amber-400">
        <span className="font-mono">⎿</span> {t("refused:")} {s.text}
      </div>
    );
  return (
    <div className="pl-4">
      {s.full ? (
        <button type="button" onClick={() => setOpen(!open)} className={`block w-full truncate text-left font-mono text-[11px] ${s.error ? "text-red-600 dark:text-red-400" : "text-zinc-400"} hover:text-zinc-700 dark:hover:text-zinc-200`} title={s.text} aria-expanded={open}>
          ⎿ {s.text}
        </button>
      ) : (
        <div className={`truncate font-mono text-[11px] ${s.error ? "text-red-600 dark:text-red-400" : "text-zinc-400"}`} title={s.text}>
          ⎿ {s.text}
        </div>
      )}
      {open && s.full && <pre className="mt-1 max-h-96 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-300">{s.full}</pre>}
    </div>
  );
}

/** Tool calls between two things the worker said: a few in full, more folded into one line (the newest stay visible while it works; a question to you always). */
function Steps({ steps, working }: { steps: Step[]; working: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const calls = steps.filter((s) => s.k === "tool") as Extract<Step, { k: "tool" }>[];
  const names = [...new Set(calls.map((c) => c.tool))];
  const fold = steps.length > 4 && !open;
  const shown = fold ? steps.filter((s, i) => s.k === "ask" || (working && i >= steps.length - 3)) : steps;
  return (
    <div className="space-y-0.5 text-xs">
      {steps.length > 4 && (
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" aria-expanded={open}>
          <span className="w-3 text-[10px]">{open ? "▾" : "▸"}</span>
          {calls.length === 1 ? t("1 step") : t("{n} steps", { n: calls.length })}
          <span className="truncate text-zinc-400">
            · {names.slice(0, 5).join(", ")}
            {names.length > 5 ? " …" : ""}
          </span>
        </button>
      )}
      {shown.map((s, i) => (
        <StepLine key={i} s={s} />
      ))}
    </div>
  );
}

function Raw({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > 12;
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
      <pre className="max-h-[60vh] overflow-auto p-2.5 font-mono text-[11px] leading-snug whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{long && !open ? lines.slice(-12).join("\n") : text}</pre>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="w-full border-t border-zinc-200 px-2.5 py-1 text-left text-[11px] text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:hover:text-zinc-200">
          {open ? t("Show less") : t("Show all {n} lines", { n: lines.length })}
        </button>
      )}
    </div>
  );
}

/** Your message, right-aligned like in a chat. */
function Bubble({ text, images }: { text: string; images?: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = text.length > 1500;
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-100 px-4 py-2.5 text-sm whitespace-pre-wrap text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
        {long && !open ? `${text.slice(0, 600)} …` : text}
        {long && (
          <button type="button" onClick={() => setOpen(!open)} className="mt-1 block text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            {open ? t("Show less") : t("Show all")}
          </button>
        )}
        {images ? <span className="mt-1 block text-xs text-zinc-500">🖼 {t("{n} image(s)", { n: images })}</span> : null}
      </div>
    </div>
  );
}

function Ask({ turn }: { turn: SessionTurn }) {
  if (!turn.ask)
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{turn.label}</span>
      </div>
    );
  return <Bubble text={turn.ask} />;
}

/** A command you ran in its folder (!cmd), its output folded. */
function Shell({ cmd, text, ok }: { cmd: string; text: string; ok: boolean }) {
  const t = useT();
  return (
    <details className="rounded-lg bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-200">
      <summary className={`cursor-pointer ${ok ? "text-amber-300" : "text-red-300"}`}>! {cmd}</summary>
      <pre className="mt-1 max-h-96 overflow-auto text-[11px] whitespace-pre-wrap text-zinc-300">{text || t("(no output)")}</pre>
    </details>
  );
}

/** What answered it: the worker's words and steps as they happen, its answer, then which backend and model, how long, what it cost. */
function Answer({ run }: { run: WorkRunView }) {
  const t = useT();
  const active = isActive(run.status);
  const { lines, errors, loaded } = useRunLog(run.id, active, !!run.session);
  const { blocks, model } = toBlocks(lines);
  const summary = run.summary?.trim() || run.result?.draft?.trim() || "";
  const lastSay = [...blocks].reverse().find((b) => b.t === "say");
  const showSummary = !!summary && !(lastSay?.t === "say" && (lastSay.text.trim() === summary || lastSay.text.includes(summary)));
  const res = run.result;
  const meta = [
    BACKEND[run.provider] ?? run.provider,
    model ?? run.model ?? (run.provider === "claude" || run.provider === "copilot" || run.provider === "codex" ? t("default model") : null),
    run.durationMs ? duration(run.durationMs) : null,
    run.turns ? t("{n} turns", { n: run.turns }) : null,
    run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : null,
  ].filter(Boolean);
  const waiting = run.session ? run.session.asks.length > 0 || !run.live?.busy : run.live && !run.live.busy;
  return (
    <div className="space-y-3">
      {blocks.map((b, i) =>
        b.t === "say" ? (
          <Markdown key={i} text={b.text} className="text-zinc-800 dark:text-zinc-200" />
        ) : b.t === "steps" ? (
          <Steps key={i} steps={b.steps} working={active && i === blocks.length - 1} />
        ) : b.t === "you" ? (
          <Bubble key={i} text={b.text} images={b.images} />
        ) : b.t === "shell" ? (
          <Shell key={i} cmd={b.cmd} text={b.text} ok={b.ok} />
        ) : b.t === "note" ? (
          <p key={i} className="text-center text-[11px] text-zinc-400">
            {b.text}
          </p>
        ) : (
          <Raw key={i} text={b.text} />
        ),
      )}
      {active && (
        <div className="flex items-center gap-2 text-sm text-zinc-500" role="status">
          {!waiting && <Spinner />}
          {run.status === "queued" ? t("Waiting for a free worker …") : run.session?.asks.length ? t("It asks you — below") : waiting ? t("Waiting for you") : t("Working …")}
        </div>
      )}
      {!active && showSummary && <Markdown text={summary} className="text-zinc-800 dark:text-zinc-200" />}
      {!active && res?.draft && summary !== res.draft.trim() && (
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-1 text-xs font-medium text-zinc-500">
            {t("Draft")}
            {res.channel ? ` · ${res.channel}` : ""}
          </div>
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
          <summary className="cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200">{t("Changes")}</summary>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">{run.gitSummary}</pre>
        </details>
      )}
      {loaded && !active && !blocks.length && !summary && !run.error && <p className="text-sm text-zinc-500">{t("No answer.")}</p>}
      {!active && (
        <p className="text-[11px] text-zinc-400" title={run.sessionId ? t("Session {id}", { id: run.sessionId }) : undefined}>
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
  const t = useT();
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
      aria-label={t("Conversation")}
    >
      <div className="mx-auto max-w-3xl space-y-6 px-1 py-4">
        {turns.map((x) => (
          <section key={x.run.id} className="space-y-4" aria-label={x.run.ref}>
            <Ask turn={x} />
            <Answer run={x.run} />
          </section>
        ))}
      </div>
    </div>
  );
}
