"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { cancelFlowRunAction, flowRunsAction, resumeFlowRunAction } from "@/plugins/workspace/actions";
import type { FlowRun, LogEntry } from "@/plugins/workspace/flows/store";

/**
 * A flow's runs: the newest first, each with how it went; one opened shows every node it went through (indented as nested), with its
 * input, output, error, its script's log lines — and, while it waits for you, the choices that let it go on.
 */

const STATUS_TONE: Record<string, string> = { done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", failed: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300", waiting: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300", running: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300", cancelled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" };
const SIGN: Record<LogEntry["status"], string> = { ok: "✓", failed: "✗", skipped: "–", waiting: "…", dry: "~" };

function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-950">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

export function RunConsole({ pageId, tick, focus, onRuns, onPick }: { pageId: number; tick: number; focus: number | null; onRuns: (runs: FlowRun[]) => void; onPick: (node: string) => void }) {
  const t = useT();
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [open, setOpen] = useState<number | null>(focus);
  const [mine, setMine] = useState(0);
  const [note, setNote] = useState("");
  const label: Record<string, string> = { done: t("done"), failed: t("failed"), waiting: t("waiting"), running: t("running"), cancelled: t("cancelled") };

  useEffect(() => {
    let live = true;
    void flowRunsAction(pageId).then((r) => {
      if (!live || !r.ok) return;
      setRuns(r.runs);
      onRuns(r.runs);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onRuns is the editor's setter
  }, [pageId, tick, mine]);

  const shown = open ?? focus ?? runs[0]?.id ?? null;
  const run = runs.find((r) => r.id === shown) ?? null;

  const decide = async (choice: string) => {
    if (!run) return;
    const r = await resumeFlowRunAction(run.id, choice, note || undefined);
    if (!r.ok) return toast(r.error, { tone: "error" });
    setNote("");
    setMine((x) => x + 1);
  };
  const cancel = async () => {
    if (!run) return;
    const r = await cancelFlowRunAction(run.id);
    if (!r.ok) return toast(r.error, { tone: "error" });
    setMine((x) => x + 1);
  };

  if (!runs.length) return <p className="text-sm text-zinc-500">{t("No runs yet: start it with ▶ Run.")}</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <ul className="space-y-1">
        {runs.map((r) => (
          <li key={r.id}>
            <button type="button" className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${r.id === shown ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`} onClick={() => setOpen(r.id)}>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status] ?? ""}`}>{label[r.status] ?? r.status}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
                #{r.id} · {new Date(r.startedAt).toLocaleString()}
                {r.dry ? ` · ${t("dry")}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {run && (
        <div className="min-w-0 space-y-3">
          {run.status === "waiting" && run.waiting && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              {run.waiting.kind === "approve" ? (
                <>
                  <div className="font-medium">✋ {run.waiting.title}</div>
                  {run.waiting.text && <p className="text-sm whitespace-pre-line">{run.waiting.text}</p>}
                  <input className="input" placeholder={t("A note (optional)")} value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="flex flex-wrap gap-1.5">
                    {(run.waiting.options ?? ["yes", "no"]).map((o, i) => (
                      <button key={o} type="button" className={`btn btn-sm ${i === 0 ? "btn-primary" : ""}`} onClick={() => void decide(o)}>
                        {o}
                      </button>
                    ))}
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void cancel()}>
                      {t("Stop the run")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span>{run.waiting.kind === "ask" ? `💬 ${run.waiting.title} — ${t("waits for your answer (the card in the corner)")}` : `⏳ ${t("Goes on at {time}", { time: run.waiting.until ? new Date(run.waiting.until).toLocaleString() : "?" })}`}</span>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void cancel()}>
                    {t("Stop the run")}
                  </button>
                </div>
              )}
            </div>
          )}
          {run.error && <pre className="overflow-x-auto rounded-md bg-red-50 p-2 text-xs whitespace-pre-wrap text-red-800 dark:bg-red-950/40 dark:text-red-300">{run.error}</pre>}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="label">{t("Input")}</div>
              <Json value={run.input} />
            </div>
            <div>
              <div className="label">{t("Output")}</div>
              <Json value={run.output} />
            </div>
          </div>
          <div>
            <div className="label">{t("Steps")}</div>
            <ol className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {run.log.map((l, i) => (
                <li key={i} className="px-2 py-1.5 text-sm" style={{ paddingLeft: 8 + l.depth * 16 }}>
                  <details>
                    <summary className="flex cursor-pointer items-center gap-2">
                      <span className={`font-mono text-xs ${l.status === "failed" ? "text-red-600" : l.status === "waiting" ? "text-amber-600" : l.status === "dry" ? "text-sky-600" : "text-emerald-600"}`}>{SIGN[l.status]}</span>
                      <button type="button" className="font-medium hover:underline" onClick={(e) => (e.preventDefault(), onPick(l.node))}>
                        {l.label || l.node}
                      </button>
                      <span className="truncate font-mono text-xs text-zinc-500">{l.action ?? l.kind}</span>
                      <span className="ml-auto shrink-0 font-mono text-xs text-zinc-500">{l.ms} ms</span>
                    </summary>
                    <div className="mt-1.5 space-y-1.5">
                      {l.error && <pre className="overflow-x-auto rounded-md bg-red-50 p-2 text-xs whitespace-pre-wrap text-red-800 dark:bg-red-950/40 dark:text-red-300">{l.error}</pre>}
                      {l.input !== undefined && <Json value={l.input} />}
                      {l.output !== undefined && <Json value={l.output} />}
                      {l.logs?.length ? <Json value={l.logs.join("\n")} /> : null}
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
