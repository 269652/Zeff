"use client";

import { useEffect, useState } from "react";
import { saveSyncIntervalAction } from "@/app/actions";
import { toast } from "@/components/Toaster";
import { minutesText } from "@/plugins/sync-settings";
import { sourceSyncsAction } from "../actions";
import { useT } from "@/components/I18nProvider";
import { ATTENTIONS } from "@/lib/boards/shared";
import { newId, type JiraCriteria, type Pipeline, type PipelineSource, type PipelineStep } from "../model";
import { Dropdown, MenuItem, Modal } from "./kit";

/**
 * A database's pipeline as blocks — where its rows come from (Jira by criteria, Google Keep, the todos, another
 * database), filters, AI steps (a field on each row, a summary over all) — edited, saved, run.
 */

const ICON: Record<string, string> = { jira: "🎫", keep: "🗒", todos: "☑", database: "🗃", filter: "⏷", field: "✨", summary: "🧭" };
const iconOf = (s: PipelineStep) => ICON[s.kind === "source" ? (s.from ?? "") : s.kind === "filter" ? "filter" : (s.output ?? "")];

/** The example "My briefing": your Jira tickets of the last 14 days, commented, open — their Lage, one overall picture. */
export const BRIEFING_EXAMPLE = (): PipelineStep[] => [
  { id: newId("s"), kind: "source", from: "jira", jira: { mine: true, recentDays: 14, commented: true, openOnly: true } },
  { id: newId("s"), kind: "ai", output: "field", prop: "lageattention", name: "Attention", choices: [...ATTENTIONS], prompt: "Wie das Ticket steht: feedback (Rückfrage offen), active (in Arbeit), check (Test/Review/Abnahme), spec (Anforderung unklar), blocked (wartet auf andere), ready (bereit), stale (seit Wochen ohne Bewegung)." },
  { id: newId("s"), kind: "ai", output: "field", prop: "lagelead", name: "Lage", prompt: "EIN Satz — wie es steht, was als Nächstes passieren muss und wer dran ist. Nüchtern, konkret, nichts erfinden." },
  { id: newId("s"), kind: "ai", output: "summary", prompt: "Die Gesamtlage: was gerade brennt, was als Nächstes kommt, worauf ich warte — in wenigen Sätzen, die wichtigsten Tickets mit Schlüssel." },
];

