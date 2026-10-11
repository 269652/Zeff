"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { startSessionAction } from "@/plugins/work/server-actions";
import { toast } from "@/components/Toaster";
import { NO_WORKSPACE, WorkspacePicker, type Workspace } from "./WorkspacePicker";
import { CLAUDE_MODES, EFFORTS, type ClaudeMode, type Effort } from "@/lib/work/shared";
import { useT } from "../I18nProvider";
import { modeText } from "./mode-text";

/** What a new live Claude session can be started with (from the Work settings and plugins). */
export type ClaudeComposerOptions = {
  /** Claude workers run as live sessions (else the choices don't apply). */
  live: boolean;
  defaultProvider: string;
  mode: ClaudeMode;
  effort: Effort;
  allowBypass: boolean;
  models: { value: string; label: string }[];
  /** Admin sessions can be had (Windows, the plugin). */
  admin: boolean;
};

/**
 * The message box, like Claude Code's: it grows with what you write, Enter sends, Shift+Enter is a
 * new line. A new session also picks its ticket, repo and CLI — and, for a live Claude session, its
 * mode, model, effort, as administrator; in a session (`continueRunId`) your
 * message goes on with its conversation. `busy`: the worker is still answering — wait for it.
 */
export function SessionComposer({
  ticket,
  todoId,
  continueRunId,
  continueProvider,
  tickets = [],
  repos = [],
  providers = [],
  claude,
  busy = null,
  placeholder,
  autoFocus = false,
}: {
  ticket?: string;
  todoId?: number;
  continueRunId?: number;
  /** The backend of the session it goes on with (its choices shown for Claude). */
  continueProvider?: string;
  /** For a new session: the tickets to pick from (none: the given one, or none). */
  tickets?: { key: string; summary: string | null }[];
  repos?: { id: number; name: string; path: string }[];
  providers?: { id: string; label: string }[];
  claude?: ClaudeComposerOptions;
  /** Why you can't send right now (the worker is answering), or null. */
  busy?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [pick, setPick] = useState(ticket ?? "");
  const [ws, setWs] = useState<Workspace>(NO_WORKSPACE);
  const [provider, setProvider] = useState("");
  const [mode, setMode] = useState<ClaudeMode>(claude?.mode ?? "default");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<Effort>(claude?.effort ?? "");
  const [admin, setAdmin] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);
  // The backend it'll be: picked here, else the session's (going on), else the default.
  const backend = provider || (continueRunId ? continueProvider : undefined) || claude?.defaultProvider;
  const isClaude = !!claude?.live && backend === "claude";
  const blocked = pending || !!busy;
  const send = () =>
    text.trim() &&
    !blocked &&
    start(async () => {
      const r = await startSessionAction({
        instruction: text,
        ticket: pick || ticket || "",
        todoId,
        continueRunId,
        repoPath: ws.path || undefined,
        branch: ws.branch || undefined,
        workspace: ws.mode || undefined,
        provider: provider || undefined,
        session: isClaude ? { permissionMode: mode, model: model || undefined, effort, elevated: admin || undefined } : undefined,
      });
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setText("");
      router.push(`/work?run=${r.runId}`);
    });
  const select = "rounded-md border-0 bg-transparent py-0.5 pr-6 pl-1.5 text-xs text-zinc-500 hover:bg-zinc-100 focus:ring-1 focus:ring-indigo-400 dark:hover:bg-zinc-800";
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-2xl border border-zinc-300 bg-white shadow-sm transition focus-within:border-indigo-400 focus-within:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-indigo-500">
        <textarea
          ref={area}
          rows={1}
          className="block max-h-80 min-h-12 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-zinc-400"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={busy ?? placeholder ?? t("What should we work on?")}
          aria-label={continueRunId ? t("Reply") : t("Instruction")}
          disabled={pending}
          autoFocus={autoFocus}
        />
        <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2">
          {tickets.length > 0 && (
            <select className={`${select} max-w-56`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t("Ticket")}>
              <option value="">{t("No ticket")}</option>
              {tickets.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.key}
                  {x.summary ? ` · ${x.summary.slice(0, 40)}` : ""}
                </option>
              ))}
            </select>
          )}
          {!continueRunId && <WorkspacePicker repos={repos} value={ws} onChange={setWs} selectClass={select} />}
          {providers.length > 1 && (
            <select className={select} value={provider} onChange={(e) => setProvider(e.target.value)} aria-label={t("Backend")}>
              <option value="">{continueRunId ? t("Same backend") : t("Default backend")}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          {isClaude && claude && (
            <>
              <select className={select} value={mode} onChange={(e) => setMode(e.target.value as ClaudeMode)} aria-label={t("Permission mode")} title={modeText(t, mode).hint}>
                {CLAUDE_MODES.filter((m) => m !== "bypassPermissions" || claude.allowBypass).map((m) => (
                  <option key={m} value={m}>
                    {t("Mode: {m}", { m: modeText(t, m).label })}
                  </option>
                ))}
              </select>
              <select className={select} value={model} onChange={(e) => setModel(e.target.value)} aria-label={t("Model")}>
                {claude.models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.value ? m.label : continueRunId ? t("Same model") : t("Model: default")}
                  </option>
                ))}
              </select>
              <select className={select} value={effort} onChange={(e) => setEffort(e.target.value as Effort)} aria-label={t("Effort")}>
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {e ? t("Effort: {e}", { e }) : t("Effort: default")}
                  </option>
                ))}
              </select>
              {claude.admin && (
                <label className="flex items-center gap-1 px-1.5 text-xs text-red-700 dark:text-red-300" title={t("Runs as administrator (Windows asks you, or the Admin sessions task starts it)")}>
                  <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
                  {t("As administrator")}
                </label>
              )}
            </>
          )}
          <span className="ml-auto hidden text-[11px] text-zinc-400 sm:inline">{t("Enter to send · Shift+Enter for a new line")}</span>
          <button
            type="button"
            className="ml-2 grid size-8 place-items-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
            disabled={blocked || !text.trim()}
            onClick={send}
            aria-label={t("Send")}
            title={t("Send")}
          >
            {pending ? (
              <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
                <path d="M10 3.5a.75.75 0 0 1 .53.22l5 5a.75.75 0 1 1-1.06 1.06l-3.72-3.72v9.19a.75.75 0 0 1-1.5 0V6.06L5.53 9.78a.75.75 0 0 1-1.06-1.06l5-5A.75.75 0 0 1 10 3.5Z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
