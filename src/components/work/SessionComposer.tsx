"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { startSessionAction } from "@/plugins/work/server-actions";
import { toast } from "@/components/Toaster";
import { NO_WORKSPACE, WorkspacePicker, type Workspace } from "./WorkspacePicker";
import type { Effort } from "@/lib/work/shared";
import { effortsOf, type ComposerOptions } from "@/lib/work/composer-shared";
import { useT } from "../I18nProvider";
import { modeText } from "./mode-text";
import { isClaudeMode } from "@/lib/work/shared";
import { SlashCommands } from "../ext/SlashCommands";

/**
 * The message box, like Claude Code's: it grows with what you write, Enter sends, Shift+Enter is a
 * new line. A new session also picks its ticket, repo and backend — and, for a live session, its
 * mode, model, effort (each backend's own), as administrator (Claude); in a session (`continueRunId`) your message goes on with its
 * conversation — also while the worker still answers: it follows when that run has ended. `busy`:
 * something else keeps you from sending.
 */
export function SessionComposer({
  ticket,
  ticketRepos,
  todoId,
  continueRunId,
  continueProvider,
  tickets = [],
  repos = [],
  providers = [],
  options,
  busy = null,
  placeholder,
  autoFocus = false,
}: {
  ticket?: string;
  /** The repo Zeff infers for each ticket (Repos page): preselected until you pick a folder yourself. */
  ticketRepos?: Record<string, string>;
  todoId?: number;
  continueRunId?: number;
  /** The backend of the session it goes on with (its choices shown). */
  continueProvider?: string;
  /** For a new session: the tickets to pick from (none: the given one, or none). */
  tickets?: { key: string; summary: string | null }[];
  repos?: { id: number; name: string; path: string }[];
  /** What each backend lets you choose (live backends: mode, model, effort) and the default backend. */
  options?: ComposerOptions;
  providers?: { id: string; label: string }[];
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
  const [picked, setWs] = useState<Workspace>(NO_WORKSPACE);
  const [ownFolder, setOwnFolder] = useState(false);
  // The ticket's repo, as Zeff infers it — shown (and used) until you pick a folder yourself.
  const inferred = ticketRepos?.[(pick || ticket || "").toUpperCase()] ?? "";
  const ws: Workspace = ownFolder ? picked : { ...picked, path: inferred };
  const [provider, setProvider] = useState("");
  // What you chose per backend (a model of one is nothing to another): each starts from its own defaults.
  const [picks, setPicks] = useState<Record<string, { mode?: string; model?: string; effort?: Effort }>>({});
  const [admin, setAdmin] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // Pictures and documents pasted, dropped or picked: kept at once (so the CLI can read them), listed under the box.
  const [files, setFiles] = useState<{ ref: string; name: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const attach = async (list: File[]) => {
    if (!list.length) return;
    setUploading((n) => n + 1);
    try {
      const body = new FormData();
      for (const f of list) body.append("files", f, f.name || "image.png");
      const r = (await fetch("/api/work/attach", { method: "POST", body }).then((x) => x.json())) as { ok: boolean; error?: string; files?: { ref: string; name: string; size: number }[] };
      if (!r.ok) toast(r.error ?? t("Didn't work."), { tone: "error" });
      else setFiles((f) => [...f, ...(r.files ?? [])]);
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Didn't work."), { tone: "error" });
    } finally {
      setUploading((n) => n - 1);
    }
  };
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);
  // The backend it'll be: picked here, else the session's (going on), else the default.
  const backend = provider || (continueRunId ? continueProvider : undefined) || options?.defaultProvider;
  const choices = backend ? options?.choices[backend] : undefined;
  const mine = (backend && picks[backend]) || {};
  const mode = mine.mode && choices?.modes.some((m) => m.id === mine.mode) ? mine.mode : (choices?.defaultMode ?? "");
  const model = mine.model && choices?.models.some((m) => m.value === mine.model) ? mine.model : "";
  const efforts = effortsOf(choices?.models.find((m) => m.value === model));
  const effort = mine.effort && efforts.includes(mine.effort) ? mine.effort : efforts.includes(choices?.defaultEffort ?? "") ? (choices?.defaultEffort ?? "") : "";
  const pickFor = (patch: { mode?: string; model?: string; effort?: Effort }) => backend && setPicks((p) => ({ ...p, [backend]: { ...p[backend], ...patch } }));
  const modeName = (m: { id: string; label: string; hint: string }) => (isClaudeMode(m.id) ? modeText(t, m.id) : { label: t(m.label), hint: t(m.hint) });
  const blocked = pending || !!busy || uploading > 0;
  const send = () =>
    (text.trim() || files.length > 0) &&
    !blocked &&
    start(async () => {
      const r = await startSessionAction({
        instruction: text,
        attachments: files.map((f) => f.ref),
        ticket: pick || ticket || "",
        todoId,
        continueRunId,
        repoPath: ws.path || undefined,
        branch: ws.branch || undefined,
        workspace: ws.mode || undefined,
        provider: provider || undefined,
        session: choices ? { permissionMode: mode, model: model || undefined, effort: choices.effort ? effort : undefined, elevated: (choices.admin && admin) || undefined } : undefined,
      });
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setText("");
      setFiles([]);
      router.push(`/work?run=${r.runId}`);
    });
  const select = "field-sizing-content rounded-md border-0 bg-transparent py-0.5 pr-6 pl-1.5 text-xs text-zinc-500 hover:bg-zinc-100 focus:ring-1 focus:ring-indigo-400 dark:hover:bg-zinc-800";
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        className={`rounded-2xl border bg-white shadow-sm transition focus-within:border-indigo-400 focus-within:shadow-md dark:bg-zinc-900 dark:focus-within:border-indigo-500 ${over ? "border-indigo-500 ring-2 ring-indigo-300" : "border-zinc-300 dark:border-zinc-700"}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setOver(false);
          void attach([...e.dataTransfer.files]);
        }}
      >
        <SlashCommands text={text} onPick={setText} area={area} />
        <textarea
          ref={area}
          rows={1}
          className="block max-h-80 min-h-12 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-zinc-400"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            // A picture or a file on the clipboard (a screenshot, a copied document): attached; text pastes as usual.
            const list = [...e.clipboardData.files];
            if (!list.length) return;
            e.preventDefault();
            void attach(list);
          }}
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
        {(files.length > 0 || uploading > 0) && (
          <ul className="flex flex-wrap gap-1.5 px-3 pb-1" aria-label={t("Attachments")}>
            {files.map((f) => (
              <li key={f.ref} className="inline-flex max-w-56 items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" title={`${f.name} · ${Math.max(1, Math.round(f.size / 1024))} KB`}>
                <span aria-hidden>📎</span>
                <span className="truncate">{f.name}</span>
                <button type="button" className="text-zinc-400 hover:text-red-600" aria-label={t("Remove {name}", { name: f.name })} onClick={() => setFiles((l) => l.filter((x) => x.ref !== f.ref))}>
                  ×
                </button>
              </li>
            ))}
            {uploading > 0 && <li className="text-xs text-zinc-500">{t("uploading …")}</li>}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2">
          <input ref={picker} type="file" multiple hidden onChange={(e) => {
            void attach([...(e.target.files ?? [])]);
            e.target.value = "";
          }} />
          <button type="button" className="grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => picker.current?.click()} aria-label={t("Attach an image or document")} title={t("Attach an image or document (or paste / drop it)")}>
            📎
          </button>
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
          {!continueRunId && <WorkspacePicker repos={repos} value={ws} onChange={(w) => { setOwnFolder(w.path !== inferred || ownFolder); setWs(w); }} selectClass={select} />}
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
          {choices && (
            <>
              <select className={select} value={mode} onChange={(e) => pickFor({ mode: e.target.value })} aria-label={t("Permission mode")} title={modeName(choices.modes.find((m) => m.id === mode) ?? choices.modes[0]).hint}>
                {choices.modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {t("Mode: {m}", { m: modeName(m).label })}
                  </option>
                ))}
              </select>
              <select className={select} value={model} onChange={(e) => pickFor({ model: e.target.value })} aria-label={t("Model")}>
                {choices.models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.value ? m.label : continueRunId ? t("Same model") : t("Model: default")}
                  </option>
                ))}
              </select>
              {choices.effort && (
                <select className={select} value={effort} onChange={(e) => pickFor({ effort: e.target.value as Effort })} aria-label={t("Effort")}>
                  {efforts.map((e) => (
                    <option key={e} value={e}>
                      {e ? t("Effort: {e}", { e }) : t("Effort: default")}
                    </option>
                  ))}
                </select>
              )}
              {choices.admin && (
                <label className="flex items-center gap-1 px-1.5 text-xs text-red-700 dark:text-red-300" title={t("Runs as administrator (Windows asks you, or the Admin sessions task starts it)")}>
                  <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
                  {t("As administrator")}
                </label>
              )}
            </>
          )}
          <button
            type="button"
            className="ml-auto grid size-8 shrink-0 place-items-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
            disabled={blocked || (!text.trim() && files.length === 0)}
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
