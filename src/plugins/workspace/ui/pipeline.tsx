"use client";

import { Fragment, useEffect, useId, useState } from "react";
import { saveSyncIntervalAction } from "@/app/actions";
import { Markdown } from "@/components/Markdown";
import { toast } from "@/components/Toaster";
import { minutesText } from "@/plugins/sync-settings";
import { RunLog } from "./RunLog";
import { previewJoinAction, previewSetAction, previewAiFilterAction, instructionsAction, newInstructionAction, rejudgeAction, sourceSyncsAction } from "../actions";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { ATTENTIONS } from "@/lib/runs/shared";
import { FILTER_OPS, newId, type DataType, type FilterRule, type JiraCriteria, type Pipeline, type PipelineSource, type PipelineStep } from "../model";
import { Dropdown, MenuItem, Modal } from "./kit";

/**
 * A database's pipeline as blocks — where its rows come from (Jira by criteria, Google Keep, the todos, another
 * database), filters, AI steps (a field on each row, a summary over all) — edited, saved, run.
 */

const ICON: Record<string, string> = { noise: "🔇", write: "📤", aifilter: "🔎", actions: "⚡", jira: "🎫", keep: "🗒", todos: "☑", database: "🗃", mail: "✉", messages: "💬", knowledge: "📚", rules: "📏", filter: "⏷", sort: "⇅", set: "🏷", join: "🔗", field: "✨", summary: "🧭" };
const kindOf = (s: PipelineStep) => (s.kind === "source" ? (s.from ?? "") : s.kind === "ai" ? (s.output === "filter" ? "aifilter" : (s.output ?? "")) : s.kind === "filter" && s.noise === "hide" && !s.rules?.length && !s.text ? "noise" : s.kind);
const iconOf = (s: PipelineStep) => ICON[kindOf(s)];

/** The example "My briefing": your Jira tickets of the last 14 days, commented, open — their Lage, one overall picture (its prompts in the UI language). */
export const BRIEFING_EXAMPLE = (t: T): PipelineStep[] => [
  { id: newId("s"), kind: "source", from: "jira", jira: { mine: true, recentDays: 14, commented: true, openOnly: true } },
  { id: newId("s"), kind: "ai", output: "field", prop: "lageattention", name: t("Attention"), choices: [...ATTENTIONS], prompt: t("How the ticket stands: feedback (a question open), active (being worked on), check (test/review/acceptance), spec (requirement unclear), blocked (waiting for others), ready (ready), stale (no movement for weeks).") },
  { id: newId("s"), kind: "ai", output: "field", prop: "lagelead", name: t("Briefing"), prompt: t("ONE sentence — how it stands, what has to happen next and whose turn it is. Sober, concrete, invent nothing.") },
  { id: newId("s"), kind: "ai", output: "summary", prompt: t("The overall picture: what is burning right now, what comes next, what I'm waiting for — in a few sentences, the most important tickets with their key.") },
];

