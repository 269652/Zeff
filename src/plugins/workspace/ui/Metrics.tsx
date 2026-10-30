"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { defineMetricAction, metricsAction, previewMetricFormulaAction, removeMetricAction, setMetricMetaAction, type MetricView } from "../metrics-actions";
import "./workspace.css";

/**
 * The Kennzahlen (Workspace → Kennzahlen): each named number with its value now, its last 90 days, its goal and thresholds; a new
 * one from a formula over the others. Yours: a formula here, or a table's column (∑ row → Make available …). The plugins' come by
 * themselves.
 */

/** A tiny line of the last days' values. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full text-indigo-500" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const num = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(",", ".")));

function MetricCard({ m, onChanged, onInsert }: { m: MetricView; onChanged: () => void; onInsert: (name: string) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ unit: m.unit, what: m.what, target: m.goal ? String(m.goal.target) : "", dir: m.goal?.dir ?? "atLeast", by: m.goal?.by ?? "", below: m.alert?.below !== undefined ? String(m.alert.below) : "", above: m.alert?.above !== undefined ? String(m.alert.above) : "" });
  const kind = m.kind === "formula" ? t("Formula") : m.kind === "aggregate" ? t("From tables") : t("From {plugin}", { plugin: m.plugin ?? "" });
  const goalGap = m.goal && m.value !== null ? (m.goal.dir === "atLeast" ? m.goal.target - m.value : m.value - m.goal.target) : null;
  const beyond = m.value !== null && m.alert ? (m.alert.below !== undefined && m.value < m.alert.below) || (m.alert.above !== undefined && m.value > m.alert.above) : false;
  const save = () =>
    start(async () => {
      const target = num(form.target);
      const r = await setMetricMetaAction(m.key, {
        unit: form.unit,
        what: form.what,
        goal: target === undefined || Number.isNaN(target) ? null : { target, dir: form.dir as "atLeast" | "atMost", ...(form.by ? { by: form.by } : {}) },
        alert: { below: num(form.below), above: num(form.above) },
      });
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setEditing(false);
      onChanged();
    });
  return (
    <li id={m.key} className="card scroll-mt-20 space-y-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button type="button" className="truncate text-left text-sm font-medium hover:underline" title={t("Insert into the formula")} onClick={() => onInsert(m.label)}>
            {m.label}
          </button>
          <div className="text-xs text-zinc-500">{kind}</div>
        </div>
        <div className={`text-right text-2xl font-semibold tabular-nums ${beyond ? "text-rose-600 dark:text-rose-400" : ""}`} title={m.error ?? undefined}>
          {m.error ? "⚠" : m.shown}
        </div>
      </div>
      {m.what && <p className="text-xs text-zinc-500">{m.what}</p>}
      {m.error && <p className="text-xs text-rose-600 dark:text-rose-400">{m.error}</p>}
      {m.formula && <code className="code block truncate text-xs">{m.formula}</code>}
      {m.sources && m.sources.length > 0 && (
        <ul className="text-xs text-zinc-500">
          {m.sources.map((s) => (
            <li key={`${s.dbId}:${s.viewId}:${s.propId}`}>
              <Link href={`/workspace/${s.dbId}`} className="hover:underline">
                {s.text}
              </Link>
              {s.value !== null ? ` · ${s.value}` : ""}
            </li>
          ))}
        </ul>
      )}
      <Spark values={m.history.map((h) => h.value)} />
      {m.goal && (
        <p className="text-xs">
          {t("Goal")}: {m.goal.dir === "atLeast" ? "≥" : "≤"} {m.goal.target} {m.unit}
          {m.goal.by ? ` ${t("by {day}", { day: m.goal.by })}` : ""} —{" "}
          {goalGap === null ? "–" : goalGap <= 0 ? <span className="text-emerald-600 dark:text-emerald-400">{t("reached")}</span> : t("{gap} to go", { gap: `${Math.round(goalGap * 100) / 100} ${m.unit}`.trim() })}
        </p>
      )}
      {m.alert && (m.alert.below !== undefined || m.alert.above !== undefined) && (
        <p className="text-xs text-zinc-500">
          {t("Todo when")} {[m.alert.below !== undefined ? `< ${m.alert.below}` : "", m.alert.above !== undefined ? `> ${m.alert.above}` : ""].filter(Boolean).join(t(" or "))}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setEditing(!editing)}>
          {t("Goal & thresholds")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          aria-pressed={!!m.today}
          disabled={pending}
          title={m.today ? t("Shown on Today — click to take it off") : t("Show it in the metrics strip on Today")}
          onClick={() =>
            start(async () => {
              const r = await setMetricMetaAction(m.key, { today: !m.today });
              if (!r.ok) return void toast(r.error, { tone: "error" });
              onChanged();
            })
          }
        >
          {m.today ? `★ ${t("On Today")}` : `☆ ${t("Show on Today")}`}
        </button>
        {m.href && (
          <Link href={m.href} className="btn btn-sm">
            {t("Open")}
          </Link>
        )}
        {m.kind !== "plugin" && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={pending}
            onClick={() => {
              if (!confirmAction(t("Remove the metric “{name}”? Formulas and pages that name it show nothing then.", { name: m.label }))) return;
              start(async () => {
                const r = await removeMetricAction(m.key);
                if (!r.ok) return void toast(r.error, { tone: "error" });
                onChanged();
              });
            }}
          >
            {t("Remove")}
          </button>
        )}
      </div>
      {editing && (
        <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-700">
          <label className="col-span-1">
            {t("Unit")}
            <input className="input mt-1 w-full" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="€, %, h" />
          </label>
          <label className="col-span-1">
            {t("Goal")}
            <span className="mt-1 flex gap-1">
              <select className="input" value={form.dir} onChange={(e) => setForm({ ...form, dir: e.target.value as "atLeast" | "atMost" })}>
                <option value="atLeast">≥</option>
                <option value="atMost">≤</option>
              </select>
              <input className="input w-full" inputMode="decimal" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            </span>
          </label>
          <label className="col-span-2">
            {t("What it is")}
            <input className="input mt-1 w-full" value={form.what} onChange={(e) => setForm({ ...form, what: e.target.value })} />
          </label>
          <label>
            {t("Goal by (date)")}
            <input type="date" className="input mt-1 w-full" value={form.by} onChange={(e) => setForm({ ...form, by: e.target.value })} />
          </label>
          <span />
          <label>
            {t("A todo below")}
            <input className="input mt-1 w-full" inputMode="decimal" value={form.below} onChange={(e) => setForm({ ...form, below: e.target.value })} />
          </label>
          <label>
            {t("A todo above")}
            <input className="input mt-1 w-full" inputMode="decimal" value={form.above} onChange={(e) => setForm({ ...form, above: e.target.value })} />
          </label>
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              {t("Cancel")}
            </button>
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={save}>
              {t("Save")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function MetricsBoard({ initial }: { initial: MetricView[] }) {
  const t = useT();
  const [metrics, setMetrics] = useState(initial);
  const [draft, setDraft] = useState({ name: "", formula: "", unit: "", what: "" });
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const formula = useRef<HTMLTextAreaElement>(null);
  const reload = () => void metricsAction().then((r) => r.ok && setMetrics(r.metrics));

  // The formula's value as it is typed.
  useEffect(() => {
    if (!draft.formula.trim()) return setPreview(null);
    const timer = setTimeout(() => void previewMetricFormulaAction(draft.formula).then((r) => setPreview(r.ok ? `= ${r.value}` : `⚠ ${r.error}`)), 300);
    return () => clearTimeout(timer);
  }, [draft.formula]);

  const insert = (name: string) => {
    const piece = `kennzahl("${name}")`;
    const el = formula.current;
    const at = el?.selectionStart ?? draft.formula.length;
    setDraft((d) => ({ ...d, formula: d.formula.slice(0, at) + piece + d.formula.slice(at) }));
    el?.focus();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{t("Metrics")}</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          {t(
            "Named numbers every part of Zeff can read: kennzahl(\"Name\") in a formula, @Name in a page (shown live), metric_get for an agent. Your own: a formula here over the others — or a column of a table (also a formula or rollup column): in its ∑ row choose “Make available …”. A value of each is kept every day.",
          )}
        </p>
      </div>

      <section className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold">{t("New metric from a formula")}</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
          <input className="input" aria-label={t("Name")} placeholder={t("Name, e.g. Puffer in Monaten")} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="input" aria-label={t("Unit")} placeholder={t("Unit")} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
        </div>
        <textarea
          ref={formula}
          className="input w-full font-mono text-sm"
          aria-label={t("Formula")}
          rows={2}
          placeholder={'(kennzahl("Nettoeinkommen") - kennzahl("Ausgaben")) / kennzahl("Nettoeinkommen") * 100'}
          value={draft.formula}
          onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
        />
        <input className="input w-full" aria-label={t("What it is (one line)")} placeholder={t("What it is (one line)")} value={draft.what} onChange={(e) => setDraft({ ...draft, what: e.target.value })} />
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-zinc-500">{preview ?? t("Click a metric's name below to put it into the formula.")}</span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={pending || !draft.name.trim() || !draft.formula.trim()}
            onClick={() =>
              start(async () => {
                const r = await defineMetricAction(draft);
                if (!r.ok) return void toast(r.error, { tone: "error" });
                toast(t("“{name}” made.", { name: draft.name }), { tone: "ok" });
                setDraft({ name: "", formula: "", unit: "", what: "" });
                reload();
              })
            }
          >
            {t("Make")}
          </button>
        </div>
      </section>

      {metrics.length ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {metrics.map((m) => (
            <MetricCard key={m.key} m={m} onChanged={reload} onInsert={insert} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">{t("No metrics yet.")}</p>
      )}
    </div>
  );
}