export function PipelineEditor({ dbId, pipeline, synced, databases, onSave, onRun, onClose }: { dbId: number; pipeline: Pipeline | undefined; synced: string | null; databases: { id: number; title: string }[]; onSave: (p: Pipeline) => Promise<void>; onRun: (ai: boolean) => Promise<void>; onClose: () => void }) {
  const t = useT();
  // A database a sync keeps: the sync is its source — only AI steps of its own.
  const [steps, setSteps] = useState<PipelineStep[]>((pipeline?.steps ?? []).filter((s) => !synced || s.kind === "ai"));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(steps) !== JSON.stringify(pipeline?.steps ?? []);
  const runnable = synced ? steps.some((s) => s.kind === "ai") : steps.some((s) => s.kind === "source");
  const syncName = synced === "jira" ? "Jira" : synced === "google-keep" ? "Google Keep" : synced;
  const set = (i: number, patch: Partial<PipelineStep>) => setSteps((ss) => ss.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => setSteps((ss) => {
    const next = [...ss];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  const add = (s: Omit<PipelineStep, "id">) => setSteps((ss) => [...ss, { id: newId("s"), ...s }]);
  const source = (from: PipelineSource) => add({ kind: "source", from, ...(from === "jira" ? { jira: { mine: true, recentDays: 14, openOnly: true } } : {}) });
  const save = async (run?: { ai: boolean }) => {
    setBusy(true);
    try {
      if (dirty) await onSave({ ...pipeline, steps });
      // Saved: what Zeff already has from the sources comes in at once (the AI by hand, or with the briefing).
      if (run || (dirty && runnable && !synced)) await onRun(run?.ai ?? false);
    } finally {
      setBusy(false);
    }
  };
  const labels: Record<string, string> = { jira: t("Jira tickets"), keep: t("Google Keep notes"), todos: t("Todos"), database: t("Another database"), filter: t("Filter"), field: t("AI: a field on each row"), summary: t("AI: one summary over all rows") };
  return (
    <Modal title={t("Sources & steps …")} onClose={onClose} wide>
      <p className="text-sm text-zinc-500">{t("Where this database's rows come from and what's done with them, top to bottom. A run keeps the result as its rows (yours stay: AI fields, pages); the AI steps go with the briefing.")}</p>
      {synced && (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" data-step="sync">
          <span aria-hidden>{synced === "jira" ? ICON.jira : ICON.keep}</span>
          <span className="font-medium">{t("Kept by the {name} sync", { name: syncName ?? "" })}</span>
          <span className="text-zinc-500">— {t("its rows are this database's source; the AI steps below run over them")}</span>
        </div>
      )}
      {!steps.length && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm dark:border-zinc-700">
          {t("No steps yet: the rows are your own.")}{" "}
          <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setSteps(BRIEFING_EXAMPLE().filter((s) => !synced || s.kind === "ai"))}>
            {t("Start from the example “My briefing”")}
          </button>
        </div>
      )}
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.id} className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700" data-step={s.kind}>
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
              <span aria-hidden>{iconOf(s)}</span>
              <span className="flex-1">{labels[s.kind === "source" ? (s.from ?? "") : s.kind === "filter" ? "filter" : (s.output ?? "")]}</span>
              <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Up")}>↑</button>
              <button type="button" className="icon-btn" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={t("Down")}>↓</button>
              <button type="button" className="icon-btn" onClick={() => setSteps((ss) => ss.filter((_, k) => k !== i))} aria-label={t("Remove the step")}>✕</button>
            </div>
            <StepBody step={s} set={(p) => set(i, p)} databases={databases.filter((d) => d.id !== dbId)} />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-1.5">
        {!synced && (
          <Dropdown label={`+ ${t("Source")}`} className="btn btn-sm">
          {(close) => (["jira", "keep", "todos", "database"] as const).map((f) => (
            <MenuItem key={f} onClick={() => (close(), source(f))}>
              {ICON[f]} {labels[f]}
            </MenuItem>
          ))}
        </Dropdown>
        )}
        {!synced && <button type="button" className="btn btn-sm" onClick={() => add({ kind: "filter", openOnly: true })}>+ {t("Filter")}</button>}
        <button type="button" className="btn btn-sm" onClick={() => add({ kind: "ai", output: "field", name: t("Lage"), prompt: "" })}>+ ✨ {t("AI field")}</button>
        <button type="button" className="btn btn-sm" onClick={() => add({ kind: "ai", output: "summary", prompt: "" })}>+ 🧭 {t("AI summary")}</button>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-700">
        {pipeline?.ranAt && <span className="mr-auto text-xs text-zinc-500">{t("Last run {when}", { when: new Date(pipeline.ranAt).toLocaleString() })}</span>}
        <button type="button" className="btn btn-sm" disabled={busy || !dirty} onClick={() => void save()}>{t("Save")}</button>
        {!synced && <button type="button" className="btn btn-sm" disabled={busy || !runnable} onClick={() => void save({ ai: false })}>{t("Run without AI")}</button>}
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !runnable} onClick={() => void save({ ai: true })}>{busy ? "…" : `✨ ${t("Run now")}`}</button>
      </div>
    </Modal>
  );
}

/** How often a source's sync reads it (Jira, Google Keep) — its pipelines refresh after each. */
export function SyncEvery({ syncKey, name }: { syncKey: "jira" | "keep"; name: string }) {
  const t = useT();
  const [sync, setSync] = useState<{ minutes: number; choices: number[] } | null>(null);
  useEffect(() => {
    void sourceSyncsAction().then((r) => r.ok && setSync(r.syncs[syncKey] ?? null));
  }, [syncKey]);
  if (!sync) return null;
  return (
    <label className="flex items-center gap-1.5 text-sm text-zinc-500">
      {t("{name} is read", { name })}
      <select
        className="input w-auto text-sm"
        value={sync.minutes}
        onChange={async (e) => {
          const minutes = Number(e.target.value);
          const r = await saveSyncIntervalAction(syncKey, minutes);
          if (!r?.ok) return void toast(r?.error ?? t("Failed."), { tone: "error" });
          setSync({ ...sync, minutes });
        }}
      >
        {sync.choices.map((m) => (
          <option key={m} value={m}>
            {minutesText(m, t)}
          </option>
        ))}
      </select>
      <span>{t("— the pipelines reading it refresh after each read")}</span>
    </label>
  );
}

