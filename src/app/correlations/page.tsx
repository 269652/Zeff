import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { BarList } from "@/components/charts";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { getPlugin } from "@/lib/ext/registry";
import { analyze, comparePair, num, type Pair } from "@/plugins/correlations/engine";
import { findSeries, pairText, period, scaleText, seriesOf, targetChoices } from "@/plugins/correlations/report";
import type { Series } from "@/lib/series/series-point";
import { exploreHref } from "@/plugins/correlations/widgets";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Correlations") };
}

const inPeriod = (s: Series, from: string, to: string): Series => ({ ...s, values: new Map([...s.values].filter(([d]) => d >= from && d <= to)) });

/** The pair as dots: the other series across, the target up — each day a dot (its date on hover). Plain SVG, both themes. */
function Scatter({ pair, x, y }: { pair: Pair; x: Series; y: Series }) {
  const W = 360;
  const H = 240;
  const pad = 34;
  const xs = pair.points.map((p) => p.x);
  const ys = pair.points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - pad * 1.5);
  const sy = (v: number) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - pad * 1.5);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-xl text-zinc-700 dark:text-zinc-200" role="img" aria-label={t("Scatter plot")}>
      <line x1={pad} x2={W - pad / 2} y1={H - pad} y2={H - pad} stroke="currentColor" strokeOpacity="0.2" />
      <line x1={pad} x2={pad} y1={pad / 2} y2={H - pad} stroke="currentColor" strokeOpacity="0.2" />
      <text x={pad} y={H - pad + 14} fontSize="10" fill="currentColor" fillOpacity="0.6">{num(x0)}</text>
      <text x={W - pad / 2} y={H - pad + 14} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.6">{num(x1)}</text>
      <text x={(W + pad) / 2} y={H - 6} fontSize="11" textAnchor="middle" fill="currentColor" fillOpacity="0.75">{x.label}</text>
      <text x={pad - 4} y={H - pad} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.6">{num(y0)}</text>
      <text x={pad - 4} y={pad / 2 + 8} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.6">{num(y1)}</text>
      <text x={8} y={H / 2} fontSize="11" textAnchor="middle" fill="currentColor" fillOpacity="0.75" transform={`rotate(-90 8 ${H / 2})`}>{y.label}</text>
      {pair.points.map((p) => (
        <circle key={p.day} cx={sx(p.x)} cy={sy(p.y)} r="4" className="fill-indigo-500/60 stroke-indigo-700/40 dark:fill-indigo-400/60">
          <title>{`${p.day}: ${num(p.x)} → ${num(p.y)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/**
 * Correlations: the findings of a target (a journal's energy, its mood — any series), and any pair explored — the dots of its days,
 * the target's mean in the two groups, the numbers and whether they hold. A plain form (works without script): the target, the
 * other, same day or the day before, how many days back.
 */
export default async function CorrelationsPage({ searchParams }: { searchParams: Promise<{ y?: string; x?: string; lag?: string; days?: string }> }) {
  await connection();
  // (the built-in, or its port — correlations-ext: the page reads the same core and the kernel's series)
  if (!isInstalled("correlations") && !getPlugin("correlations-ext")?.enabled) return <PluginNotInstalled id="correlations" />;
  const sp = await searchParams;
  const days = Math.max(14, Math.min(730, Number(sp.days) || 90));
  const lag: 0 | 1 = sp.lag === "1" ? 1 : 0;
  const p = period({ days });
  const all = await seriesOf(p);
  const choices = targetChoices(all);
  const y = (sp.y && findSeries(all, { field: sp.y })) || choices[0] || null;
  const x = sp.x ? findSeries(all, { field: sp.x }) : null;
  const report = y ? analyze(y, all, { ...p, t }) : null;
  const pair = x && y ? comparePair(lag ? x : inPeriod(x, p.from, p.to), inPeriod(y, p.from, p.to), lag) : null;
  const scale = y ? scaleText(y) : null;

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Correlations")}</h1>
        <p className="text-sm text-zinc-500">
          {t("What goes with what in your days — computed from your data, told only when it holds: at least 14 days, not likely by chance among all the comparisons, the same in both halves of the period. Correlations, not causes.")}
        </p>
      </div>
      <div className="space-y-4">
        <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t("What to explain")}
            <select name="y" defaultValue={y?.id ?? ""} className="input w-64 py-1 text-sm">
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t("Compare with")}
            <select name="x" defaultValue={x?.id ?? ""} className="input w-64 py-1 text-sm">
              <option value="">{t("— the findings —")}</option>
              {choices.filter((s) => s.id !== y?.id).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t("When")}
            <select name="lag" defaultValue={String(lag)} className="input w-40 py-1 text-sm">
              <option value="0">{t("Same day")}</option>
              <option value="1">{t("The day before")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            {t("Days back")}
            <input type="number" name="days" min={14} max={730} defaultValue={days} className="input w-24 py-1 text-sm" />
          </label>
          <button type="submit" className="btn">
            {t("Show")}
          </button>
        </form>

        {!y && <p className="card p-6 text-center text-sm text-zinc-500">{t("No series has values in this period yet — keep a journal (Workspace → templates) or let Zeff sync your calendar and messages.")}</p>}

        {y && pair && x && (
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold">{lag ? t("{x} (the day before) and {y}", { x: x.label, y: y.label }) : t("{x} and {y} (same day)", { x: x.label, y: y.label })}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{pairText(x, y, lag, pair)}</p>
            {scale && <p className="text-xs text-zinc-500">{t("Scale: {scale}.", { scale })}</p>}
            {pair.points.length > 0 && <Scatter pair={pair} x={x} y={y} />}
            {pair.groups && (
              <div className="max-w-xl">
                <p className="mb-1 text-xs text-zinc-500">{t("{y}, average", { y: y.label })}</p>
                <BarList
                  items={[
                    { key: "hi", label: x.kind === "binary" || pair.groups.threshold === 0 ? t("with {x}", { x: x.label }) : t("more than {thr} {x}", { thr: `${num(pair.groups.threshold ?? 0)}${x.unit ? ` ${x.unit}` : ""}`, x: x.label }), value: pair.groups.high.mean, valueLabel: `${num(pair.groups.high.mean)} (${t("{n} days", { n: pair.groups.high.n })})`, barClass: "bg-indigo-500" },
                    { key: "lo", label: t("otherwise"), value: pair.groups.low.mean, valueLabel: `${num(pair.groups.low.mean)} (${t("{n} days", { n: pair.groups.low.n })})`, barClass: "bg-zinc-400" },
                  ]}
                />
              </div>
            )}
            <Link href={exploreHref(y.id, { days })} className="text-xs text-indigo-600 dark:text-indigo-400">
              {t("Back to the findings")} →
            </Link>
          </section>
        )}

        {y && report && !pair && (
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t("What goes with {y}", { y: y.label })}</h2>
            <p className="text-xs text-zinc-500">
              {t("{from} to {to}: values on {n} days; {tested} comparisons made.", { from: report.from, to: report.to, n: report.days, tested: report.tested })}
              {scale ? ` ${t("Scale: {scale}.", { scale })}` : ""}
            </p>
            {report.insufficient ? (
              <p className="text-sm text-zinc-500">{report.insufficient}</p>
            ) : report.findings.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("No link holds yet — nothing goes with it reliably over these days.")}</p>
            ) : (
              <ol className="space-y-2">
                {report.findings.map((f) => (
                  <li key={`${f.other.id}:${f.lag}`} className="text-sm">
                    <Link href={exploreHref(y.id, { x: f.other.id, lag: f.lag, days })} className="text-zinc-800 no-underline hover:text-indigo-700 dark:text-zinc-100 dark:hover:text-indigo-300">
                      {f.sentence}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
