"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { layoutDag } from "@/lib/graph/layout";
import type { SkillTreeStatus } from "./SkillTree";
import { naturalWay, nodeDiscs, organicWay, threadCorners, wayLabels, type Grid } from "./thread-route";

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
  /** One of the foundations, learned one after another (drawn down the first column, joined in order). */
  foundation?: boolean;
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
export function SkillMap({
  nodes,
  groups,
  label,
  route,
}: {
  nodes: SkillMapNode[];
  groups: { key: string; title: string }[];
  label: string;
  /** The red thread: the nodes in the order they're walked (`walked` of them begun; the rest the plan ahead). */
  route?: { keys: string[]; walked: number };
}) {
  const t = useT();
  // The foundations (nothing before them): one after another down the first column, in the red thread's order.
  const foundations = useMemo(() => {
    // Marked as such (the first phase's skills) — else those that need nothing.
    const marked = nodes.filter((n) => n.foundation);
    const roots = new Set((marked.length ? marked : nodes.filter((n) => !n.after.some((a) => nodes.some((m) => m.key === a)))).map((n) => n.key));
    const inRoute = (route?.keys ?? []).filter((k) => roots.has(k));
    return [...inRoute, ...nodes.filter((n) => roots.has(n.key) && !inRoute.includes(n.key)).map((n) => n.key)];
  }, [nodes, route]);
  const layout = useMemo(() => layoutDag(nodes.map((n) => ({ key: n.key, after: n.after })), 4, { firstColumn: foundations }), [nodes, foundations]);
  const thread = useMemo(() => (route?.keys ?? []).filter((k) => layout.pos.has(k)), [route, layout]);
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
  // Where a line meets a node: spread over a half circle, not all in one point — what comes in over the left half, what
  // goes out over the right, each in the order of where its other end lies (top to bottom), so lines cross less.
  const spread = (i: number, count: number) => (count > 1 ? -0.4 * Math.PI + (0.8 * Math.PI * i) / (count - 1) : 0);
  const inAngle = new Map<string, number>();
  const outAngle = new Map<string, number>();
  for (const n of nodes) {
    const ins = n.after.filter((a) => layout.pos.has(a)).sort((p, q) => xy(p).y - xy(q).y || xy(p).x - xy(q).x);
    ins.forEach((a, i) => inAngle.set(`${a}>${n.key}`, Math.PI - spread(i, ins.length)));
    const outs = nodes.filter((m) => m.after.includes(n.key)).sort((p, q) => xy(p.key).y - xy(q.key).y || xy(p.key).x - xy(q.key).x);
    outs.forEach((m, i) => outAngle.set(`${n.key}>${m.key}`, spread(i, outs.length)));
  }
  const port = (k: string, angle: number) => {
    const c = xy(k);
    return { x: c.x + R * Math.cos(angle), y: c.y + R * Math.sin(angle) };
  };
  const width = Math.max(1, layout.cols) * COL;
  const height = TOP + Math.max(1, layout.rows) * ROW;
  /**
   * A curve leaving p1 in the direction a1 and coming into p2 from a2 (the angles point away from each node). Its
   * control points kept inside the map's bands — a curve stays inside them, so no line swings out of the panel.
   */
  const inside = (x: number, y: number) => [Math.min(width - 8, Math.max(8, x)), Math.min(height - 8, Math.max(8, y))] as const;
  const controls = (p1: { x: number; y: number }, a1: number, p2: { x: number; y: number }, a2: number) => {
    const k = Math.max(30, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2.6);
    return [...inside(p1.x + Math.cos(a1) * k, p1.y + Math.sin(a1) * k), ...inside(p2.x + Math.cos(a2) * k, p2.y + Math.sin(a2) * k)] as const;
  };
  const curve = (p1: { x: number; y: number }, a1: number, p2: { x: number; y: number }, a2: number) => {
    const [c1x, c1y, c2x, c2y] = controls(p1, a1, p2, a2);
    return `M${p1.x},${p1.y} C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  };
  // The red thread's stretches: soft curves through the white space (thread-route.ts) — around the circles, behind the
  // titles' cards if need be; ways sharing a gap between two columns moved a little apart. Each one's number on its way,
  // clear of the circles, the other numbers and the other ways.
  const threadWays = useMemo(() => {
    const grid: Grid = { col: COL, row: ROW, top: TOP, r: R, width, height };
    const taken = new Set([...layout.pos.values()].map((p) => `${p.col}:${p.row}`));
    const has = (c: number, r: number) => taken.has(`${c}:${r}`);
    const uses = new Map<number, number>();
    const SHIFTS = [0, 5, -5, 9, -9];
    const cells = [...layout.pos.entries()];
    const drawn: { x: number; y: number }[][] = [];
    // The titles' cards (a little narrower than the cell: short titles are narrower still).
    const titleBoxes = cells.map(([key]) => {
      const c = xy(key);
      return { x1: c.x - 62, x2: c.x + 62, y1: c.y + R + 4, y2: c.y + R + 40 };
    });
    const ways = thread.slice(1).map((k, i) => {
      const a = layout.pos.get(thread[i])!;
      const b = layout.pos.get(k)!;
      const gaps = new Set(threadCorners(grid, a, b, has).slice(1, -1).map((p) => p.x).filter((x) => x % COL === 0 || x === 16 || x === width - 16));
      const n = Math.max(0, ...[...gaps].map((x) => uses.get(x) ?? 0));
      for (const x of gaps) uses.set(x, n + 1);
      const corners = threadCorners(grid, a, b, has, SHIFTS[n % SHIFTS.length]);
      const discs = nodeDiscs(grid, cells.filter(([key]) => key !== thread[i] && key !== k).map(([, p]) => p));
      // A free, natural curve, keeping off the ways before it; where none fits, along the corridor.
      const free = naturalWay(grid, xy(thread[i]), xy(k), discs, drawn, titleBoxes);
      const way = free.samples.length ? free : organicWay(grid, corners, discs);
      drawn.push(way.samples);
      return { key: k, ...way };
    });
    // (The numbers keep off the titles' cards too: those lie over the lines.)
    const titles = cells.flatMap(([key]) => {
      const c = xy(key);
      return [-60, -30, 0, 30, 60].map((dx) => ({ x: c.x + dx, y: c.y + R + 20, r: 16 }));
    });
    const mids = wayLabels(ways.map((w) => w.samples), [...nodeDiscs(grid, cells.map(([, p]) => p), 2), ...titles]);
    return ways.map((w, i) => ({ key: w.key, d: w.d, mid: mids[i] }));
  }, [thread, layout, width, height]);
  const bands = groups
    .map((g) => {
      const cols = nodes.filter((n) => n.group === g.key).map((n) => layout.pos.get(n.key)!.col);
      return cols.length ? { ...g, from: Math.min(...cols), to: Math.max(...cols) } : null;
    })
    .filter((b): b is NonNullable<typeof b> => !!b);

  return (
    <div className="space-y-3">
      {thread.length > 1 && (
        <p className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <svg width="34" height="8" aria-hidden>
            <line x1="1" y1="4" x2="15" y2="4" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" />
            <line x1="19" y1="4" x2="33" y2="4" stroke="#dc2626" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          {t("The red thread: your way through the map — walked, then the plan ahead (the foundations first, then what interests you most)")}
        </p>
      )}
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
      {/* The skill picked — its lessons, done and under way — above the map (where you go on from). */}
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
                  const from = byKey.get(a)!;
                  const done = from.status === "mastered";
                  const locked = n.status === "locked";
                  return (
                    <path
                      key={`${a}>${n.key}`}
                      d={curve(port(a, outAngle.get(`${a}>${n.key}`) ?? 0), outAngle.get(`${a}>${n.key}`) ?? 0, port(n.key, inAngle.get(`${a}>${n.key}`) ?? Math.PI), inAngle.get(`${a}>${n.key}`) ?? Math.PI)}
                      fill="none"
                      strokeWidth={done ? 2.5 : 2}
                      strokeDasharray={locked ? "4 5" : undefined}
                      stroke={done ? "#10b981" : locked ? "#a1a1aa" : color(n.path)}
                      // (Faint: with the red thread on top, the map's own lines are the background.)
                      strokeOpacity={locked ? (route ? 0.18 : 0.6) : route ? 0.4 : 0.75}
                    />
                  );
                }),
            )}
            {/* The foundations one after another: down the first column. */}
            {foundations.slice(1).map((k, i) => {
              const a = xy(foundations[i]);
              const b = xy(k);
              const done = byKey.get(foundations[i])?.status === "mastered";
              return <line key={`seq-${k}`} x1={a.x} y1={a.y + R + 2} x2={b.x} y2={b.y - R - 6} stroke={done ? "#10b981" : "#a1a1aa"} strokeWidth={2} markerEnd="url(#seq-arrow)" />;
            })}
            <defs>
              <marker id="seq-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" fill="#a1a1aa" />
              </marker>
            </defs>
            {/* The red thread: the way through the map — walked solid, the plan ahead dashed. */}
            {threadWays.map(({ key: k, d }, i) => {
              const walked = i + 1 < (route?.walked ?? 0);
              return <path key={`thread-${k}`} d={d} fill="none" stroke="#dc2626" strokeWidth={walked ? 4 : 2.5} strokeOpacity={walked ? 0.75 : 0.55} strokeDasharray={walked ? undefined : "6 6"} strokeLinecap="round" strokeLinejoin="round" />;
            })}
            {/* Its order: a number on each stretch — where the thread goes next. */}
            {threadWays.map(({ key: k, mid: m }, i) => {
              const walked = i + 1 < (route?.walked ?? 0);
              return (
                <g key={`n-${k}`}>
                  <circle cx={m.x} cy={m.y} r={9} fill={walked ? "#dc2626" : "#fff"} stroke="#dc2626" strokeWidth={1.5} />
                  <text x={m.x} y={m.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={walked ? "#fff" : "#dc2626"}>
                    {i + 2}
                  </text>
                </g>
              );
            })}
          </svg>
          {bands.map((b, i) => (
            // Bands sharing columns (two phases side by side in one): their names one under the other, not on top of each other.
            <span key={b.key} className="absolute truncate px-3 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase" style={{ left: b.from * COL + 6, top: 14 + bands.slice(0, i).filter((o) => o.from <= b.to && b.from <= o.to).length * 14, width: (b.to - b.from + 1) * COL - 12 }} title={b.title}>
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
                    {n.status === "mastered" ? "✓" : n.status === "locked" ? <span className="text-xl leading-none">🔒</span> : `${done}/${n.steps.length}`}
                  </span>
                </span>
                <span className={`line-clamp-2 max-w-full rounded-md border border-zinc-200 bg-white/[0.32] px-1.5 py-0.5 text-center text-xs leading-snug shadow-sm dark:border-zinc-700 dark:bg-zinc-900/[0.32] ${n.status === "locked" ? "text-zinc-500 dark:text-zinc-400" : "font-medium text-zinc-800 dark:text-zinc-200"}`}>{n.title}</span>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}

function statusLabel(t: (s: string) => string, s: SkillTreeStatus): string {
  return s === "mastered" ? t("mastered") : s === "active" ? t("in progress") : s === "available" ? t("open") : t("locked");
}