export function PipelineEditor({ dbId, pipeline, synced, dataType, fields, checkboxes, databases, extSources = [], onSave, onRun, onClose }: { /** The sources plugins bring (People …). */ extSources?: { id: string; label: string; icon: string; hint?: string }[]; dbId: number; pipeline: Pipeline | undefined; synced: string | null; dataType?: DataType; fields: string[]; checkboxes: { id: string; name: string }[]; databases: { id: number; title: string; rules?: boolean; jobs?: boolean; people?: boolean }[]; onSave: (p: Pipeline) => Promise<void>; onRun: (ai: boolean) => Promise<void>; onClose: () => void }) {
  const t = useT();
  // A database a sync keeps: the sync is its source — only AI steps of its own.
  const [auto, setAuto] = useState<{ autoAi: boolean; everyMinutes: number | undefined; keepProp: string | undefined }>({ autoAi: !!pipeline?.autoAi, everyMinutes: pipeline?.everyMinutes, keepProp: pipeline?.keepProp });
  const [steps, setSteps] = useState<PipelineStep[]>((pipeline?.steps ?? []).filter((s) => !synced || s.kind === "ai"));
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState(0);
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const loadInstructions = () => void instructionsAction().then((r) => r.ok && setInstructions(r.instructions));
  useEffect(loadInstructions, []);
  const dirty = JSON.stringify(steps) !== JSON.stringify(pipeline?.steps ?? []) || auto.autoAi !== !!pipeline?.autoAi || auto.everyMinutes !== pipeline?.everyMinutes || auto.keepProp !== pipeline?.keepProp;
  const runnable = synced ? steps.some((s) => s.kind === "ai") : steps.some((s) => s.kind === "source");
  const syncName = synced === "jira" ? "Jira" : synced === "google-keep" ? "Google Keep" : synced;
  const set = (i: number, patch: Partial<PipelineStep>) => setSteps((ss) => ss.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => setSteps((ss) => {
    const next = [...ss];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  const add = (s: Omit<PipelineStep, "id">) => setSteps((ss) => [...ss, { id: newId("s"), ...s }]);
  // A mail, chat or bank database without a noise filter: offered one (right after its sources — before any AI filter).
  const noiseOffered = !synced && !steps.some((s) => s.kind === "filter" && s.noise === "hide") && (dataType === "mail" || dataType === "message" || dataType === "inbox" || steps.some((s) => s.kind === "source" && (s.from === "mail" || s.from === "messages" || (s.from === "ext" && s.ext === "recurring"))));
  const addNoise = () => setSteps((ss) => {
    const at = ss.reduce((last, s, i) => (s.kind === "source" ? i : last), -1) + 1;
    return [...ss.slice(0, at), { id: newId("s"), kind: "filter", noise: "hide" }, ...ss.slice(at)];
  });
  const source = (from: PipelineSource) => add({ kind: "source", from, ...(from === "jira" ? { jira: { mine: true, recentDays: 14, openOnly: true } } : from === "mail" ? { mail: { recentDays: 30 } } : from === "messages" ? { messages: { recentDays: 14 } } : {}) });
  const save = async (run?: { ai: boolean }) => {
    setBusy(true);
    try {
      if (dirty) await onSave({ ...pipeline, steps, ...(auto.autoAi ? { autoAi: true } : { autoAi: undefined }), everyMinutes: auto.everyMinutes, keepProp: auto.keepProp });
      // Saved: what Zeff already has from the sources comes in at once (the AI by hand, or with the briefing).
      if (run || (dirty && runnable && !synced)) await onRun(run?.ai ?? false);
      setRan((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };
  const labels: Record<string, string> = { jira: t("Jira tickets"), keep: t("Google Keep notes"), todos: t("Todos"), database: t("Another database"), mail: t("Mails (Outlook, Gmail)"), messages: t("Messages (Teams, WhatsApp, Signal)"), knowledge: t("Knowledge: addresses (test, prod …)"), rules: t("Rules (a database of when / then)"), filter: t("Filter"), set: t("Set a field where …"), join: t("Bring fields from another database"), aifilter: t("AI: keep only what …"), noise: t("Hide noise (newsletters, bots, own transfers, duplicates)"), actions: t("AI: suggest actions for each row"), sort: t("Sort"), write: t("Write the rows into another database"), field: t("AI: a field on each row"), summary: t("AI: one summary over all rows") };
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
          <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setSteps(BRIEFING_EXAMPLE(t).filter((s) => !synced || s.kind === "ai"))}>
            {t("Start from the example “My briefing”")}
          </button>
        </div>
      )}
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.id} className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700" data-step={s.kind}>
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
              <span aria-hidden>{s.from === "ext" ? (extSources.find((x) => x.id === s.ext)?.icon ?? "🔌") : iconOf(s)}</span>
              <span className="flex-1">{s.from === "ext" ? t(extSources.find((x) => x.id === s.ext)?.label ?? s.ext ?? "") : labels[kindOf(s)]}</span>
              <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Up")}>↑</button>
              <button type="button" className="icon-btn" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={t("Down")}>↓</button>
              <button type="button" className="icon-btn" onClick={() => setSteps((ss) => ss.filter((_, k) => k !== i))} aria-label={t("Remove the step")}>✕</button>
            </div>
            <StepBody dbId={dbId} saved={!dirty} allSteps={steps} step={s} set={(p) => set(i, p)} databases={databases.filter((d) => d.id !== dbId)} fields={[...new Set([...fields, ...(TYPED_FIELDS[dataType ?? ""] ?? []), ...steps.flatMap((x) => (x.kind === "ai" && x.output === "field" && x.name ? [x.name] : []))])]} />
            {s.kind === "ai" && <InstructionPicker chosen={s.instructions ?? []} all={instructions} set={(ids) => set(i, { instructions: ids.length ? ids : undefined })} reload={loadInstructions} />}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-1.5">
        {!synced && (
          <Dropdown label={`+ ${t("Source")}`} className="btn btn-sm">
          {(close) => [
            ...(["jira", "keep", "todos", "database", "mail", "messages", "knowledge"] as const).map((f) => (
              <MenuItem key={f} onClick={() => (close(), source(f))}>
                {ICON[f]} {labels[f]}
              </MenuItem>
            )),
            ...extSources.map((x) => (
              <MenuItem key={`ext-${x.id}`} onClick={() => (close(), add({ kind: "source", from: "ext", ext: x.id }))}>
                {x.icon} {t(x.label)}
              </MenuItem>
            )),
          ]}
        </Dropdown>
        )}
        {!synced && <button type="button" className="btn btn-sm" onClick={() => add({ kind: "filter", openOnly: true })}>+ {t("Filter")}</button>}
        {noiseOffered && <button type="button" className="btn btn-sm" onClick={addNoise} title={t("Newsletters, system senders, money only moved between your accounts and the same thing twice from two sources stay out — and never reach the AI.")}>+ 🔇 {t("Hide noise")}</button>}
        {!synced && <button type="button" className="btn btn-sm" onClick={() => add({ kind: "set", name: "", setValue: "" })}>+ 🏷 {t("Set a field")}</button>}
        {!synced && <button type="button" className="btn btn-sm" onClick={() => add({ kind: "join", on: fields[0] ?? "", bring: [] })}>+ 🔗 {t("Join")}</button>}
        <button type="button" className="btn btn-sm" onClick={() => add({ kind: "sort", by: steps.find((x) => x.kind === "ai" && x.output === "field" && x.choices?.length)?.name ?? fields[0] ?? "" })}>+ ⇅ {t("Sort")}</button>
        {!synced && <button type="button" className="btn btn-sm" onClick={() => add({ kind: "rules" })}>+ 📏 {t("Rules")}</button>}
        <button type="button" className="btn btn-sm" onClick={() => add({ kind: "write" })}>+ 📤 {t("Write to a database")}</button>
        <button type="button" className="btn btn-sm" onClick={() => add({ kind: "ai", output: "field", name: t("Lage"), prompt: "" })}>+ ✨ {t("AI field")}</button>
        <button type="button" className="btn btn-sm" onClick={() => add({ kind: "ai", output: "filter", prompt: "" })}>+ 🔎 {t("AI filter")}</button>
        <button type="button" className="btn btn-sm" onClick={() => add({ kind: "ai", output: "actions", prompt: "" })}>+ ⚡ {t("AI actions")}</button>
        <button type="button" className="btn btn-sm" onClick={() => add({ kind: "ai", output: "summary", prompt: "" })}>+ 🧭 {t("AI summary")}</button>
      </div>
      <RunLog dbId={dbId} tick={ran} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm" data-triggers>
        <span className="font-medium">{t("Runs by itself")}:</span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={auto.autoAi} onChange={(e) => setAuto({ ...auto, autoAi: e.target.checked })} />
          {t("its AI after every sync of its sources")}
        </label>
        <label className="flex items-center gap-1.5">
          {t("and every")}
          <input type="number" min={1} className="input w-20 py-0.5 text-sm" value={auto.everyMinutes ?? ""} placeholder="—" onChange={(e) => setAuto({ ...auto, everyMinutes: Number(e.target.value) > 0 ? Math.floor(Number(e.target.value)) : undefined })} aria-label={t("Minutes")} />
          {t("minutes")}
        </label>
      </div>
      {!synced && checkboxes.length > 0 && (
        <label className="flex flex-wrap items-center gap-1.5 text-sm">
          {t("A row ticked in")}
          <select className="input w-auto text-sm" value={auto.keepProp ?? ""} onChange={(e) => setAuto({ ...auto, keepProp: e.target.value || undefined })} aria-label={t("Checkbox that keeps a row")}>
            <option value="">{t("(none)")}</option>
            {checkboxes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {t("is final: a run neither changes nor archives it, and the AI leaves it.")}
        </label>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-700">
        {pipeline?.ranAt && <span className="mr-auto text-xs text-zinc-500">{t("Last run {when}", { when: new Date(pipeline.ranAt).toLocaleString() })}</span>}
        {dirty ? (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save()}>
            {t("Save")}
          </button>
        ) : (
          <span className="text-xs text-zinc-500">✓ {t("Saved")}</span>
        )}
        {!synced && <button type="button" className="btn btn-sm" disabled={busy || !runnable} onClick={() => void save({ ai: false })}>{t("Run without AI")}</button>}
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !runnable} onClick={() => void save({ ai: true })}>{busy ? "…" : `✨ ${t("Run now")}`}</button>
      </div>
    </Modal>
  );
}

type Instruction = { id: number; title: string; icon: string; group?: string };

/**
 * The instructions an AI step goes by — your prompts and the system prompts (System → Prompts): chosen as chips, found by
 * typing (an autocomplete), a new one of your own made from what's typed (System → Prompts → My prompts) and opened to write.
 */
function InstructionPicker({ chosen, all, set, reload }: { chosen: number[]; all: Instruction[]; set: (ids: number[]) => void; reload: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // The option the arrow keys are on: a prompt, or (found.length) the "New prompt" at the end.
  const [active, setActive] = useState(0);
  const list = useId();
  const words = q.trim().toLowerCase();
  const found = all.filter((x) => !chosen.includes(x.id) && (!words || `${x.title} ${x.group ?? ""}`.toLowerCase().includes(words))).slice(0, 12);
  const at = Math.min(active, found.length);
  const pick = (id: number) => {
    set([...chosen, id]);
    setQ("");
    setOpen(false);
    setActive(0);
  };
  const create = async () => {
    const r = await newInstructionAction(q.trim() || t("New prompt"));
    if (!r.ok) return void toast(r.error, { tone: "error" });
    pick(r.id);
    reload();
    window.open(`/workspace/${r.id}`, "_blank");
  };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm" data-instructions>
      <span className="text-zinc-500">{t("Instructions")}:</span>
      {chosen.map((id) => {
        const x = all.find((i) => i.id === id);
        return (
          <span key={id} className="ws-chip inline-flex items-center gap-1">
            <a href={`/workspace/${id}`} target="_blank" rel="noreferrer" className="hover:underline" title={t("Open to write it")}>
              {x?.icon || "📋"} {x ? x.title || t("Untitled") : t("(deleted)")}
            </a>
            <button type="button" className="text-zinc-400 hover:text-zinc-700" aria-label={t("Remove")} onClick={() => set(chosen.filter((c) => c !== id))}>
              ✕
            </button>
          </span>
        );
      })}
      <span className="relative">
        <input
          className="input w-56 py-0.5 text-sm"
          value={q}
          placeholder={`+ ${t("Prompt …")}`}
          aria-label={t("Add a prompt")}
          role="combobox"
          aria-expanded={open}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${list}-${at}` : undefined}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => (setQ(e.target.value), setOpen(true), setActive(0))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive(Math.max(0, Math.min(found.length, at + (e.key === "ArrowDown" ? 1 : -1))));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (found[at]) pick(found[at].id);
              else if (q.trim() || (found.length && at === found.length)) void create();
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
        {open && (
          <ul className="absolute top-full left-0 z-30 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900" id={list} role="listbox" aria-label={t("Prompts")}>
            {/* The options are picked with the arrow keys in the field (aria-activedescendant), or clicked. */}
            {found.map((x, i) => (
              <Fragment key={x.id}>
                {(i === 0 || x.group !== found[i - 1]?.group) && (
                  <li role="presentation" className="px-2 pt-1.5 text-[11px] font-semibold text-zinc-500 uppercase">
                    {x.group ? `${t("System prompts")} · ${x.group}` : t("My prompts")}
                  </li>
                )}
                <li id={`${list}-${i}`} role="option" aria-selected={i === at} className={`block w-full cursor-pointer rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${i === at ? "bg-zinc-100 dark:bg-zinc-800" : ""}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(x.id)}>
                  {x.icon || "📋"} {x.title}
                </li>
              </Fragment>
            ))}
            <li id={`${list}-${found.length}`} role="option" aria-selected={at === found.length} className={`block w-full cursor-pointer rounded px-2 py-1 text-left text-indigo-600 hover:bg-zinc-100 dark:text-indigo-400 dark:hover:bg-zinc-800 ${at === found.length ? "bg-zinc-100 dark:bg-zinc-800" : ""}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(found.length)} onClick={() => void create()}>
              ＋ {q.trim() ? t("New prompt “{title}”", { title: q.trim() }) : t("New prompt …")}
            </li>
          </ul>
        )}
      </span>
    </div>
  );
}

/** How often a source's sync reads it (Jira, Google Keep) — its pipelines refresh after each. */
export function SyncEvery({ syncKey, name }: { syncKey: "jira" | "keep" | "mail"; name: string }) {
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

function StepBody({ dbId, saved, step: s, allSteps, set, databases, fields }: { dbId: number; saved: boolean; step: PipelineStep; allSteps: PipelineStep[]; set: (p: Partial<PipelineStep>) => void; databases: { id: number; title: string; rules?: boolean; jobs?: boolean; people?: boolean }[]; fields: string[] }) {
  const [trial, setTrial] = useState<"busy" | { title: string; keep: boolean; why: string }[] | null>(null);
  const t = useT();
  const row = "flex flex-wrap items-center gap-x-4 gap-y-1.5";
  if (s.kind === "rules")
    return (
      <div className="space-y-1.5">
        <div className={row}>
          <label className="flex items-center gap-1.5 text-sm">
            {t("Rules from")}
            <select className="input w-auto text-sm" value={s.dbId ?? ""} onChange={(e) => set({ dbId: Number(e.target.value) || undefined })} aria-label={t("Which rules database")}>
              <option value="">{t("Pick a rules database …")}</option>
              {databases.filter((d) => d.rules).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            {t("Jobs go to")}
            <select className="input w-auto text-sm" value={s.to ?? ""} onChange={(e) => set({ to: Number(e.target.value) || undefined })} aria-label={t("Which jobs database")}>
              <option value="">{t("(no jobs)")}</option>
              {databases.filter((d) => d.jobs).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-zinc-500">{t("Each record goes through the rules in their order: one can drop it, set a field on it, or make a job for an agent from it (once). Make a rules database from the templates (/ or Workspace → New).")}</p>
      </div>
    );
  if (s.kind === "write")
    return (
      <div className="space-y-1.5">
        <select className="input w-auto text-sm" value={s.to ?? ""} onChange={(e) => set({ to: Number(e.target.value) || undefined })} aria-label={t("Which database")}>
          <option value="">{t("Pick a database …")}</option>
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <p className="text-xs text-zinc-500">{t("Each row that comes out is made once there — its title, the fields of the same name (a status or select by its name), its text. Changes follow; nothing is deleted, and a row you removed there isn't made again.")}</p>
      </div>
    );
  if (s.kind === "join")
    return (
      <div className="space-y-2">
        <div className={row}>
          <label className="flex items-center gap-1.5 text-sm">
            {t("The row's")}
            <select className="input w-auto text-sm" value={s.on ?? ""} onChange={(e) => set({ on: e.target.value })} aria-label={t("Field here")}>
              {[...new Set([...(s.on ? [s.on] : []), ...fields])].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            {t("names a row of")}
            <select
              className="input w-auto text-sm"
              value={s.dbId ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value) || undefined;
                // A people database: the row's sender/author names the person — the keys there (name, aliases, addresses) are the default.
                const who = databases.find((d) => d.id === id)?.people ? fields.find((f) => /^(from|sender|reporter|assignee|author|creator)/i.test(f)) : undefined;
                set({ dbId: id, ...(who ? { on: who } : {}) });
              }}
              aria-label={t("Which database")}
            >
              <option value="">{t("Pick a database …")}</option>
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.people ? "👤 " : ""}
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={row}>
          <label className="flex items-center gap-1.5 text-sm">
            {t("by its")}
            <input className="input w-44 text-sm" value={s.by ?? ""} onChange={(e) => set({ by: e.target.value || undefined })} placeholder={databases.find((d) => d.id === s.dbId)?.people ? t("title, Aliases, Emails (default)") : t("title")} aria-label={t("Field there")} />
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            {t("bring")}
            <input className="input w-56 text-sm" value={(s.bring ?? []).join(", ")} onChange={(e) => set({ bring: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder={t("fields, comma-separated")} aria-label={t("Fields to bring")} />
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!s.dbId || !s.on}
            onClick={async () => {
              const r = await previewJoinAction(dbId, allSteps, s.id);
              if (!r.ok) return void toast(r.error, { tone: "error" });
              const hit = r.rows.filter((x) => x.matched);
              toast(t("{n} of {total} rows find their row: {titles}", { n: hit.length, total: r.rows.length, titles: hit.slice(0, 5).map((x) => x.title).join(" · ") + (hit.length > 5 ? " …" : "") }), { tone: "ok", ms: 12000 });
            }}
          >
            👁 {t("Preview")}
          </button>
        </div>
        <div className={row}>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="size-4 accent-indigo-600" checked={s.joinType === "inner"} onChange={(e) => set({ joinType: e.target.checked ? "inner" : undefined })} />
            {t("Only rows that find one")}
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="size-4 accent-indigo-600" checked={!!s.exact} onChange={(e) => set({ exact: e.target.checked || undefined })} />
            {t("Exact match")}
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            {t("Several matches:")}
            <select className="input w-auto text-sm" value={s.many ?? ""} onChange={(e) => set({ many: (e.target.value || undefined) as "all" | "expand" | undefined })} aria-label={t("Several matches")}>
              <option value="">{t("the first")}</option>
              <option value="all">{t("all, in one field")}</option>
              <option value="expand">{t("one row each")}</option>
            </select>
          </label>
        </div>
        {databases.find((d) => d.id === s.dbId)?.people && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs" data-people-bring>
            <span className="text-zinc-500">{t("Bring from the person:")}</span>
            {["Chat", "Jira", "Context", "Knowledge", "Todos", "Tickets", "Pages", "Note", "Next date"].map((f) => {
              const on = (s.bring ?? []).some((b) => b.toLowerCase() === f.toLowerCase());
              return (
                <button key={f} type="button" aria-pressed={on} className={`rounded-full border px-2 py-0.5 ${on ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"}`} onClick={() => set({ bring: on ? (s.bring ?? []).filter((b) => b.toLowerCase() !== f.toLowerCase()) : [...(s.bring ?? []), f] })}>
                  {f}
                </button>
              );
            })}
          </div>
        )}
        <p className="text-xs text-zinc-500">{t("A name matches a row when it is that row's title (or field), or contains it — an address in “Name <address>” too. The fields come onto the row at every run.")}</p>
      </div>
    );
  if (s.kind === "set")
    return (
      <div className="space-y-2">
        <RulesEditor rules={s.rules ?? []} match={s.match ?? "all"} fields={fields} set={(rules, match) => set({ rules: rules.length ? rules : undefined, match: rules.length && match === "any" ? "any" : undefined })} />
        <div className={row}>
          <label className="flex items-center gap-1.5 text-sm">
            {t("Set the field")}
            <input className="input w-36 text-sm" value={s.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder={t("Priority")} aria-label={t("Field name")} />
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            {t("to")}
            <input className="input w-36 text-sm" value={s.setValue ?? ""} onChange={(e) => set({ setValue: e.target.value })} placeholder={t("high")} aria-label={t("Value")} />
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!s.name?.trim()}
            onClick={async () => {
              const r = await previewSetAction(dbId, allSteps, s.id);
              if (!r.ok) return void toast(r.error, { tone: "error" });
              toast(r.rows.length ? t("{n} rows would get it: {titles}", { n: r.rows.length, titles: r.rows.slice(0, 5).map((x) => x.title).join(" · ") + (r.rows.length > 5 ? " …" : "") }) : t("No row matches."), { tone: "ok", ms: 12000 });
            }}
          >
            👁 {t("Preview")}
          </button>
        </div>
        <p className="text-xs text-zinc-500">{t("The rows its rules match get the value in that field, at every run. Nothing else changes — remove the step and the field stays empty again.")}</p>
      </div>
    );
  if (s.kind === "sort")
    return (
      <div className={row}>
        <select className="input w-auto text-sm" value={s.by ?? ""} onChange={(e) => set({ by: e.target.value })} aria-label={t("Sort by")}>
          {!s.by && <option value="">{t("Pick a field …")}</option>}
          {[...new Set([...(s.by ? [s.by] : []), ...fields])].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select className="input w-auto text-sm" value={s.dir ?? "asc"} onChange={(e) => set({ dir: e.target.value === "desc" ? "desc" : undefined })} aria-label={t("Direction")}>
          <option value="asc">{t("Ascending (a field with choices: in their order)")}</option>
          <option value="desc">{t("Descending")}</option>
        </select>
      </div>
    );
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
          <input className="input w-40 text-sm" placeholder="PROJ, SHOP" value={(j.projects ?? []).join(", ")} onChange={(e) => setJ({ projects: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
        </label>
        <SyncEvery syncKey="jira" name="Jira" />
      </div>
    );
  }
  if (s.kind === "source" && s.from === "mail") {
    const c = s.mail ?? {};
    const setC = (p: Partial<NonNullable<PipelineStep["mail"]>>) => set({ mail: { ...c, ...p } });
    const acc = (a: "outlook" | "gmail", on: boolean) => setC({ accounts: on ? [...new Set([...(c.accounts ?? []), a])] : (c.accounts ?? ["outlook", "gmail"]).filter((x) => x !== a) });
    return (
      <div className={row}>
        <Check label="Outlook" on={!c.accounts?.length || c.accounts.includes("outlook")} set={(v) => acc("outlook", v)} />
        <Check label="Gmail" on={!c.accounts?.length || c.accounts.includes("gmail")} set={(v) => acc("gmail", v)} />
        <label className="flex items-center gap-1.5 text-sm">
          {t("Folders")}
          <input className="input w-44 text-sm" placeholder={t("(all)")} value={(c.folders ?? []).join(", ")} onChange={(e) => setC({ folders: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
        </label>
        <Check label={t("Unread only")} on={c.unreadOnly} set={(v) => setC({ unreadOnly: v })} />
        <Days label={t("Received within days")} value={c.recentDays} set={(v) => setC({ recentDays: v })} />
        <SyncEvery syncKey="mail" name={t("Mail")} />
      </div>
    );
  }
  if (s.kind === "source" && s.from === "messages") {
    const c = s.messages ?? {};
    const setC = (p: Partial<NonNullable<PipelineStep["messages"]>>) => set({ messages: { ...c, ...p } });
    const all = ["teams", "whatsapp", "signal"] as const;
    const ch = (x: (typeof all)[number], on: boolean) => setC({ channels: on ? [...new Set([...(c.channels ?? []), x])] : (c.channels?.length ? c.channels : [...all]).filter((y) => y !== x) });
    return (
      <div className={row}>
        <Check label="Teams" on={!c.channels?.length || c.channels.includes("teams")} set={(v) => ch("teams", v)} />
        <Check label="WhatsApp" on={!c.channels?.length || c.channels.includes("whatsapp")} set={(v) => ch("whatsapp", v)} />
        <Check label="Signal" on={!c.channels?.length || c.channels.includes("signal")} set={(v) => ch("signal", v)} />
        <label className="flex items-center gap-1.5 text-sm">
          {t("Chat")}
          <input className="input w-40 text-sm" placeholder={t("(all)")} value={c.chat ?? ""} onChange={(e) => setC({ chat: e.target.value || undefined })} />
        </label>
        <Days label={t("Sent within days")} value={c.recentDays} set={(v) => setC({ recentDays: v })} />
      </div>
    );
  }
  if (s.kind === "source" && s.from === "knowledge") {
    const c = s.knowledge ?? { terms: [] };
    const setC = (p: Partial<NonNullable<PipelineStep["knowledge"]>>) => set({ knowledge: { ...c, ...p } });
    return (
      <div className="space-y-1.5">
        <div className={row}>
          <label className="flex items-start gap-1.5 text-sm">
            {t("Search for")}
            <textarea className="input w-64 text-sm" rows={2} placeholder={t("One per line: a project, a system")} value={c.terms.join("\n")} onChange={(e) => setC({ terms: e.target.value.split("\n") })} />
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            {t("Not the ones already in")}
            <select className="input w-auto text-sm" value={c.excludeDb ?? ""} onChange={(e) => setC({ excludeDb: Number(e.target.value) || undefined })}>
              <option value="">{t("(only this database)")}</option>
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-zinc-500">{t("The web addresses the knowledge base holds for these terms, each once with its environment and the page it stands on. Addresses you keep by hand (here or in the other database) are not suggested again.")}</p>
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
      <div className="space-y-2">
      <RulesEditor rules={s.rules ?? []} match={s.match ?? "all"} fields={fields} set={(rules, match) => set({ rules: rules.length ? rules : undefined, match: rules.length && match === "any" ? "any" : undefined })} />
      <div className={row}>
        <label className="flex items-center gap-1.5 text-sm">
          {t("Containing")}
          <input className="input w-40 text-sm" value={s.text ?? ""} onChange={(e) => set({ text: e.target.value || undefined })} />
        </label>
        <Check label={t("Open only")} on={s.openOnly} set={(v) => set({ openOnly: v })} />
        <Check label={t("Hide noise")} on={s.noise === "hide"} set={(v) => set({ noise: v ? "hide" : undefined })} />
        <Days label={t("Changed within days")} value={s.recentDays} set={(v) => set({ recentDays: v })} />
        <Days label={t("At most")} value={s.limit} set={(v) => set({ limit: v })} />
      </div>
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
        <textarea className="input min-h-16 w-full text-sm" aria-label={t("Instruction")} placeholder={t("What the AI writes into the field, for each row …")} value={s.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} />
      </div>
    );
  if (s.kind === "ai" && s.output === "filter")
    return (
      <div className="space-y-1.5">
        <textarea className="input min-h-16 w-full text-sm" aria-label={t("Instruction")} placeholder={t("Which rows stay — e.g. “important, urgent, or needs me to act” …")} value={s.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} />
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-xs text-zinc-500">{t("Each row is judged once (again when it changes) — after a sync, only the new ones. The reason goes with the ones that stay (field “Why”).")}</p>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!saved}
            title={saved ? undefined : t("Save first")}
            onClick={async () => {
              const r = await rejudgeAction(dbId, s.id);
              if (!r.ok) return void toast(r.error, { tone: "error" });
              toast(t("The AI judges all rows again — in the background; the view follows."), { tone: "ok" });
            }}
          >
            ↺ {t("Judge all again")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={trial === "busy" || (!s.prompt?.trim() && !(s.instructions ?? []).length)}
            onClick={async () => {
              setTrial("busy");
              const r = await previewAiFilterAction(dbId, allSteps, s.id);
              if (!r.ok) {
                setTrial(null);
                return void toast(r.error, { tone: "error" });
              }
              setTrial(r.rows);
            }}
          >
            {trial === "busy" ? "…" : `🧪 ${t("Try it on a sample")}`}
          </button>
        </div>
        {Array.isArray(trial) && (
          <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded border border-zinc-200 p-2 text-xs dark:border-zinc-800" data-trial>
            <li className="text-zinc-500">{t("{k} of {n} would stay — nothing is saved:", { k: trial.filter((x) => x.keep).length, n: trial.length })}</li>
            {trial.map((x, i) => (
              <li key={i} className={x.keep ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}>
                {x.keep ? "✓" : "✗"} {x.title}
                {x.why ? <span className="text-zinc-400"> — {x.why}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  if (s.kind === "ai" && s.output === "actions")
    return (
      <div className="space-y-1.5">
        <textarea className="input min-h-16 w-full text-sm" aria-label={t("Instruction")} placeholder={t("What to suggest — e.g. “a reply where someone asks me something; a Teams message to whoever I wait for” …")} value={s.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} />
        <p className="text-xs text-zinc-500">{t("From the actions installed that a row can run: drafts (Outlook, Gmail), messages (Teams, WhatsApp, Signal), things done in Zeff — one-click buttons on the row. Each row asked once per change, with the AI steps' runs.")}</p>
      </div>
    );
  if (s.kind === "ai" && s.output === "summary")
    return (
      <div className="space-y-1.5">
        <textarea className="input min-h-16 w-full text-sm" aria-label={t("Instruction")} placeholder={t("What the AI writes over all rows …")} value={s.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} />
        {s.result?.text && <p className="whitespace-pre-wrap rounded bg-zinc-50 p-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{s.result.text}</p>}
      </div>
    );
  return null;
}

/** The fixed fields of a typed database (its sources' — there before its first run). */
const TYPED_FIELDS: Record<string, string[]> = { mail: ["Title", "From", "Folder", "Account", "Received", "Unread"], message: ["Title", "Sender", "Chat", "Channel", "Sent", "Mine"], people: ["Title", "Aliases", "Emails", "Chat", "Jira", "Note", "Starred", "Next date", "Next"], documents: ["Title", "Kind", "Status", "Added", "Size (KB)", "Unread", "Compiled", "From", "Concepts"], calendar: ["Title", "Start", "End", "All day", "Calendar", "Source", "Location", "Organizer", "Attendees", "Online", "Shown as", "Response"] };

/** A filter's rules, as Outlook's: field (by its name, suggested), condition, value — all of them or any. */
function RulesEditor({ rules, match, fields, set }: { rules: FilterRule[]; match: "all" | "any"; fields: string[]; set: (rules: FilterRule[], match: "all" | "any") => void }) {
  const t = useT();
  const ops: Record<FilterRule["op"], string> = { contains: t("contains"), not_contains: t("doesn't contain"), is: t("is"), is_not: t("isn't"), empty: t("is empty"), not_empty: t("isn't empty") };
  const listId = useId();
  const put = (i: number, patch: Partial<FilterRule>) => set(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)), match);
  return (
    <div className="space-y-1.5" data-rules>
      <datalist id={listId}>
        {fields.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {rules.length > 1 && (
        <label className="flex items-center gap-1.5 text-sm">
          {t("Rows that meet")}
          <select className="input w-auto py-0.5 text-sm" value={match} onChange={(e) => set(rules, e.target.value === "any" ? "any" : "all")}>
            <option value="all">{t("all rules")}</option>
            <option value="any">{t("any rule")}</option>
          </select>
        </label>
      )}
      {rules.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <input className="input w-36 py-0.5 text-sm" list={listId} value={r.field} placeholder={t("Field")} aria-label={t("Field")} onChange={(e) => put(i, { field: e.target.value })} />
          <select className="input w-auto py-0.5 text-sm" value={r.op} aria-label={t("Condition")} onChange={(e) => put(i, { op: e.target.value as FilterRule["op"] })}>
            {FILTER_OPS.map((o) => (
              <option key={o} value={o}>
                {ops[o]}
              </option>
            ))}
          </select>
          {r.op !== "empty" && r.op !== "not_empty" && <input className="input w-48 py-0.5 text-sm" value={r.value ?? ""} placeholder={t("Value (a checkbox: yes / no)")} aria-label={t("Value")} onChange={(e) => put(i, { value: e.target.value })} />}
          <button type="button" className="icon-btn text-xs" aria-label={t("Remove the rule")} onClick={() => set(rules.filter((_, k) => k !== i), match)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => set([...rules, { field: fields[0] ?? "Title", op: "contains", value: "" }], match)}>
        + {t("Rule")}
      </button>
    </div>
  );
}

/** What the pipeline's summaries wrote, above the database's view. */
export function PipelineSummaries({ pipeline }: { pipeline: Pipeline | undefined }) {
  const done = (pipeline?.steps ?? []).filter((s) => s.kind === "ai" && s.output === "summary" && s.result?.text);
  if (!done.length) return null;
  return (
    <div className="space-y-1">
      {done.map((s) => (
        <Summary key={s.id} text={s.result!.text} at={s.result!.at} />
      ))}
    </div>
  );
}

/** One summary: a line (its start) — the whole text a click away. */
function Summary({ text, at }: { text: string; at: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 text-sm dark:border-indigo-900 dark:bg-indigo-950/30" data-summary>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden>🧭</span>
        <span className={`min-w-0 flex-1 ${open ? "font-medium" : "truncate"}`}>{open ? t("AI summary") : text.replace(/[*_#`>]+/g, "").replace(/\s+/g, " ")}</span>
        <span className="shrink-0 text-xs text-zinc-500">{new Date(at).toLocaleString()}</span>
        <span className="shrink-0 text-zinc-400" aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && <Markdown text={text} className="px-3 pb-3" />}
    </div>
  );
}
