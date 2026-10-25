"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { Switch } from "@/components/Switch";
import { toast } from "@/components/Toaster";
import { approveReportAction, dryRunRoutineAction, makeRoutineAction, routineChoicesAction, routineReportsAction, routineRunsAction, routineViewAction, runRoutineAction, saveRoutineAction } from "../actions";
import type { DryRun } from "../automation";
import type { RoutineView } from "../routine-view";
import type { Condition, Step, Trigger } from "../routines";
import { FILTER_OPS } from "../model";
import { AGENT_TOOL_GROUPS } from "../agent-tools";

/**
 * The controls of an agent or an automation page — the block at the top of its page: switch it on, run it, when it runs (by hand, on
 * a schedule, on an event, called), what it may touch (an agent), its steps (an automation), and what it did lately.
 */

type Choices = { databases: { id: number; title: string; fields: string[] }[]; routines: { id: number; title: string; kind: string }[]; methods: { name: string; label: string; fields: Record<string, string> }[] };
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function useRoutine(pageId: number) {
  const [view, setView] = useState<RoutineView | null | undefined>(undefined);
  const [choices, setChoices] = useState<Choices>({ databases: [], routines: [], methods: [] });
  const load = useCallback(() => void routineViewAction(pageId).then((r) => r.ok && setView(r.view)), [pageId]);
  useEffect(() => {
    load();
    void routineChoicesAction().then((r) => r.ok && setChoices({ databases: r.databases, routines: r.routines, methods: r.methods }));
    // The agents' runs end by themselves: look again while one goes.
  }, [load]);
  useEffect(() => {
    if (!view?.runs.some((r) => r.status === "running")) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [view, load]);
  const save = async (patch: Parameters<typeof saveRoutineAction>[1]) => {
    const r = await saveRoutineAction(pageId, patch);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setView(r.view);
  };
  return { view, setView, choices, save, load };
}

export function RoutineControls({ pageId, editable }: { pageId: number; editable: boolean }) {
  const t = useT();
  const { view, setView, choices, save, load } = useRoutine(pageId);
  const [busy, setBusy] = useState(false);
  /** A dry run's result, shown until the next run or closed. */
  const [plan, setPlan] = useState<(DryRun & { row: { id: number; title: string } | null }) | null>(null);
  const [tab, setTab] = useState<"schedule" | "permissions" | "reports" | "log">("schedule");
  const [reports, setReports] = useState<Awaited<ReturnType<typeof routineReportsAction>> extends infer R ? (R extends { ok: true; reports: infer L } ? L : never) : never>([]);
  const [older, setOlder] = useState<NonNullable<typeof view>["runs"]>([]);
  const [more, setMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  if (view === undefined) return <p className="text-sm text-zinc-400">…</p>;
  if (view === null)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-zinc-300 p-3 text-sm dark:border-zinc-700">
        <span className="text-zinc-500">{t("This page is no routine yet:")}</span>
        {(["agent", "automation"] as const).map((k) => (
          <button key={k} type="button" className="btn btn-sm" onClick={async () => void ((r) => (r.ok ? setView(r.view) : toast(r.error, { tone: "error" })))(await makeRoutineAction(pageId, k))}>
            {k === "agent" ? `🤖 ${t("Make it an agent")}` : `⚙️ ${t("Make it an automation")}`}
          </button>
        ))}
      </div>
    );
  // The log: the newest runs come with the view; older ones are fetched a page at a time.
  const allRuns = [...view.runs, ...older.filter((o) => !view.runs.some((r) => r.id === o.id))];
  const loadOlder = async () => {
    setLoadingMore(true);
    const r = await routineRunsAction(pageId, allRuns.at(-1)?.id);
    setLoadingMore(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setOlder([...older, ...r.runs]);
    setMore(r.more);
  };
  const schedules = view.triggers.filter((x) => x.kind === "schedule");
  const setTriggers = (triggers: Trigger[]) => void save({ triggers });
  const tryIt = async () => {
    setBusy(true);
    const r = await dryRunRoutineAction(pageId);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setPlan({ ...r.plan, row: r.row });
  };
  const run = async () => {
    setPlan(null);
    setBusy(true);
    const r = await runRoutineAction(pageId);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setView(r.view);
    if (r.status === "started") toast(t("The agent is running — it shows in the Code tab."));
    else if (r.status === "failed") toast(r.error ?? t("Failed."), { tone: "error" });
    else toast(r.status === "stopped" ? t("Stopped at a gate.") : t("Done."));
  };
  return (
    <section className="ws-routine space-y-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800" data-routine={view.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg" aria-hidden>
          {view.kind === "agent" ? "🤖" : "⚙️"}
        </span>
        <span className="font-semibold">{view.kind === "agent" ? t("Agent") : t("Automation")}</span>
        <Switch className="ml-2 text-sm" checked={view.enabled} disabled={!editable} onChange={(on) => void save({ enabled: on })} labelOn={t("On")} labelOff={t("Off")} label={t("Switched on")} title={t("Switched on, its schedule and events run it by themselves.")} />
        <span className="flex-1" />
        {view.nextRunAt && <span className="text-xs text-zinc-500">{t("Next: {when}", { when: new Date(view.nextRunAt).toLocaleString() })}</span>}
        {view.kind === "automation" && (
          <button type="button" className="btn btn-sm" disabled={busy || !!view.problem} title={t("Try it: what it would change — nothing is changed, nothing sent")} onClick={() => void tryIt()}>
            🧪 {t("Try it")}
          </button>
        )}
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !!view.live || !!view.problem} title={view.problem ?? (view.live ? t("It is running — wait until this run has ended.") : undefined)} onClick={() => void run()}>
          {busy ? "…" : view.live ? t("Running…") : `▶ ${t("Run now")}`}
        </button>
      </div>
      {view.problem && <p className="text-xs text-amber-700 dark:text-amber-400">{view.problem}</p>}
      {view.live && <LiveRun live={view.live} />}
      {plan && <DryRunPanel plan={plan} onClose={() => setPlan(null)} />}

      {view.kind === "automation" && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-zinc-500 uppercase">{t("Steps")}</h4>
          <StepList steps={view.steps} choices={choices} editable={editable} onChange={(steps) => void save({ steps })} />
          <p className="text-xs text-zinc-400">
            {t("Templates fill in the row in hand and the trigger:")} <code>{"{{row.Field}}"}</code> <code>{"{{row.title}}"}</code> <code>{"{{trigger.kind}}"}</code> <code>{"{{payload.title}}"}</code> <code>{"{{today}}"}</code>
          </p>
        </div>
      )}

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        {([["schedule", t("Schedule")], ["permissions", t("Permissions")], ...(view.kind === "agent" ? ([["reports", t("Reports")]] as const) : []), ["log", t("Log")]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === k ? "border-indigo-500 font-medium" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`} onClick={() => { setTab(k); if (k === "reports") void routineReportsAction(pageId).then((r) => r.ok && setReports(r.reports)); }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "schedule" && (
        <>
      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold text-zinc-500 uppercase">{t("When it runs")}</h4>
        <ul className="space-y-1">
          {view.triggers.map((tr, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <TriggerLine tr={tr} choices={choices} editable={editable} onChange={(next) => setTriggers(view.triggers.map((x, k) => (k === i ? next : x)))} />
              {editable && view.triggers.length > 1 && (
                <button type="button" className="icon-btn" aria-label={t("Remove")} onClick={() => setTriggers(view.triggers.filter((_, k) => k !== i))}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            <button type="button" className="btn btn-sm" onClick={() => setTriggers([...view.triggers, { kind: "schedule", everyMinutes: 60 }])}>
              ＋ {t("Every …")}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setTriggers([...view.triggers, { kind: "schedule", at: "08:00" }])}>
              ＋ {t("At a time")}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setTriggers([...view.triggers, { kind: "schedule", at: "08:00", monthDay: 1 }])}>
              ＋ {t("Monthly")}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setTriggers([...view.triggers, { kind: "event", event: "row.added" }])}>
              ＋ {t("On an event")}
            </button>
            {!view.triggers.some((x) => x.kind === "called") && (
              <button type="button" className="btn btn-sm" title={t("Other routines, auto actions and workers can call it by its name.")} onClick={() => setTriggers([...view.triggers, { kind: "called" }])}>
                ＋ {t("Callable")}
              </button>
            )}
          </div>
        )}
        {!schedules.length && !view.triggers.some((x) => x.kind === "event") && view.enabled && <p className="text-xs text-zinc-500">{t("Only by hand (or when called) — add a schedule or an event to run it by itself.")}</p>}
      </div>

        </>
      )}

      {tab === "permissions" && (
        <>
      {view.kind === "agent" && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-zinc-500 uppercase">{t("What it may change")}</h4>
          <select className="input w-auto text-sm" value={view.permissions.scope} disabled={!editable} onChange={(e) => void save({ permissions: { ...view.permissions, scope: e.target.value } })} aria-label={t("Permissions")}>
            <option value="self">{t("Only this page and what is below it")}</option>
            <option value="parent">{t("Its parent's pages (siblings too)")}</option>
            <option value="workspace">{t("The whole workspace")}</option>
            <option value="none">{t("Nothing — it only reads")}</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500" title={t("Labels, read/unread, spam and filters in Gmail — never deleting. Needs “Allow changes to Gmail” on the Connections page.")}>
            <input type="checkbox" checked={!!view.permissions.gmail} disabled={!editable} onChange={(e) => void save({ permissions: { ...view.permissions, gmail: e.target.checked || undefined } })} />
            {t("May change Gmail (labels, read, spam, filters)")}
          </label>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500" title={t("WhatsApp, Signal, the bank, a journal … — what Settings → Data boundaries marks personal. Secret data stays closed either way.")}>
            <input type="checkbox" checked={!!view.permissions.personal} disabled={!editable} onChange={(e) => void save({ permissions: { ...view.permissions, personal: e.target.checked || undefined } })} />
            🔒 {t("May read personal data")}
          </label>
          <div className="space-y-1 pt-1">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase">{t("What it may use")}</h4>
            {AGENT_TOOL_GROUPS.map((g) => {
              const on = view.permissions.tools?.[g.id] ?? g.default;
              return (
                <label key={g.id} className="flex items-start gap-1.5 text-xs" title={t(g.hint)}>
                  <input type="checkbox" className="mt-0.5" checked={on} disabled={!editable} onChange={(e) => void save({ permissions: { ...view.permissions, tools: { ...view.permissions.tools, [g.id]: e.target.checked } } })} />
                  <span>
                    {t(g.label)}
                    <span className="block text-zinc-500">{t(g.hint)}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            {t("Worker")}
            <select className="input w-auto py-0.5 text-sm" value={view.provider ?? ""} disabled={!editable} onChange={(e) => void save({ provider: e.target.value || undefined })} aria-label={t("Worker")}>
              <option value="">{t("The default worker")}</option>
              <option value="claude">Claude</option>
              <option value="codex">ChatGPT (Codex)</option>
              <option value="copilot">Copilot</option>
            </select>
          </label>
          <p className="text-xs text-zinc-500">{t("It never deletes mails and never opens system pages for writing.")}</p>
          <p className="text-xs text-zinc-500">{t("It reads the instructions below, knows its parent and sibling pages, and works with the workspace tools; system pages stay closed to it.")}</p>
        </div>
      )}

        </>
      )}
      {tab === "permissions" && view.kind === "automation" && <p className="text-xs text-zinc-500">{t("An automation does only what its steps say — nothing else. Its steps run inside Zeff; they send nothing out by themselves.")}</p>}

      {tab === "reports" && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">{t("One report per session: the agent writes it (tell it to report); it is final when you give your OK — tick its todo off, or press the button.")}</p>
          {reports.length === 0 ? (
            <p className="text-xs text-zinc-400">{t("No reports yet.")}</p>
          ) : (
            reports.map((r) => (
              <article key={r.id} className="space-y-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <header className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === "final" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>{r.status === "final" ? t("Final") : t("Waiting for your OK")}</span>
                  <span className="text-xs text-zinc-500">{new Date(r.finalAt ?? r.updatedAt).toLocaleString()}</span>
                  <span className="flex-1" />
                  {r.status === "draft" && editable && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={async () => void ((x) => (x.ok ? routineReportsAction(pageId).then((y) => y.ok && setReports(y.reports)) : toast(x.error, { tone: "error" })))(await approveReportAction(r.id))}>
                      ✓ {t("OK — accept")}
                    </button>
                  )}
                </header>
                <pre className="max-h-96 overflow-auto text-xs whitespace-pre-wrap">{r.body}</pre>
              </article>
            ))
          )}
        </div>
      )}

      {tab === "log" && (
        <>
      <div className="space-y-1">
        <h4 className="flex items-center gap-2 text-xs font-semibold text-zinc-500 uppercase">
          {t("Every run")}
          <button type="button" className="text-xs font-normal normal-case text-indigo-600 hover:underline dark:text-indigo-400" onClick={load}>
            ↻
          </button>
        </h4>
        {allRuns.length === 0 ? (
          <p className="text-xs text-zinc-400">{t("None yet.")}</p>
        ) : (
          <ul className="space-y-1">
            {allRuns.map((r) => (
              <li key={r.id}>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-2">
                    <span className={r.status === "failed" ? "text-red-600" : r.status === "running" ? "text-indigo-600" : r.status === "stopped" ? "text-amber-600" : "text-emerald-600"}>{r.status}</span>
                    <span className="text-xs text-zinc-500">
                      {new Date(r.startedAt).toLocaleString()} · {r.trigger.kind}
                    </span>
                    {r.workRunId && (
                      <Link href={`/work?run=${r.workRunId}`} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={(e) => e.stopPropagation()}>
                        W-{r.workRunId} ↗
                      </Link>
                    )}
                    {r.error && <span className="text-xs text-red-600">{r.error}</span>}
                  </summary>
                  <ul className="ml-4 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                    {r.log.map((l, i) => (
                      <li key={i} style={{ paddingLeft: (l.depth ?? 0) * 12 }}>
                        <span className={l.status === "failed" ? "text-red-600" : l.status === "skipped" ? "text-zinc-400" : ""}>{l.status}</span> {l.kind}: {l.note}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
        {more && view.runs.length >= 10 && (
          <button type="button" className="btn btn-sm" disabled={loadingMore} onClick={() => void loadOlder()}>
            {t("Load older runs")}
          </button>
        )}
      </div>
        </>
      )}
    </section>
  );
}

/** The run going on: since when, how its worker stands, what it did last — and its session on the Code tab. */
function LiveRun({ live }: { live: NonNullable<RoutineView["live"]> }) {
  const t = useT();
  return (
    <div className="space-y-1 rounded-md border border-indigo-200 bg-indigo-50/50 p-2 text-xs dark:border-indigo-900 dark:bg-indigo-950/30" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-2 animate-pulse rounded-full bg-indigo-500" aria-hidden />
        <span className="font-medium">{t("Running since {when}", { when: new Date(live.startedAt).toLocaleTimeString() })}</span>
        <span className="text-zinc-500">{live.workRunId ? (live.workStatus ?? "") : t("The worker is starting …")}</span>
        <span className="flex-1" />
        {live.workRunId && (
          <Link href={`/work?run=${live.workRunId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Open the session")} W-{live.workRunId} ↗
          </Link>
        )}
      </div>
      {live.activity.length > 0 && (
        <ul className="space-y-0.5 font-mono text-zinc-600 dark:text-zinc-400">
          {live.activity.map((a, i) => (
            <li key={i} className={`truncate ${i === live.activity.length - 1 ? "text-zinc-900 dark:text-zinc-100" : ""}`} title={a}>
              {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TriggerLine({ tr, choices, editable, onChange }: { tr: Trigger; choices: Choices; editable: boolean; onChange: (t: Trigger) => void }) {
  const t = useT();
  if (tr.kind === "manual") return <span>✋ {t("By hand")}</span>;
  if (tr.kind === "called") return <span>📞 {t("When called (another routine, an auto action, a worker)")}</span>;
  if (tr.kind === "schedule" && tr.everyMinutes)
    return (
      <span className="flex items-center gap-1.5">
        ⏱ {t("Every")}
        <input type="number" min={1} className="input w-20 py-0.5 text-sm" value={tr.everyMinutes} disabled={!editable} onChange={(e) => onChange({ kind: "schedule", everyMinutes: Math.max(1, Number(e.target.value) || 1) })} aria-label={t("Minutes")} />
        {t("minutes")}
      </span>
    );
  if (tr.kind === "schedule" && tr.monthDay)
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        📅 {t("Monthly on day")}
        <input type="number" min={1} max={28} className="input w-16 py-0.5 text-sm" value={tr.monthDay} disabled={!editable} onChange={(e) => onChange({ ...tr, monthDay: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} aria-label={t("Day of the month")} />
        {t("at")}
        <input type="time" className="input w-28 py-0.5 text-sm" value={tr.at ?? "08:00"} disabled={!editable} onChange={(e) => onChange({ ...tr, at: e.target.value || "08:00" })} aria-label={t("Time")} />
      </span>
    );
  if (tr.kind === "schedule")
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        🕗 {t("At")}
        <input type="time" className="input w-28 py-0.5 text-sm" value={tr.at ?? "08:00"} disabled={!editable} onChange={(e) => onChange({ ...tr, at: e.target.value || "08:00" })} aria-label={t("Time")} />
        {DAYS.map((d, i) => {
          const on = !tr.days?.length || tr.days.includes(i);
          return (
            <button
              key={d}
              type="button"
              disabled={!editable}
              aria-pressed={on}
              className={`rounded border px-1 text-xs ${on ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-zinc-200 text-zinc-400 dark:border-zinc-700"}`}
              onClick={() => {
                const cur = tr.days?.length ? tr.days : [0, 1, 2, 3, 4, 5, 6];
                const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort();
                onChange({ ...tr, days: next.length === 7 || !next.length ? undefined : next });
              }}
            >
              {d}
            </button>
          );
        })}
      </span>
    );
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      ⚡
      <select className="input w-auto py-0.5 text-sm" value={tr.event} disabled={!editable} onChange={(e) => onChange({ ...tr, event: e.target.value as "row.added" })} aria-label={t("Event")}>
        <option value="row.added">{t("A row is added")}</option>
        <option value="row.changed">{t("A row is changed")}</option>
        <option value="row.removed">{t("A row is moved to the trash")}</option>
        <option value="pipeline.ran">{t("A database's sources were read")}</option>
        <option value="signal">{t("A signal is sent")}</option>
      </select>
      {tr.event === "signal" ? (
        <input className="input w-48 py-0.5 text-sm" placeholder={t("Signal name")} value={tr.name ?? ""} disabled={!editable} onChange={(e) => onChange({ ...tr, name: e.target.value })} aria-label={t("Signal name")} />
      ) : (
        <>
      {t("in")}
      <select className="input w-auto py-0.5 text-sm" value={tr.db ?? ""} disabled={!editable} onChange={(e) => onChange({ ...tr, db: Number(e.target.value) || undefined })} aria-label={t("Database")}>
        <option value="">{t("any database")}</option>
        {choices.databases.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
      </select>
      {tr.event === "row.changed" && <input className="input w-32 py-0.5 text-sm" placeholder={t("field (any)")} value={tr.field ?? ""} disabled={!editable} onChange={(e) => onChange({ ...tr, field: e.target.value || undefined })} aria-label={t("Field")} />}
      {tr.event === "row.changed" && tr.field && <input className="input w-32 py-0.5 text-sm" placeholder={t("becomes … (any)")} value={tr.equals ?? ""} disabled={!editable} onChange={(e) => onChange({ ...tr, equals: e.target.value || undefined })} aria-label={t("Value")} />}
        </>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const STEP_KINDS = ["set", "create", "archive", "pipeline", "run", "call", "signal", "notify", "stop", "if", "foreach"] as const;
const newStep = (kind: (typeof STEP_KINDS)[number]): Step => {
  const id = `st_${Math.random().toString(36).slice(2, 8)}`;
  switch (kind) {
    case "set":
      return { id, kind, field: "", value: "" };
    case "create":
      return { id, kind, db: 0, title: "" };
    case "pipeline":
      return { id, kind, db: 0 };
    case "run":
      return { id, kind, page: 0 };
    case "notify":
      return { id, kind, text: "" };
    case "call":
      return { id, kind, method: "", params: {} };
    case "signal":
      return { id, kind, name: "" };
    case "stop":
      return { id, kind };
    case "if":
      return { id, kind, when: { rules: [{ field: "", op: "is", value: "" }] }, then: [], else: [] };
    case "foreach":
      return { id, kind, db: 0, steps: [] };
    default:
      return { id, kind: "archive" };
  }
};

function StepList({ steps, choices, editable, onChange, depth = 0 }: { steps: Step[]; choices: Choices; editable: boolean; onChange: (s: Step[]) => void; depth?: number }) {
  const t = useT();
  const labels: Record<(typeof STEP_KINDS)[number], string> = {
    set: t("Set a field of the row"),
    create: t("Make a row"),
    archive: t("Move the row to the trash"),
    pipeline: t("Read a database's sources again"),
    run: t("Run another routine"),
    call: t("Call a function of a plugin"),
    signal: t("Send a signal"),
    notify: t("Note"),
    stop: t("Gate: stop (when …)"),
    if: t("If … then … else"),
    foreach: t("For each row of a database"),
  };
  const set = (i: number, s: Step) => onChange(steps.map((x, k) => (k === i ? s : x)));
  return (
    <div className="space-y-1.5" style={depth ? { paddingLeft: 12, borderLeft: "2px solid rgba(113,113,122,.25)" } : undefined}>
      {steps.map((s, i) => (
        <div key={s.id} className="space-y-1 rounded-md bg-zinc-50 p-2 dark:bg-zinc-900/50" data-step={s.kind}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-xs text-zinc-400">{i + 1}</span>
            <span className="font-medium">{labels[s.kind]}</span>
            <span className="flex-1" />
            {editable && (
              <>
                <button type="button" className="icon-btn" disabled={i === 0} aria-label={t("Up")} onClick={() => onChange(steps.map((x, k) => (k === i - 1 ? steps[i] : k === i ? steps[i - 1] : x)))}>
                  ↑
                </button>
                <button type="button" className="icon-btn" disabled={i === steps.length - 1} aria-label={t("Down")} onClick={() => onChange(steps.map((x, k) => (k === i + 1 ? steps[i] : k === i ? steps[i + 1] : x)))}>
                  ↓
                </button>
                <button type="button" className="icon-btn" aria-label={t("Remove the step")} onClick={() => onChange(steps.filter((_, k) => k !== i))}>
                  ✕
                </button>
              </>
            )}
          </div>
          <StepBody s={s} choices={choices} editable={editable} onChange={(next) => set(i, next)} depth={depth} />
        </div>
      ))}
      {editable && (
        <select className="input w-auto py-0.5 text-sm" value="" onChange={(e) => e.target.value && onChange([...steps, newStep(e.target.value as (typeof STEP_KINDS)[number])])} aria-label={t("Add a step")}>
          <option value="">＋ {t("Add a step …")}</option>
          {STEP_KINDS.map((k) => (
            <option key={k} value={k}>
              {labels[k]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function DbSelect({ value, choices, onChange, editable }: { value: number; choices: Choices; onChange: (id: number) => void; editable: boolean }) {
  const t = useT();
  return (
    <select className="input w-auto py-0.5 text-sm" value={value || ""} disabled={!editable} onChange={(e) => onChange(Number(e.target.value))} aria-label={t("Database")}>
      <option value="">{t("Pick a database …")}</option>
      {choices.databases.map((d) => (
        <option key={d.id} value={d.id}>
          {d.title}
        </option>
      ))}
    </select>
  );
}

function StepBody({ s, choices, editable, onChange, depth }: { s: Step; choices: Choices; editable: boolean; onChange: (s: Step) => void; depth: number }) {
  const t = useT();
  const text = (value: string, on: (v: string) => void, placeholder: string, width = "w-48") => <input className={`input ${width} py-0.5 text-sm`} value={value} disabled={!editable} placeholder={placeholder} onChange={(e) => on(e.target.value)} aria-label={placeholder} />;
  switch (s.kind) {
    case "set":
      return (
        <div className="flex flex-wrap items-center gap-2">
          {text(s.field, (field) => onChange({ ...s, field }), t("Field"), "w-36")}
          {t("to")}
          {text(s.value, (value) => onChange({ ...s, value }), t("Value, or a template"), "w-64")}
        </div>
      );
    case "create":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <DbSelect value={s.db} choices={choices} editable={editable} onChange={(db) => onChange({ ...s, db })} />
          {text(s.title, (title) => onChange({ ...s, title }), t("Title, or a template"), "w-64")}
        </div>
      );
    case "pipeline":
      return <DbSelect value={s.db} choices={choices} editable={editable} onChange={(db) => onChange({ ...s, db })} />;
    case "run":
      return (
        <select className="input w-auto py-0.5 text-sm" value={s.page || ""} disabled={!editable} onChange={(e) => onChange({ ...s, page: Number(e.target.value) })} aria-label={t("Routine")}>
          <option value="">{t("Pick a routine …")}</option>
          {choices.routines.map((r) => (
            <option key={r.id} value={r.id}>
              {r.kind === "agent" ? "🤖" : "⚙️"} {r.title}
            </option>
          ))}
        </select>
      );
    case "notify":
      return text(s.text, (v) => onChange({ ...s, text: v }), t("Text, or a template"), "w-96");
    case "call": {
      const m = choices.methods.find((x) => x.name === s.method);
      return (
        <div className="space-y-1.5">
          <select className="input w-auto py-0.5 text-sm" value={s.method} disabled={!editable} onChange={(e) => onChange({ ...s, method: e.target.value, params: {} })} aria-label={t("Function")}>
            <option value="">{t("Pick a function …")}</option>
            {choices.methods.map((x) => (
              <option key={x.name} value={x.name}>
                {x.label}
              </option>
            ))}
          </select>
          {m &&
            Object.entries(m.fields).map(([k, hint]) => (
              <label key={k} className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="w-24 shrink-0 font-mono">{k}</span>
                <input className="input w-96 py-0.5 text-sm" value={s.params[k] ?? ""} disabled={!editable} placeholder={hint} title={hint} onChange={(e) => onChange({ ...s, params: { ...s.params, [k]: e.target.value } })} aria-label={k} />
              </label>
            ))}
        </div>
      );
    }
    case "signal":
      return (
        <div className="space-y-1.5">
          {text(s.name, (name) => onChange({ ...s, name }), t("Signal name, e.g. invoice.paid"), "w-72")}
          {Object.entries(s.payload ?? {}).map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-center gap-2">
              <span className="w-24 shrink-0 font-mono text-xs text-zinc-500">{k}</span>
              {text(v, (val) => onChange({ ...s, payload: { ...s.payload, [k]: val } }), t("Value, or a template"), "w-72")}
              {editable && (
                <button type="button" className="icon-btn" aria-label={t("Remove")} onClick={() => onChange({ ...s, payload: Object.fromEntries(Object.entries(s.payload ?? {}).filter(([x]) => x !== k)) })}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {editable && (
            <button type="button" className="btn btn-sm" onClick={() => onChange({ ...s, payload: { ...s.payload, [`key${Object.keys(s.payload ?? {}).length + 1}`]: "" } })}>
              ＋ {t("Detail")}
            </button>
          )}
        </div>
      );
    case "stop":
      return (
        <div className="space-y-1">
          <p className="text-xs text-zinc-500">{s.when ? t("The run stops here when:") : t("The run always stops here (add a condition to make it a gate).")}</p>
          <ConditionEditor cond={s.when} editable={editable} onChange={(when) => onChange({ ...s, when })} optional />
        </div>
      );
    case "if":
      return (
        <div className="space-y-1.5">
          <ConditionEditor cond={s.when} editable={editable} onChange={(when) => when && onChange({ ...s, when })} />
          <p className="text-xs font-medium text-zinc-500">{t("then")}</p>
          <StepList steps={s.then} choices={choices} editable={editable} depth={depth + 1} onChange={(then) => onChange({ ...s, then })} />
          <p className="text-xs font-medium text-zinc-500">{t("else")}</p>
          <StepList steps={s.else} choices={choices} editable={editable} depth={depth + 1} onChange={(els) => onChange({ ...s, else: els })} />
        </div>
      );
    case "foreach":
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <DbSelect value={s.db} choices={choices} editable={editable} onChange={(db) => onChange({ ...s, db })} />
            <span className="text-xs text-zinc-500">{t("where")}</span>
          </div>
          <ConditionEditor cond={s.where} editable={editable} onChange={(where) => onChange({ ...s, where })} optional />
          <p className="text-xs font-medium text-zinc-500">{t("do, for each of those rows")}</p>
          <StepList steps={s.steps} choices={choices} editable={editable} depth={depth + 1} onChange={(steps) => onChange({ ...s, steps })} />
        </div>
      );
    default:
      return null;
  }
}

function ConditionEditor({ cond, editable, onChange, optional = false }: { cond: Condition | undefined; editable: boolean; onChange: (c: Condition | undefined) => void; optional?: boolean }) {
  const t = useT();
  const rules = cond?.rules ?? [];
  const set = (rs: Condition["rules"]) => onChange(rs.length || !optional ? { ...(cond?.match === "any" ? { match: "any" as const } : {}), rules: rs } : undefined);
  const ops: Record<(typeof FILTER_OPS)[number], string> = { contains: t("contains"), not_contains: t("doesn't contain"), is: t("is"), is_not: t("isn't"), empty: t("is empty"), not_empty: t("isn't empty") };
  return (
    <div className="space-y-1">
      {rules.length > 1 && (
        <select className="input w-auto py-0.5 text-xs" value={cond?.match ?? "all"} disabled={!editable} onChange={(e) => onChange({ rules, ...(e.target.value === "any" ? { match: "any" as const } : {}) })} aria-label={t("Match")}>
          <option value="all">{t("all of these")}</option>
          <option value="any">{t("any of these")}</option>
        </select>
      )}
      {rules.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <input className="input w-32 py-0.5 text-sm" value={r.field} disabled={!editable} placeholder={t("Field")} onChange={(e) => set(rules.map((x, k) => (k === i ? { ...x, field: e.target.value } : x)))} aria-label={t("Field")} />
          <select className="input w-auto py-0.5 text-sm" value={r.op} disabled={!editable} onChange={(e) => set(rules.map((x, k) => (k === i ? { ...x, op: e.target.value as (typeof FILTER_OPS)[number] } : x)))} aria-label={t("Condition")}>
            {FILTER_OPS.map((o) => (
              <option key={o} value={o}>
                {ops[o]}
              </option>
            ))}
          </select>
          {r.op !== "empty" && r.op !== "not_empty" && <input className="input w-40 py-0.5 text-sm" value={r.value ?? ""} disabled={!editable} placeholder={t("Value")} onChange={(e) => set(rules.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} aria-label={t("Value")} />}
          {editable && (rules.length > 1 || optional) && (
            <button type="button" className="icon-btn" aria-label={t("Remove")} onClick={() => set(rules.filter((_, k) => k !== i))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {editable && (
        <button type="button" className="btn btn-sm" onClick={() => set([...rules, { field: "", op: "is", value: "" }])}>
          ＋ {t("Condition")}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------

function RoutineBlockView({ editor, extension }: NodeViewProps) {
  const pageId = Number((extension.options as { pageId: number }).pageId);
  return (
    <NodeViewWrapper className="ws-routine-block my-2" contentEditable={false} data-app-block="routine">
      <RoutineControls pageId={pageId} editable={editor.isEditable} />
    </NodeViewWrapper>
  );
}

/** The controls of an agent or an automation, as the first block of its page. */
export const ZeffRoutine = Node.create<{ pageId: number }>({
  name: "zeffRoutine",
  group: "block",
  atom: true,
  addOptions() {
    return { pageId: 0 };
  },
  parseHTML() {
    return [{ tag: "div[data-zeff-routine]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-zeff-routine": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RoutineBlockView);
  },
});

/** What a routine would do (a dry run): the fields it would set, the rows it would make and move to the trash, the step log. */
function DryRunPanel({ plan, onClose }: { plan: DryRun & { row: { id: number; title: string } | null }; onClose: () => void }) {
  const t = useT();
  const nothing = !plan.changes.length && !plan.made.length && !plan.trashed.length;
  return (
    <div className="space-y-2 rounded-md border border-dashed border-indigo-300 bg-indigo-50/50 p-2.5 text-xs dark:border-indigo-800 dark:bg-indigo-950/30">
      <div className="flex items-center gap-2">
        <span className="font-semibold">🧪 {t("Tried — nothing was changed")}</span>
        {plan.row && <span className="text-zinc-500">{t("on “{row}”", { row: plan.row.title || t("Untitled") })}</span>}
        <span className="flex-1" />
        <button type="button" className="rounded px-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800" aria-label={t("Close")} onClick={onClose}>
          ✕
        </button>
      </div>
      {plan.error && <p className="text-red-600 dark:text-red-400">{plan.error}</p>}
      {nothing ? (
        <p className="text-zinc-500">{t("It would change nothing in the Workspace.")}</p>
      ) : (
        <ul className="space-y-0.5">
          {plan.changes.map((c, i) => (
            <li key={`c${i}`}>
              <span className="font-medium">{c.title || t("Untitled")}</span> · {c.field}: <span className="text-zinc-400 line-through">{c.from || "∅"}</span> → {c.to || "∅"}
              {c.cause?.includes(" › ") && <span className="text-zinc-400"> ({c.cause.split(" › ").slice(1).join(" › ")})</span>}
            </li>
          ))}
          {plan.made.map((m) => (
            <li key={`m${m.page}`}>＋ {t("New row")}: <span className="font-medium">{m.title || t("Untitled")}</span></li>
          ))}
          {plan.trashed.map((m) => (
            <li key={`t${m.page}`}>🗑 {t("To the trash")}: <span className="font-medium">{m.title || t("Untitled")}</span></li>
          ))}
        </ul>
      )}
      <ol className="space-y-0.5 border-t border-indigo-200 pt-1.5 text-zinc-500 dark:border-indigo-900">
        {plan.log.map((l, i) => (
          <li key={i} style={{ paddingLeft: (l.depth ?? 0) * 12 }}>
            {l.status === "failed" ? "✗" : l.status === "skipped" ? "–" : "✓"} {l.kind}: {l.note}
          </li>
        ))}
      </ol>
    </div>
  );
}
