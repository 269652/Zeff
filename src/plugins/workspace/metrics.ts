import "@/plugins/contributions"; // (the plugins' Kennzahlen registered)
import { currentAccountId } from "@/db/accounts";
import { getPref, setPref } from "@/lib/prefs";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { checkFormula, evalWithUnits, setFunctionReader, setMetricReader, setMetricUnitReader, type FormulaFn } from "./formula";
import { workspaceFormulaFunctions, type FormulaFunction } from "./formula-point";
import { workspaceMetrics, type MetricProvider } from "./metric-point";
import { listNamedValues, namedValue, namedValueNames, unpublishValue, valueKey, valueUnit, type NamedValue } from "./values";
import { localDay } from "@/lib/dates";

/**
 * Kennzahlen (the Workspace plugin): numbers every part of Zeff reads by their name — kennzahl("Sparrate") in a formula (a
 * database's column, another Kennzahl's), @Sparrate in a page, metric_get for an agent, a widget. Three kinds, one name each:
 *   formula    made here from other Kennzahlen: Sparrate = (kennzahl("Einkommen") - kennzahl("Ausgaben")) / kennzahl("Einkommen")
 *   aggregate  a column of databases over a view, summed (or averaged …) — values.ts (Table → ∑ → Make available …)
 *   plugin     a number a plugin knows (metric-point.ts): Finances' Tilgungsrate, the hours booked this week …
 * Yours win over a plugin's of the same name. Each may have a unit, a line on what it is, a goal (at least / at most a target,
 * by a date) and thresholds (below / above: a todo once it crosses) — and its history, a value a day (snapshotMetrics, from the
 * scheduler). A Kennzahl keeps only how it is made, never a value: whoever reads it reads it now. Server only.
 */

export type MetricKind = "formula" | "aggregate" | "plugin";
export type MetricGoal = { target: number; dir: "atLeast" | "atMost"; by?: string };
export type MetricAlert = { below?: number; above?: number };
/** What is kept per Kennzahl (by key): a formula one's formula, and for any kind its unit, line, goal and thresholds. */
type Meta = { label?: string; formula?: string; unit?: string; what?: string; goal?: MetricGoal; alert?: MetricAlert; /** Shown on Today (its Kennzahlen strip). */ today?: boolean };
export type MetricTone = "good" | "warn" | "bad";

export type Metric = {
  key: string;
  label: string;
  kind: MetricKind;
  unit: string;
  what: string;
  value: number | null;
  /** Why there is no value (a formula's error, a loop). */
  error?: string;
  formula?: string;
  /** An aggregate's columns, each with what it adds. */
  sources?: NamedValue["sources"];
  agg?: string;
  /** The plugin it comes from. */
  plugin?: string;
  href?: string;
  goal?: MetricGoal;
  alert?: MetricAlert;
  /** What its value says by itself (the plugin's reading: an overdue count above zero is bad). */
  tone?: MetricTone;
  /** Shown on Today. */
  today?: boolean;
};

const META = "workspace.metrics";
const HISTORY = "workspace.metricHistory";
const SNAPSHOT_DAY = "workspace.metricSnapshotDay";
const ALERTED = "workspace.metricAlerted";

const metas = () => getPref<Record<string, Meta>>(META, {});
const saveMetas = (m: Record<string, Meta>) => setPref(META, m);