function Check({ label, on, set }: { label: string; on: boolean | undefined; set: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <input type="checkbox" checked={!!on} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
}

function Days({ label, value, set }: { label: string; value: number | undefined; set: (v: number | undefined) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      {label}
      <input type="number" min={1} className="input w-16 text-sm" value={value ?? ""} onChange={(e) => set(Number(e.target.value) > 0 ? Math.floor(Number(e.target.value)) : undefined)} />
    </label>
  );
}

function StepBody({ step: s, set, databases }: { step: PipelineStep; set: (p: Partial<PipelineStep>) => void; databases: { id: number; title: string }[] }) {
  const t = useT();
  const row = "flex flex-wrap items-center gap-x-4 gap-y-1.5";
  if (s.kind === "source" && s.from === "jira") {
    const j = s.jira ?? {};
    const setJ = (p: Partial<JiraCriteria>) => set({ jira: { ...j, ...p } });
    return (
      <div className={row}>
        <Check label={t("Assigned to me")} on={j.mine} set={(v) => setJ({ mine: v })} />
        <Check label={t("Or followed by me")} on={j.involved} set={(v) => setJ({ involved: v })} />
        <Check label={t("Or in the Ticket-Lage")} on={j.briefed} set={(v) => setJ({ briefed: v })} />
        <Check label={t("Open only")} on={j.openOnly} set={(v) => setJ({ openOnly: v })} />
        {j.openOnly && <Days label={t("Done within days still in")} value={j.doneDays} set={(v) => setJ({ doneDays: v })} />}
        <Days label={t("Changed within days")} value={j.recentDays} set={(v) => setJ({ recentDays: v })} />
        <Check label={t("With a comment in that time")} on={j.commented} set={(v) => setJ({ commented: v })} />
        <label className="flex items-center gap-1.5 text-sm">
          {t("Projects")}
          <input className="input w-40 text-sm" placeholder="PROJ, DISNEY" value={(j.projects ?? []).join(", ")} onChange={(e) => setJ({ projects: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
        </label>
        <SyncEvery syncKey="jira" name="Jira" />
      </div>
    );
  }
  if (s.kind === "source" && s.from === "keep")
    return (
      <div className={row}>
        <label className="flex items-center gap-1.5 text-sm">
          {t("Only the label")}
          <input className="input w-48 text-sm" placeholder={t("(all notes)")} value={s.label ?? ""} onChange={(e) => set({ label: e.target.value || undefined })} />
        </label>
        <SyncEvery syncKey="keep" name="Google Keep" />
      </div>
    );
  if (s.kind === "source" && s.from === "todos")
    return (
      <select className="input w-auto text-sm" value={s.todoStatus ?? "open"} onChange={(e) => set({ todoStatus: e.target.value === "all" ? "all" : undefined })} aria-label={t("Which todos")}>
        <option value="open">{t("Open todos")}</option>
        <option value="all">{t("Open and done todos")}</option>
      </select>
    );
  if (s.kind === "source" && s.from === "database")
    return (
      <select className="input w-auto text-sm" value={s.dbId ?? ""} onChange={(e) => set({ dbId: Number(e.target.value) || undefined })} aria-label={t("Which database")}>
        <option value="">{t("Pick a database …")}</option>
        {databases.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
      </select>
    );
  if (s.kind === "filter")
    return (
      <div className={row}>
        <label className="flex items-center gap-1.5 text-sm">
          {t("Containing")}
          <input className="input w-40 text-sm" value={s.text ?? ""} onChange={(e) => set({ text: e.target.value || undefined })} />
        </label>
        <Check label={t("Open only")} on={s.openOnly} set={(v) => set({ openOnly: v })} />
        <Days label={t("Changed within days")} value={s.recentDays} set={(v) => set({ recentDays: v })} />
        <Days label={t("At most")} value={s.limit} set={(v) => set({ limit: v })} />
      </div>
    );
  if (s.kind === "ai" && s.output === "field")
    return (
      <div className="space-y-1.5">
        <div className={row}>
          <label className="flex items-center gap-1.5 text-sm">
            {t("Field")}
            <input className="input w-40 text-sm" value={s.name ?? ""} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="flex flex-1 items-center gap-1.5 text-sm">
            {t("Choices")}
            <input className="input flex-1 text-sm" placeholder={t("(free text)")} value={(s.choices ?? []).join(", ")} onChange={(e) => set({ choices: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </label>
        </div>
        <textarea className="input min-h-16 w-full text-sm" placeholder={t("What the AI writes into the field, for each row …")} value={s.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} />
      </div>
    );
  if (s.kind === "ai" && s.output === "summary")
    return (
      <div className="space-y-1.5">
        <textarea className="input min-h-16 w-full text-sm" placeholder={t("What the AI writes over all rows …")} value={s.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} />
        {s.result?.text && <p className="whitespace-pre-wrap rounded bg-zinc-50 p-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{s.result.text}</p>}
      </div>
    );
  return null;
}

/** What the pipeline's summaries wrote, above the database's view. */
export function PipelineSummaries({ pipeline }: { pipeline: Pipeline | undefined }) {
  const t = useT();
  const done = (pipeline?.steps ?? []).filter((s) => s.kind === "ai" && s.output === "summary" && s.result?.text);
  if (!done.length) return null;
  return (
    <div className="space-y-2">
      {done.map((s) => (
        <div key={s.id} className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/30" data-summary>
          <p className="whitespace-pre-wrap">{s.result!.text}</p>
          <p className="mt-1 text-xs text-zinc-500">🧭 {t("AI summary · {when}", { when: new Date(s.result!.at).toLocaleString() })}</p>
        </div>
      ))}
    </div>
  );
}
