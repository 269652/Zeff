"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { DiffFile } from "@/lib/work/session-git";
import type { ProcView } from "@/lib/work/session-procs";
import { useT } from "../I18nProvider";
import { FormError } from "../FormError";
import { toast } from "../Toaster";
import { ExtFrame, type ExtContext } from "../ext/ExtFrame";
import { Patch } from "./Diff";
import { fileStatusText } from "./mode-text";

/** "chat", "changes", "preview" — or "ext:<plugin>:<panel>", a plugin's session panel. */
type Tab = string;

const STATUS_TONE: Record<DiffFile["status"], string> = {
  added: "text-emerald-600",
  untracked: "text-emerald-600",
  modified: "text-amber-600",
  deleted: "text-red-600",
  renamed: "text-sky-600",
};

type Answer = { ok: boolean; error?: string; commit?: string; branch?: string; url?: string; existed?: boolean };
const post = (runId: number, body: Record<string, unknown>): Promise<Answer> =>
  fetch(`/api/work/${runId}/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json() as Promise<Answer>)
    .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));

/**
 * A session's workspace, beside its conversation — Claude Code's panes: the changes since it
 * began (file by file, as diffs), commit / push / merge request, and its dev servers (preview).
 */
export function SessionTabs({ runId, git, children, title, extPanels = [], extContext }: { runId: number; git: boolean; children: React.ReactNode; title: string; /** Plugins' session panels: more tabs, each handed this session (extContext). */ extPanels?: { id: string; plugin: string; entry: string; title: string }[]; extContext?: ExtContext }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("chat");
  const tabs: { id: Tab; label: string }[] = [{ id: "chat", label: t("Conversation") }, ...(git ? [{ id: "changes" as Tab, label: t("Changes") }] : []), { id: "preview", label: t("Preview") }, ...extPanels.map((x) => ({ id: `ext:${x.id}`, label: x.title }))];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === x.id ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {/* The conversation stays mounted (its log keeps reading) while another tab shows. */}
      <div className={tab === "chat" ? "flex min-h-0 flex-1 flex-col gap-2" : "hidden"}>{children}</div>
      {tab === "changes" && <Changes runId={runId} title={title} />}
      {tab === "preview" && <Preview runId={runId} />}
      {extPanels.filter((x) => tab === `ext:${x.id}`).map((x) => (
        <ExtFrame key={x.id} plugin={x.plugin} entry={x.entry} title={x.title} context={extContext} />
      ))}
    </div>
  );
}

function Changes({ runId, title }: { runId: number; title: string }) {
  const t = useT();
  const [data, setData] = useState<{ base: string; files: DiffFile[]; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState(title);
  const [pending, start] = useTransition();
  const load = useCallback(async () => {
    const r = await fetch(`/api/work/${runId}/session?what=diff`, { cache: "no-store" });
    const j = (await r.json()) as { base: string; files: DiffFile[]; truncated: boolean; error?: string };
    if (!r.ok) setError(j.error ?? t("Couldn't read the changes."));
    else {
      setError(null);
      setData(j);
    }
  }, [runId, t]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling: its state is set after the fetch
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);
  const act = (body: Record<string, unknown>, done: (r: Awaited<ReturnType<typeof post>>) => string) =>
    start(async () => {
      const r = await post(runId, body);
      if (!r.ok) toast(r.error ?? t("Didn't work."), { tone: "error" });
      else toast(done(r));
      await load();
    });
  const added = data?.files.reduce((n, f) => n + f.added, 0) ?? 0;
  const removed = data?.files.reduce((n, f) => n + f.removed, 0) ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {data && (
          <span className="text-zinc-600 dark:text-zinc-300">
            {t("{n} file(s)", { n: data.files.length })} · <span className="text-emerald-600">+{added}</span> <span className="text-red-600">−{removed}</span>
            <span className="ml-2 font-mono text-xs text-zinc-400">{t("since {base}", { base: data.base.slice(0, 8) })}</span>
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <input className="input w-72 max-w-full py-1 text-xs" value={message} onChange={(e) => setMessage(e.target.value)} aria-label={t("Commit message")} placeholder={t("Commit message")} />
          <button type="button" className="btn btn-sm" disabled={pending || !data?.files.length || !message.trim()} onClick={() => act({ do: "commit", message }, (r) => t("Committed: {c}", { c: r.commit ?? "" }))}>
            {t("Commit all")}
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => confirm(t("Push this branch to origin?")) && act({ do: "push" }, (r) => t("Pushed {b}", { b: r.branch ?? "" }))}>
            {t("Push")}
          </button>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => confirm(t("Open a merge request for this branch on GitLab?")) && act({ do: "mr", title: message }, (r) => (r.existed ? t("There was one already: {u}", { u: r.url ?? "" }) : t("Opened: {u}", { u: r.url ?? "" })))}>
            {t("Merge request")}
          </button>
        </span>
      </div>
      {error && <FormError as="p">{error}</FormError>}
      <div className="min-h-0 flex-1 space-y-2 overflow-auto">
        {data?.files.map((f) => (
          <div key={f.path} className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
            <button type="button" className="flex w-full items-center gap-2 bg-zinc-50 px-2 py-1 text-left font-mono text-xs dark:bg-zinc-900" onClick={() => setOpen((o) => ({ ...o, [f.path]: !(o[f.path] ?? data.files.length <= 8) }))}>
              <span className={STATUS_TONE[f.status]}>{fileStatusText(t, f.status)}</span>
              <span className="min-w-0 flex-1 truncate">{f.path}</span>
              <span className="text-emerald-600">+{f.added}</span>
              <span className="text-red-600">−{f.removed}</span>
            </button>
            {(open[f.path] ?? data.files.length <= 8) && (f.binary ? <p className="px-2 py-1 text-xs text-zinc-500">{t("Binary file")}</p> : f.patch ? <Patch patch={f.patch} /> : <p className="px-2 py-1 text-xs text-zinc-500">{t("Too big to show here.")}</p>)}
          </div>
        ))}
        {data && !data.files.length && <p className="text-sm text-zinc-500">{t("No changes yet.")}</p>}
        {data?.truncated && <p className="text-xs text-zinc-500">{t("Some diffs are too big to show — see git.")}</p>}
      </div>
    </div>
  );
}

function Preview({ runId }: { runId: number }) {
  const t = useT();
  const [procs, setProcs] = useState<ProcView[] | null>(null);
  const [show, setShow] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = useCallback(async () => {
    const r = await fetch(`/api/work/${runId}/session?what=procs`, { cache: "no-store" });
    if (r.ok) setProcs(((await r.json()) as { procs: ProcView[] }).procs);
  }, [runId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling: its state is set after the fetch
    void load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [load]);
  const act = (body: Record<string, unknown>) =>
    start(async () => {
      const r = await post(runId, body);
      if (!r.ok) toast(r.error ?? t("Didn't work."), { tone: "error" });
      await load();
    });
  const shown = procs?.find((p) => p.name === show && p.running && p.url);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {procs && !procs.length && (
        <p className="text-sm text-zinc-500">
          {t("No dev servers configured. Add them to .claude/launch.json in the repo (name, runtimeExecutable, runtimeArgs, port) — the same file Claude Code uses.")}
        </p>
      )}
      <ul className="space-y-1.5">
        {procs?.map((p) => (
          <li key={p.name} className="rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-block size-2 rounded-full ${p.running ? "bg-emerald-500" : "bg-zinc-300"}`} aria-hidden />
              <span className="font-medium">{p.name}</span>
              {p.url && p.running && (
                <a href={p.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                  {p.url} ↗
                </a>
              )}
              <span className="ml-auto flex gap-1.5">
                {p.running ? (
                  <>
                    {p.url && (
                      <button type="button" className="btn btn-sm" onClick={() => setShow(show === p.name ? null : p.name)}>
                        {show === p.name ? t("Hide preview") : t("Show preview")}
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act({ do: "proc-stop", name: p.name })}>
                      {t("Stop")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act({ do: "proc-start", name: p.name })}>
                    {t("Start")}
                  </button>
                )}
              </span>
            </div>
            {p.log && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-zinc-500">{t("Output")}</summary>
                <pre className="mt-1 max-h-60 overflow-auto rounded bg-zinc-950 p-2 font-mono text-xs whitespace-pre-wrap text-zinc-300">{p.log}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      {shown && <iframe src={shown.url!} title={shown.name} className="min-h-[60vh] w-full flex-1 rounded-md border border-zinc-200 bg-white dark:border-zinc-800" />}
    </div>
  );
}