/** The plugins' Kennzahlen (installed plugins only), by key. */
function providers(): Map<string, MetricProvider & { plugin: string }> {
  const out = new Map<string, MetricProvider & { plugin: string }>();
  for (const c of workspaceMetrics.list()) for (const p of typeof c.impl === "function" ? c.impl() : c.impl) if (p.available?.() !== false) out.set(valueKey(p.label), { ...p, plugin: c.plugin });
  return out;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Values read a moment ago (a formula column reads a Kennzahl once per row): kept a few seconds, per account. */
const CACHE_MS = 5000;
const state = globalThis as { __zeffMetricCache?: Map<string, { at: number; value: number | null; error?: string }> };
const cache: Map<string, { at: number; value: number | null; error?: string; unit?: string }> = (state.__zeffMetricCache ??= new Map());
/** The Kennzahlen being worked out right now (a formula that reads itself, round about, is a loop — not a hang). */
const reading: string[] = [];

const round = (v: number) => Math.round(v * 10000) / 10000;

/** A Kennzahl's value now, by its name or key — null with why, when it has none. */
export function metricValue(name: string): { value: number | null; error?: string; /** A formula's own unit (worked out from what it reads). */ unit?: string } {
  const key = valueKey(name);
  if (!key) return { value: null, error: "No name" };
  const cacheKey = `${currentAccountId()}:${key}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  if (reading.includes(key)) return { value: null, error: `Kennzahl "${name}" reads itself (${[...reading, key].join(" → ")})` };
  reading.push(key);
  let out: { value: number | null; error?: string; unit?: string };
  try {
    out = compute(key);
  } catch (e) {
    out = { value: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    reading.pop();
  }
  // A loop's error isn't kept: the outer reading decides.
  if (!out.error?.includes("reads itself")) cache.set(cacheKey, { at: Date.now(), ...out });
  return out;
}

function compute(key: string): { value: number | null; error?: string; unit?: string } {
  const meta = metas()[key];
  if (meta?.formula) {
    // A loop is the formula's error (not a null it computes on with). Its unit: what it reads (Nettoeinkommen − Ausgaben: €/Monat).
    const r = evalWithUnits(meta.formula, {
      prop: () => null,
      metric: (n) => {
        const v = metricValue(n);
        if (v.error?.includes("reads itself")) throw new Error(v.error);
        return v.error?.startsWith("No Kennzahl") ? undefined : v.value;
      },
      metricUnit: (n) => metricUnit(n),
    });
    if ("error" in r) return { value: null, error: r.error };
    const v = r.value;
    if (v === null) return { value: null };
    const n = typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : Array.isArray(v) ? NaN : Number(v);
    return Number.isFinite(n) ? { value: round(n), ...(r.unit ? { unit: r.unit } : {}) } : { value: null, error: "The formula doesn't give a number" };
  }
  const agg = namedValue(key);
  if (agg) return { value: agg.value };
  const p = providers().get(key);
  if (p) {
    const v = p.read();
    return { value: v === null || !Number.isFinite(v) ? null : round(v) };
  }
  return { value: null, error: `No Kennzahl "${key}"` };
}

/** A Kennzahl's unit by its name (yours, set; a formula's, worked out; a plugin's) — null: none, or no such Kennzahl. */
export function metricUnit(name: string): string | null {
  const key = valueKey(name);
  const meta = metas()[key];
  if (meta?.unit) return meta.unit;
  if (meta?.formula) return metricValue(key).unit ?? null;
  const agg = namedValue(key);
  if (agg) return valueUnit(key) || null;
  return providers().get(key)?.unit || null;
}

// The formulas everywhere read Kennzahlen through this (undefined: no Kennzahl of that name — @Name is a name then).
setMetricReader((name) => {
  const v = metricValue(name);
  return v.error?.startsWith("No Kennzahl") ? undefined : v.value;
});

setMetricUnitReader(metricUnit);

/** The plugins' formula functions (installed plugins only), by every name they go by. */
export function formulaFunctions(): (FormulaFunction & { plugin: string })[] {
  return workspaceFormulaFunctions.list().flatMap((c) => c.impl.map((f) => ({ ...f, plugin: c.plugin })));
}
const fnByName = (name: string): FormulaFunction | null => {
  const n = name.trim().toLowerCase();
  return formulaFunctions().find((f) => f.name.toLowerCase() === n || (f.aliases ?? []).some((a) => a.toLowerCase() === n)) ?? null;
};
setFunctionReader((name): FormulaFn | null => {
  const f = fnByName(name);
  return f ? { call: f.call, unit: f.unit } : null;
});

/** Forget the values read a moment ago (after a change to what they're made of). */
export const forgetMetricValues = () => cache.clear();

/**
 * Every Kennzahl of this account, read now: yours (formula, aggregate), then the plugins' — sorted by name. `only`: just
 * these (names or keys) — the others are not read at all (a widget's few, Today's).
 */
export function listMetrics(only?: string[]): Metric[] {
  const m = metas();
  const want = only ? new Set(only.map(valueKey)) : null;
  const take = (key: string) => !want || want.has(key);
  const out = new Map<string, Metric>();
  for (const [key, p] of providers()) {
    if (!take(key)) continue;
    const v = metricValue(key);
    const tone = v.value !== null ? p.tone?.(v.value) : undefined;
    out.set(key, { key, label: p.label, kind: "plugin", unit: m[key]?.unit ?? p.unit, what: m[key]?.what ?? t(p.what), value: v.value, error: v.error, plugin: p.plugin, href: p.href?.(), goal: m[key]?.goal, alert: m[key]?.alert, ...(tone ? { tone } : {}), ...(m[key]?.today ? { today: true } : {}) });
  }
  for (const nv of listNamedValues()) {
    if (!take(nv.key)) continue;
    const meta = m[nv.key];
    out.set(nv.key, { key: nv.key, label: nv.label, kind: "aggregate", unit: meta?.unit || valueUnit(nv.key), what: meta?.what ?? "", value: nv.value, sources: nv.sources, agg: nv.agg, goal: meta?.goal, alert: meta?.alert, ...(meta?.today ? { today: true } : {}) });
  }
  for (const [key, meta] of Object.entries(m)) {
    if (!meta.formula || !take(key)) continue;
    const v = metricValue(key);
    out.set(key, { key, label: meta.label ?? key, kind: "formula", unit: meta.unit || v.unit || "", what: meta.what ?? "", value: v.value, error: v.error, formula: meta.formula, goal: meta.goal, alert: meta.alert, ...(meta.today ? { today: true } : {}) });
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label, "de"));
}

/**
 * Every Kennzahl's key with what listMetrics shows it by — its label, line and unit — but no value read (the search matches
 * these first and reads only the ones that may fit). `unit` null: only reading it tells (a formula's own, worked out).
 */
export function metricNames(): { key: string; label: string; what: string; unit: string | null }[] {
  const m = metas();
  const out = new Map<string, { key: string; label: string; what: string; unit: string | null }>();
  for (const [key, p] of providers()) out.set(key, { key, label: p.label, what: m[key]?.what ?? t(p.what), unit: m[key]?.unit ?? p.unit });
  for (const nv of namedValueNames()) out.set(nv.key, { key: nv.key, label: nv.label, what: m[nv.key]?.what ?? "", unit: m[nv.key]?.unit || valueUnit(nv.key) });
  for (const [key, meta] of Object.entries(m)) if (meta.formula) out.set(key, { key, label: meta.label ?? key, what: meta.what ?? "", unit: meta.unit || null });
  return [...out.values()];
}

/** The Kennzahlen shown on Today (each marked so on the Kennzahlen page), read now. */
export function todayMetrics(): Metric[] {
  const keys = Object.entries(metas())
    .filter(([, meta]) => meta.today)
    .map(([key]) => key);
  return keys.length ? listMetrics(keys) : [];
}

/** One Kennzahl by its name or key (null: none). */
export const getMetric = (name: string): Metric | null => listMetrics([name]).find((x) => x.key === valueKey(name)) ?? null;

// ---------------------------------------------------------------------------
// Making and changing
// ---------------------------------------------------------------------------

/** A Kennzahl made from a formula over other Kennzahlen (and numbers): its key. One of the same name is replaced. */
export function defineFormulaMetric(v: { label: string; formula: string; unit?: string; what?: string }): string {
  const label = v.label.trim().slice(0, 60);
  const key = valueKey(label);
  if (!key) throw new ValidationError("A name, please.");
  const bad = checkFormula(v.formula);
  if (bad) throw new ValidationError(`The formula: ${bad}`);
  if (namedValue(key)) throw new ValidationError(`"${label}" is made of database columns already — another name, please.`);
  const m = metas();
  const before = m[key];
  m[key] = { ...m[key], label, formula: v.formula.trim(), unit: v.unit?.trim() ?? m[key]?.unit, what: v.what?.trim() ?? m[key]?.what };
  saveMetas(m);
  forgetMetricValues();
  // It must not read itself, round about: refused — what was there before stays.
  const r = metricValue(key);
  if (r.error?.includes("reads itself")) {
    if (before) m[key] = before;
    else delete m[key];
    saveMetas(m);
    forgetMetricValues();
    throw new ValidationError(r.error);
  }
  return key;
}

/** What is kept with any Kennzahl: its unit, its line, its goal, its thresholds (null clears one). */
export function setMetricMeta(name: string, patch: { unit?: string; what?: string; goal?: MetricGoal | null; alert?: MetricAlert | null; today?: boolean }): void {
  const key = valueKey(name);
  if (!getMetric(key)) throw new ValidationError(`No Kennzahl "${name}".`);
  if (patch.goal && (!Number.isFinite(patch.goal.target) || !["atLeast", "atMost"].includes(patch.goal.dir))) throw new ValidationError("A goal: a number and at least / at most.");
  if (patch.goal?.by && !/^\d{4}-\d{2}-\d{2}$/.test(patch.goal.by)) throw new ValidationError("A goal's date: YYYY-MM-DD.");
  const m = metas();
  const next: Meta = { ...m[key] };
  if (patch.unit !== undefined) next.unit = patch.unit.trim();
  if (patch.what !== undefined) next.what = patch.what.trim();
  if (patch.goal !== undefined) patch.goal ? (next.goal = patch.goal) : delete next.goal;
  if (patch.alert !== undefined) patch.alert && (patch.alert.below !== undefined || patch.alert.above !== undefined) ? (next.alert = patch.alert) : delete next.alert;
  if (patch.today !== undefined) patch.today ? (next.today = true) : delete next.today;
  m[key] = next;
  saveMetas(m);
}

/** A Kennzahl gone: a formula one with its formula, an aggregate with its columns' publishing; a plugin's keeps only its number (what was set on it goes). */
export function removeMetric(name: string): void {
  const key = valueKey(name);
  const m = metas();
  delete m[key];
  saveMetas(m);
  if (namedValue(key)) unpublishValue(key);
  forgetMetricValues();
}

// ---------------------------------------------------------------------------
// History, goals, thresholds
// ---------------------------------------------------------------------------

const KEEP_DAYS = 400;

/** A Kennzahl's values by day, oldest first (the last `days`). */
export function metricHistory(name: string, days = 90): { day: string; value: number }[] {
  const h = getPref<Record<string, Record<string, number>>>(HISTORY, {})[valueKey(name)] ?? {};
  return Object.entries(h)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-days)
    .map(([day, value]) => ({ day, value }));
}

/** How far a goal is: reached, and how far off (in the Kennzahl's unit) — null without a goal or a value. */
export function goalProgress(m: Pick<Metric, "goal" | "value">): { reached: boolean; gap: number } | null {
  if (!m.goal || m.value === null) return null;
  const gap = m.goal.dir === "atLeast" ? m.goal.target - m.value : m.value - m.goal.target;
  return { reached: gap <= 0, gap: Math.max(0, round(gap)) };
}

/** Whether a value is beyond a threshold ("below" / "above"), null when it isn't. */
export const beyond = (value: number | null, a: MetricAlert | undefined): "below" | "above" | null =>
  value === null || !a ? null : a.below !== undefined && value < a.below ? "below" : a.above !== undefined && value > a.above ? "above" : null;

/**
 * Once a day (the scheduler, per account): every Kennzahl's value into its history — and a Kennzahl that crossed a threshold
 * since the last time gets a todo (once per crossing: back inside, the next crossing is told again). What it did.
 */
export async function snapshotMetrics(now = new Date()): Promise<{ taken: number; alerts: string[] }> {
  const day = localDay(now);
  if (getPref<string>(SNAPSHOT_DAY, "") === day) return { taken: 0, alerts: [] };
  forgetMetricValues();
  const list = listMetrics();
  const history = getPref<Record<string, Record<string, number>>>(HISTORY, {});
  const alerted = getPref<Record<string, string>>(ALERTED, {});
  const alerts: string[] = [];
  let taken = 0;
  for (const m of list) {
    if (m.value !== null) {
      const h = (history[m.key] ??= {});
      h[day] = m.value;
      const days = Object.keys(h).sort();
      for (const old of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete h[old];
      taken++;
    }
    const side = beyond(m.value, m.alert);
    if (side && alerted[m.key] !== side) {
      const limit = side === "below" ? m.alert!.below! : m.alert!.above!;
      const { addAgentTodo } = await import("@/lib/boards/store");
      addAgentTodo({ ticket: "", text: t("Metric {name} is {side} {limit}{unit}: {value}{unit} — look into it", { name: m.label, side: side === "below" ? t("below") : t("above"), limit: String(limit), value: String(m.value), unit: m.unit ? ` ${m.unit}` : "" }) });
      alerts.push(m.key);
    }
    if (side) alerted[m.key] = side;
    else delete alerted[m.key];
  }
  setPref(HISTORY, history);
  setPref(ALERTED, alerted);
  setPref(SNAPSHOT_DAY, day);
  return { taken, alerts };
}

/** A value as it is shown: a few decimals at most, its unit after it. */
export function formatMetric(value: number | null, unit: string): string {
  if (value === null) return "–";
  const abs = Math.abs(value);
  const text = value.toLocaleString("de-DE", { maximumFractionDigits: abs >= 100 ? 0 : abs >= 10 ? 1 : 2 });
  return unit ? `${text} ${unit}` : text;
}
