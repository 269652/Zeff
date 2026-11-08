"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { layoutDag } from "@/lib/graph/layout";
import type { SkillTreeStatus } from "./SkillTree";

export type SkillMapStep = { key: string; title: string; status: SkillTreeStatus; href?: string; minutes?: number | null };
export type SkillMapNode = {
  key: string;
  title: string;
  status: SkillTreeStatus;
  path: string | null;
  /** The band it's drawn in (a phase). */
  group: string | null;
  /** The nodes it follows. */
  after: string[];
  summary?: string;
  steps: SkillMapStep[];
};

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"];
const COL = 190;
const ROW = 118;
const TOP = 40;
const R = 28;

/**
 * A skill map (a building block of Zeff): the whole tree as a graph — each skill a round node with its progress as a
 * ring, coloured by its path, in columns after what it requires (src/lib/graph/layout.ts), the groups (phases) as bands
 * behind them, lines from what comes before. A node picked shows its steps below. Scrolls sideways on a phone.
 */
export function SkillMap({ nodes, groups, label }: { nodes: SkillMapNode[]; groups: { key: string; title: string }[]; label: string }) {
  const t = useT();
  const layout = useMemo(() => layoutDag(nodes.map((n) => ({ key: n.key, after: n.after }))), [nodes]);
  const paths = useMemo(() => [...new Set(nodes.map((n) => n.path).filter((p): p is string => !!p))], [nodes]);
  const color = (p: string | null) => (p ? PALETTE[paths.indexOf(p) % PALETTE.length] : "#71717a");
  const first = nodes.find((n) => n.status === "active") ?? nodes.find((n) => n.status === "available") ?? nodes[0];
  const [picked, setPicked] = useState<string | undefined>(first?.key);
  const byKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);
  const sel = picked ? byKey.get(picked) : undefined;

  const xy = (k: string) => {
    const p = layout.pos.get(k)!;
    return { x: p.col * COL + COL / 2, y: TOP + p.row * ROW + R + 8 };
  };
  const width = Math.max(1, layout.cols) * COL;
  const height = TOP + Math.max(1, layout.rows) * ROW;
  const bands = groups
    .map((g) => {
      const cols = nodes.filter((n) => n.group === g.key).map((n) => layout.pos.get(n.key)!.col);
      return cols.length ? { ...g, from: Math.min(...cols), to: Math.max(...cols) } : null;
    })
    .filter((b): b is NonNullable<typeof b> => !!b);

  return (
    <div className="space-y-3">
      {paths.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400" aria-label={t("Paths")}>
          {paths.map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: color(p) }} aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" role="group" aria-label={label}>
        <div className="relative" style={{ width, height }}>
          <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
            {bands.map((b, i) => (
              <g key={b.key}>
                <rect x={b.from * COL + 6} y={6} width={(b.to - b.from + 1) * COL - 12} height={height - 12} rx={14} className={i % 2 ? "fill-zinc-50 dark:fill-zinc-900/60" : "fill-indigo-50/60 dark:fill-indigo-950/30"} />
              </g>
            ))}
            {nodes.flatMap((n) =>
              n.after
                .filter((a) => layout.pos.has(a))
                .map((a) => {
                  const s = xy(a);
                  const e = xy(n.key);
                  const x1 = s.x + R;
                  const x2 = e.x - R;
                  const mx = (x1 + x2) / 2;
                  const from = byKey.get(a)!;
                  const done = from.status === "mastered";
                  const locked = n.status === "locked";
                  return (
                    <path
                      key={`${a}>${n.key}`}
                      d={`M${x1},${s.y} C${mx},${s.y} ${mx},${e.y} ${x2},${e.y}`}
                      fill="none"
                      strokeWidth={done ? 2.5 : 2}
                      strokeDasharray={locked ? "4 5" : undefined}
                      stroke={done ? "#10b981" : locked ? "#a1a1aa" : color(n.path)}
                      strokeOpacity={locked ? 0.6 : 0.75}
                    />
                  );
                }),
            )}
          </svg>
          {bands.map((b) => (
            <span key={b.key} className="absolute truncate px-3 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase" style={{ left: b.from * COL + 6, top: 14, width: (b.to - b.from + 1) * COL - 12 }} title={b.title}>
              {b.title}
            </span>
          ))}
          {nodes.map((n) => {
            const { x, y } = xy(n.key);
            const done = n.steps.filter((s) => s.status === "mastered").length;
            const share = n.steps.length ? done / n.steps.length : 0;
            const c = color(n.path);
            const circ = 2 * Math.PI * (R - 3);
            return (
              <button
                key={n.key}
                type="button"
                onClick={() => setPicked(n.key)}
                aria-pressed={picked === n.key}
                aria-label={`${n.title} — ${statusLabel(t, n.status)}, ${t("{done} of {total} steps", { done, total: n.steps.length })}`}
                className="group absolute flex flex-col items-center gap-1.5 rounded-xl focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:outline-none"
                style={{ left: x - COL / 2 + 8, top: y - R - 4, width: COL - 16 }}
              >
                <span className={`relative grid place-items-center rounded-full transition group-hover:scale-105 ${picked === n.key ? "ring-4 ring-indigo-500/30" : ""} ${n.status === "active" ? "animate-pulse" : ""}`} style={{ width: R * 2, height: R * 2 }}>
                  <svg width={R * 2} height={R * 2} className="absolute inset-0 -rotate-90" aria-hidden>
                    <circle cx={R} cy={R} r={R - 3} fill="none" strokeWidth={5} className="stroke-zinc-200 dark:stroke-zinc-800" />
                    <circle cx={R} cy={R} r={R - 3} fill="none" strokeWidth={5} stroke={c} strokeOpacity={0.22} />

                    {share > 0 && <circle cx={R} cy={R} r={R - 3} fill="none" strokeWidth={5} stroke={c} strokeLinecap="round" strokeDasharray={`${circ * share} ${circ}`} />}
                  </svg>
                  <span
                    className={`grid size-10 place-items-center rounded-full text-sm font-semibold ${n.status === "locked" ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500" : n.status === "mastered" ? "text-white" : "bg-white dark:bg-zinc-900"}`}
                    style={n.status === "mastered" ? { background: c } : n.status === "locked" ? undefined : { color: c, boxShadow: `inset 0 0 0 2px ${c}` }}
                    aria-hidden
                  >
                    {n.status === "mastered" ? "✓" : n.status === "locked" ? "🔒" : `${done}/${n.steps.length}`}
                  </span>
                </span>
                <span className={`line-clamp-2 text-center text-xs leading-snug ${n.status === "locked" ? "text-zinc-400 dark:text-zinc-500" : "font-medium text-zinc-800 dark:text-zinc-200"}`}>{n.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {sel && (
        <section className="card space-y-2 p-4" aria-live="polite" aria-label={sel.title}>
          <header className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 font-semibold">{sel.title}</h3>
            {sel.path && (
              <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: color(sel.path) }}>
                {sel.path}
              </span>
            )}
            <span className="text-xs text-zinc-500">{statusLabel(t, sel.status)}</span>
          </header>
          {sel.summary && <p className="text-sm text-zinc-600 dark:text-zinc-400">{sel.summary}</p>}
          {sel.status === "locked" && sel.after.length > 0 && (
            <p className="text-sm text-zinc-500">
              {t("First: {skills}", { skills: sel.after.map((a) => byKey.get(a)?.title).filter(Boolean).join(", ") })}
            </p>
          )}
          <ol className="grid gap-1 sm:grid-cols-2">
            {sel.steps.map((st) => {
              const inner = (
                <>
                  <span className={`grid size-4 shrink-0 place-items-center rounded-full text-[9px] ${st.status === "mastered" ? "text-white" : ""}`} style={st.status === "mastered" ? { background: color(sel.path) } : { boxShadow: `inset 0 0 0 1.5px ${st.status === "locked" ? "#a1a1aa" : color(sel.path)}` }} aria-hidden>
                    {st.status === "mastered" ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{st.title}</span>
                  {st.minutes ? <span className="shrink-0 text-[11px] text-zinc-400">{st.minutes}′</span> : null}
                  <span className="sr-only">— {statusLabel(t, st.status)}</span>
                </>
              );
              return (
                <li key={st.key}>
                  {st.href && st.status !== "locked" ? (
                    <Link href={st.href} className="flex min-h-9 items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none dark:hover:bg-white/5">
                      {inner}
                    </Link>
                  ) : (
                    <span className="flex min-h-9 items-center gap-2 px-1.5 py-1 text-sm text-zinc-500">{inner}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

function statusLabel(t: (s: string) => string, s: SkillTreeStatus): string {
  return s === "mastered" ? t("mastered") : s === "active" ? t("in progress") : s === "available" ? t("open") : t("locked");
}
