"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { Overlay } from "@/components/Overlay";
import type { VNode } from "../view-template";
import type { BlockEnv } from "./view-blocks";
import { NODE_R, type GraphLayout } from "../view-graph";
import { SkillMap, type SkillMapNode } from "@/components/skill-tree/SkillMap";
import { AgendaList } from "@/plugins/calendar/AgendaList";
import { MonthGrid } from "@/plugins/calendar/MonthGrid";
import { TimeGrid } from "@/plugins/calendar/TimeGrid";
import { stampAt, viewRange, ymd, type Item } from "@/plugins/calendar/view-shared";

/**
 * More of the view language's blocks (view-template.ts): tabs that hold their content, a dialog or drawer, inputs and a slider that
 * set the view's state, a month calendar, a day by day heatmap, a cross table, a ring, stars, a copy button. Drawn from the nodes the
 * template made; colours from the theme's zinc and indigo and the tones, so the contrast stays what globals.css keeps.
 */

type Node = Extract<VNode, object>;
type Kids = (nodes: VNode[]) => ReactNode;

const json = <T,>(s: string | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const items = (n: Node) => n.c.filter((c): c is Node => typeof c !== "string");
const TONE_STROKE: Record<string, string> = { info: "text-indigo-500", good: "text-emerald-500", warn: "text-amber-500", bad: "text-red-500" };

/** A node of these blocks drawn — undefined: not one of them. */
export function moreBlock(n: Node, key: string | number, kids: Kids, env: BlockEnv): ReactNode | undefined {
  const a = n.a;
  switch (n.t) {
    case "tabset":
      return <TabSet key={key} n={n} kids={kids} env={env} />;
    case "dialog":
      return <DialogBlock key={key} n={n} kids={kids} env={env} />;
    case "input":
      return <InputBlock key={key} a={a} env={env} />;
    case "slider":
      return <SliderBlock key={key} a={a} env={env} />;
    case "calendar":
      return <CalendarBlock key={key} n={n} kids={kids} env={env} />;
    case "heatmap":
      return <Heatmap key={key} a={a} />;
    case "pivot":
      return <Pivot key={key} a={a} />;
    case "gauge":
      return <Gauge key={key} a={a} />;
    case "rating":
      return <Rating key={key} a={a} env={env} />;
    case "copy":
      return <CopyButton key={key} a={a} />;
    case "schedule":
      return <ScheduleBlock key={key} a={a} env={env} />;
    case "graph":
      return <GraphBlock key={key} a={a} env={env} />;
    case "upload":
      return <UploadBlock key={key} a={a} env={env} />;
    default:
      return undefined;
  }
}

function TabSet({ n, kids, env }: { n: Node; kids: Kids; env: BlockEnv }) {
  const opts = json<[string, string, string?][]>(n.a.options, []);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 print:hidden dark:border-zinc-800" role="tablist">
        {opts.map(([v, label, count]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={n.a.current === v}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition ${n.a.current === v ? "border-indigo-600 text-zinc-900 dark:border-indigo-400 dark:text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
            onClick={() => env.setState(n.a.bind, v)}
          >
            {label}
            {count !== undefined && <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 text-xs font-normal text-zinc-600 tabular-nums dark:bg-zinc-800 dark:text-zinc-300">{count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="space-y-3">
        {kids(n.c)}
      </div>
    </div>
  );
}

function DialogBlock({ n, kids, env }: { n: Node; kids: Kids; env: BlockEnv }) {
  const t = useT();
  const close = () => env.setState(n.a.bind, "");
  const right = n.a.side === "right";
  return (
    <Overlay open onClose={close} label={n.a.title || t("Dialog")} side={right ? "right" : "center"} className={right ? "" : `relative w-full ${n.a.wide === "true" ? "max-w-3xl" : "max-w-lg"} max-h-[85vh] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950`}>
      <div className={right ? "space-y-4 p-5" : "space-y-4"}>
        <div className="flex items-start justify-between gap-3">
          {n.a.title ? <h2 className="text-lg font-semibold">{n.a.title}</h2> : <span />}
          <button type="button" className="rounded px-2 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" aria-label={t("Close")} title={t("Close")} onClick={close}>
            ✕
          </button>
        </div>
        <div className="space-y-3 text-sm">{kids(n.c)}</div>
      </div>
    </Overlay>
  );
}

function InputBlock({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const type = a.type ?? "text";
  // (Typed here, set a moment later: the view isn't drawn again at every key.)
  const [v, setV] = useState(a.current ?? "");
  // (Set from elsewhere — a button, another input: what is shown follows.)
  const [was, setWas] = useState(a.current ?? "");
  if (was !== (a.current ?? "")) {
    setWas(a.current ?? "");
    setV(a.current ?? "");
  }
  useEffect(() => {
    if (v === (a.current ?? "")) return;
    const timer = setTimeout(() => env.setState(a.bind, v), type === "text" || type === "textarea" || type === "email" || type === "url" ? 250 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only what was typed
  }, [v]);
  // enter="event": Enter (not Shift+Enter) sets what is typed at once and sends the event — a chat line sent with Enter.
  const onKeyDown = a.enter
    ? (e: React.KeyboardEvent) => {
        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
        e.preventDefault();
        env.setState(a.bind, v);
        env.emitLater?.(a.enter);
      }
    : undefined;
  // (rows=: a textarea's height in lines — one: a chat's line, no handle)
  const rows = Number(a.rows) > 0 ? Math.min(40, Number(a.rows)) : undefined;
  const field =
    type === "textarea" ? (
      <textarea className={`input w-full text-sm ${rows ? (rows <= 2 ? "min-h-10 resize-none" : "") : "min-h-20"}`} rows={rows} placeholder={a.placeholder} aria-label={a.label || a.placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKeyDown} />
    ) : (
      <input type={type} className={`input py-1 text-sm ${type === "color" ? "h-8 w-12 p-0.5" : type === "number" ? "w-28" : type === "text" || type === "email" || type === "url" ? "w-full min-w-40" : "w-auto"}`} placeholder={a.placeholder} aria-label={a.label || a.placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKeyDown} />
    );
  if (!a.label) return <span className={`print:hidden ${type === "textarea" ? "block w-full" : "inline-flex"}`}>{field}</span>;
  return (
    <label className={`gap-1 text-sm print:hidden ${type === "textarea" ? "flex w-full flex-col" : "inline-flex items-center gap-1.5"}`}>
      <span className="text-xs text-zinc-500">{a.label}</span>
      {field}
    </label>
  );
}

const GRAPH_COLORS: Record<string, string> = { gray: "#71717a", brown: "#a16207", orange: "#ea580c", yellow: "#ca8a04", green: "#16a34a", blue: "#2563eb", purple: "#9333ea", pink: "#db2777", red: "#dc2626" };
const BAND_FILLS = ["#6366f10d", "#10b9810d", "#f59e0b0d", "#ec48990d"];
const paintOf = (c: string | undefined, fallback: string) => (c && (GRAPH_COLORS[c] ?? (/^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined))) || fallback;

/** The dependency map (<graph look="map">): the skill map's own drawing — sideways scrolling bands, rings, the red thread, a picked node's parts above it. */
function MapBlock({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const data = json<{ nodes: SkillMapNode[]; groups: { key: string; title: string }[]; route: { keys: string[]; walked: number } | null }>(a.map, { nodes: [], groups: [], route: null });
  const nodes = data.nodes.map((n) => ({ ...n, after: n.after ?? [], steps: n.steps ?? [], path: n.path || null, group: n.group || null }));
  return (
    <SkillMap
      key={nodes.map((n) => n.key).join("|")}
      nodes={nodes}
      groups={data.groups}
      route={data.route ?? undefined}
      label={a.label || ""}
      onStep={a.stepbind ? (k) => env.run({ action: "state", state: a.stepbind, value: k, ...(a.stepemit ? { emit: a.stepemit } : {}) }) : undefined}
    />
  );
}

/**
 * <schedule>: things with a time as the calendar shows appointments — a day or a week in hours (side by side where they overlap), a month, an
 * agenda. A click opens one (its id into state.<bind>, then emit=); dragging one moves it (state.<bind>, <bind>_start, <bind>_end, then move=);
 * dragging on free time makes one (<bind>_start, <bind>_end, <bind>_allday, then create=); a day picked goes into state.<daybind>.
 */
function ScheduleBlock({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const t = useT();
  const items = useMemo(() => json<Omit<Item, "event" | "calendar" | "proposed" | "merged">[]>(a.items, []).map((x) => ({ ...x, color: paintOf(x.color, "#6366f1") }) as Item), [a.items]);
  const today = ymd(new Date());
  const day = a.day || today;
  const view = (a.view || "week") as "day" | "week" | "month" | "agenda";
  const { days } = viewRange(view, day);
  const bind = a.bind || "picked";
  const later = (event: string | undefined) => event && (env.emitLater ? env.emitLater(event) : env.run({ emit: event }));
  const open = (it: Item) => (env.setState(bind, it.id), later(a.emit));
  const move = (it: Item, start: string, end: string) => (env.setState(bind, it.id), env.setState(`${bind}_start`, start), env.setState(`${bind}_end`, end), later(a.move));
  const create = (v: { start: string; end: string; allDay: boolean }) => {
    if (!a.create) return;
    env.setState(`${bind}_start`, v.start);
    env.setState(`${bind}_end`, v.end);
    env.setState(`${bind}_allday`, v.allDay ? "true" : "");
    later(a.create);
  };
  const pick = (d: string) => a.daybind && env.setState(a.daybind, d);
  if (!items.length && a.empty && view === "agenda") return <p className="text-sm text-zinc-500">{a.empty}</p>;
  return (
    <div className="h-[36rem] min-h-0 min-w-0 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800" aria-label={t("Calendar")}>
      {view === "month" ? (
        <MonthGrid days={days} month={day.slice(0, 7)} items={items} today={today} onCreate={create} onOpen={open} onMove={move} onPickDay={pick} />
      ) : view === "agenda" ? (
        <AgendaList days={days} items={items} today={today} onOpen={open} />
      ) : (
        <TimeGrid days={days} items={items} now={stampAt(today, new Date().getHours() * 60 + new Date().getMinutes())} onCreate={create} onOpen={open} onMove={move} onPickDay={pick} />
      )}
    </div>
  );
}

/** A graph (<graph>): the nodes in columns and bands, the lines between them, the thread; a node picked is marked and sets the view's state. */
function GraphBlock({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  if (a.look === "map") return <MapBlock a={a} env={env} />;
  const layout = json<GraphLayout | null>(a.layout, null);
  if (!layout) return null;
  const pick = (id: string) => a.bind && env.run({ action: "state", state: a.bind, value: id, ...(a.emit ? { emit: a.emit } : {}) });
  return (
    <div className="overflow-x-auto print:overflow-visible" role="group">
      <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} className="max-w-none text-zinc-700 dark:text-zinc-300" role="img">
        {layout.bands.map((b, i) => (
          <g key={b.group}>
            <rect x={4} y={b.y} width={layout.width - 8} height={b.h} rx={14} fill={BAND_FILLS[i % BAND_FILLS.length]} stroke="currentColor" strokeOpacity={0.12} />
            <text x={14} y={b.y + 16} fontSize={11} fill="currentColor" opacity={0.55} fontWeight={600}>
              {b.group}
            </text>
          </g>
        ))}
        {layout.edges.map((e) => (
          <path key={`${e.from}>${e.to}`} d={e.d} fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={1.5} />
        ))}
        {layout.thread.map((s) => (
          <path key={s.n} d={s.d} fill="none" stroke="#dc2626" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={s.solid ? undefined : "6 6"} opacity={s.solid ? 0.9 : 0.55} />
        ))}
        {layout.nodes.map((n) => {
          const color = paintOf(n.color, "#6366f1");
          const circ = 2 * Math.PI * (NODE_R - 3);
          const done = n.state === "done";
          const locked = n.state === "locked";
          const words = n.label.split(/\s+/);
          const lines: string[] = [];
          for (const w of words) (lines.length && (lines[lines.length - 1] + " " + w).length <= 18 ? (lines[lines.length - 1] += " " + w) : lines.push(w));
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} onClick={() => pick(n.id)} style={{ cursor: a.bind ? "pointer" : "default" }} opacity={locked ? 0.55 : 1} role={a.bind ? "button" : undefined} aria-label={n.label}>
              <circle r={NODE_R} fill="white" className="dark:fill-zinc-900" stroke={a.current === n.id ? "#111827" : color} strokeWidth={a.current === n.id ? 3 : 2} strokeOpacity={a.current === n.id ? 0.9 : 0.35} />
              {n.progress !== undefined && <circle r={NODE_R - 3} fill="none" stroke={color} strokeWidth={4} strokeDasharray={`${circ * n.progress} ${circ}`} transform="rotate(-90)" strokeLinecap="round" />}
              {done && <circle r={NODE_R - 3} fill={color} opacity={0.9} />}
              <text textAnchor="middle" dominantBaseline="central" fontSize={done || locked ? 16 : 11} fill={done ? "white" : "currentColor"}>
                {done ? "✓" : locked ? "🔒" : (n.ring ?? "")}
              </text>
              {n.step !== undefined && (
                <g transform={`translate(${NODE_R - 2},${-NODE_R + 2})`}>
                  <circle r={9} fill="#dc2626" />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={10} fill="white" fontWeight={700}>
                    {n.step}
                  </text>
                </g>
              )}
              {lines.slice(0, 3).map((l, i) => (
                <text key={i} y={NODE_R + 14 + i * 13} textAnchor="middle" fontSize={11} fill="currentColor">
                  {l.length > 20 ? `${l.slice(0, 19)}…` : l}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A file read as text into the view's state (state.<bind>, its name in state.<bind>_name). */
function UploadBlock({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const t = useT();
  const maxKb = Number(a.max) || 200;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > maxKb * 1024) return void toast(t("That file is too big (at most {kb} KB).", { kb: maxKb }), { tone: "error" });
    try {
      const text = await file.text();
      env.setState(a.bind, text);
      env.setState(`${a.bind}_name`, file.name);
    } catch {
      toast(t("The file could not be read."), { tone: "error" });
    }
  };
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm print:hidden" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), void pick(e.dataTransfer.files?.[0]))}>
      <span className="btn btn-sm">{a.label || t("Choose a file")}</span>
      <input type="file" className="sr-only" accept={a.accept || undefined} onChange={(e) => void pick(e.target.files?.[0])} />
      {a.name && <span className="text-xs text-zinc-500">{a.name}</span>}
    </label>
  );
}

function SliderBlock({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const min = Number(a.min ?? 0);
  const max = Number(a.max ?? 100);
  const value = a.current === "" || a.current === undefined ? min : Number(a.current);
  return (
    <label className="inline-flex min-w-48 flex-1 items-center gap-2 text-sm print:hidden">
      {a.label && <span className="text-xs whitespace-nowrap text-zinc-500">{a.label}</span>}
      <input type="range" className="flex-1 accent-indigo-600" min={min} max={max} step={Number(a.step) || 1} value={Number.isFinite(value) ? value : min} onChange={(e) => env.setState(a.bind, e.target.value)} />
      <span className="w-14 text-right font-medium tabular-nums">
        {Number.isFinite(value) ? value.toLocaleString() : ""}
        {a.unit ? ` ${a.unit}` : ""}
      </span>
    </label>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function CalendarBlock({ n, kids, env }: { n: Node; kids: Kids; env: BlockEnv }) {
  const t = useT();
  const [y, m] = n.a.month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lang = typeof navigator !== "undefined" ? navigator.language : "de-DE";
  const title = first.toLocaleDateString(lang, { month: "long", year: "numeric" });
  const go = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    env.setState(n.a.bind, `${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };
  const byDay = useMemo(() => {
    const map = new Map<string, Node[]>();
    for (const it of items(n)) map.set(it.a.day, [...(map.get(it.a.day) ?? []), it]);
    return map;
  }, [n]);
  // From the Monday on or before the 1st to the Sunday on or after the last.
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const last = new Date(y, m, 0);
  const cells: Date[] = [];
  for (const d = new Date(start); d <= last || cells.length % 7; d.setDate(d.getDate() + 1)) cells.push(new Date(d));
  const weekdays = cells.slice(0, 7).map((d) => d.toLocaleDateString(lang, { weekday: "short" }));
  const entry = (it: Node, i: number) => (
    <div key={it.a.row ?? i} className={`truncate rounded bg-indigo-50 px-1 py-0.5 text-xs text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-100 ${it.a.row ? "cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/60" : ""}`} onClick={it.a.row ? () => env.props.openRow(Number(it.a.row)) : undefined}>
      {kids(it.c)}
    </div>
  );
  const days = cells.filter((d) => d.getMonth() === m - 1 && byDay.has(dayKey(d)));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm min-w-7 justify-center" aria-label={t("Previous month")} title={t("Previous month")} onClick={() => go(-1)}>
          ‹
        </button>
        <button type="button" className="btn btn-sm min-w-7 justify-center" aria-label={t("Next month")} title={t("Next month")} onClick={() => go(1)}>
          ›
        </button>
        <h3 className="text-base font-semibold capitalize">{title}</h3>
        {n.a.month !== n.a.today.slice(0, 7) && (
          <button type="button" className="ml-auto rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800" onClick={() => env.setState(n.a.bind, n.a.today.slice(0, 7))}>
            {t("Today")}
          </button>
        )}
      </div>
      {/* A phone: the days that have something, one under the other. */}
      <ul className="space-y-2 md:hidden">
        {days.length ? (
          days.map((d) => (
            <li key={dayKey(d)} className="flex gap-3">
              <span className={`w-12 shrink-0 text-xs font-medium ${dayKey(d) === n.a.today ? "text-indigo-700 dark:text-indigo-300" : "text-zinc-500"}`}>{d.toLocaleDateString(lang, { weekday: "short", day: "numeric" })}</span>
              <div className="min-w-0 flex-1 space-y-1">{(byDay.get(dayKey(d)) ?? []).map(entry)}</div>
            </li>
          ))
        ) : (
          <li className="text-sm text-zinc-500">{n.a.empty ?? t("Nothing this month.")}</li>
        )}
      </ul>
      <div className="hidden overflow-hidden rounded-xl border border-zinc-200 md:block dark:border-zinc-800">
        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">
          {weekdays.map((w) => (
            <div key={w} className="px-2 py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const k = dayKey(d);
            const list = byDay.get(k) ?? [];
            const out = d.getMonth() !== m - 1;
            return (
              <div key={k} className={`min-h-24 space-y-1 p-1.5 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} border-zinc-100 dark:border-zinc-800 ${out ? "bg-zinc-50/60 dark:bg-zinc-900/30" : ""}`}>
                <div className={`text-xs ${k === n.a.today ? "inline-flex size-5 items-center justify-center rounded-full bg-indigo-600 font-semibold text-white" : out ? "text-zinc-400" : "text-zinc-600 dark:text-zinc-400"}`}>{d.getDate()}</div>
                {list.slice(0, 3).map(entry)}
                {list.length > 3 && <div className="px-1 text-xs text-zinc-500">{t("+{n} more", { n: list.length - 3 })}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Heatmap({ a }: { a: Record<string, string> }) {
  const t = useT();
  const days = json<[string, number][]>(a.days, []);
  const max = Math.max(0, ...days.map((d) => d[1]));
  const total = days.reduce((s, d) => s + d[1], 0);
  const level = (v: number) => (v <= 0 || !max ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const shade = ["bg-zinc-100 dark:bg-zinc-800", "bg-indigo-200 dark:bg-indigo-900", "bg-indigo-400 dark:bg-indigo-700", "bg-indigo-600 dark:bg-indigo-500", "bg-indigo-800 dark:bg-indigo-300"];
  const weeks: [string, number][][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const lang = typeof navigator !== "undefined" ? navigator.language : "de-DE";
  const unit = a.unit ? ` ${a.unit}` : "";
  return (
    <figure className="inline-block max-w-full space-y-1.5 align-top">
      <figcaption className="flex items-baseline justify-between gap-6 text-xs text-zinc-500">
        <span>{a.label}</span>
        <span className="tabular-nums">
          {t("Total")}: {total.toLocaleString(lang)}
          {unit}
        </span>
      </figcaption>
      <div className="overflow-x-auto">
        <div className="flex w-max gap-[3px]" role="img" aria-label={`${a.label ?? ""} ${t("Total")}: ${total}${unit}`}>
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {w.map(([d, v]) => (
                <span key={d} className={`size-[11px] rounded-[2px] ${shade[level(v)]}`} title={`${new Date(`${d}T12:00`).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" })}: ${v.toLocaleString(lang)}${unit}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}

function Pivot({ a }: { a: Record<string, string> }) {
  const t = useT();
  const d = json<{ rows: string[]; cols: string[]; cells: string[][]; rowTotals: string[]; colTotals: string[]; total: string }>(a.data, { rows: [], cols: [], cells: [], rowTotals: [], colTotals: [], total: "" });
  if (!d.rows.length) return a.empty ? <p className="text-sm text-zinc-500">{a.empty}</p> : null;
  const total = a.total === "true";
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900/50">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium" />
            {d.cols.map((c) => (
              <th key={c} className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
            {total && <th className="px-3 py-1.5 text-right font-semibold">{t("Total")}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {d.rows.map((r, i) => (
            <tr key={r}>
              <th className="px-3 py-1.5 text-left font-medium">{r}</th>
              {d.cols.map((c, j) => (
                <td key={c} className={`px-3 py-1.5 text-right whitespace-nowrap tabular-nums ${d.cells[i]?.[j] ? "" : "text-zinc-400"}`}>
                  {d.cells[i]?.[j] || "–"}
                </td>
              ))}
              {total && <td className="px-3 py-1.5 text-right font-semibold whitespace-nowrap tabular-nums">{d.rowTotals[i]}</td>}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot className="border-t border-zinc-200 bg-zinc-50 font-semibold dark:border-zinc-800 dark:bg-zinc-900/50">
            <tr>
              <th className="px-3 py-1.5 text-left">{t("Total")}</th>
              {d.colTotals.map((x, j) => (
                <td key={j} className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {x}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">{d.total}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Gauge({ a }: { a: Record<string, string> }) {
  const value = Number(a.value) || 0;
  const max = Number(a.max) || 100;
  const pct = Math.max(0, Math.min(1, value / max));
  const size = Math.max(48, Math.min(240, Number(a.size) || 96));
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <figure className="inline-flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${a.label ?? ""} ${Math.round(pct * 100)} %`}>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-zinc-200 dark:stroke-zinc-800" />
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" strokeLinecap="round" stroke="currentColor" className={TONE_STROKE[a.tone ?? "info"] ?? TONE_STROKE.info} strokeDasharray={`${pct * c} ${c}`} transform="rotate(-90 50 50)" />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="fill-zinc-900 text-[20px] font-semibold dark:fill-zinc-100">
          {Math.round(pct * 100)}%
        </text>
      </svg>
      {a.label && <figcaption className="text-center text-sm font-medium">{a.label}</figcaption>}
      {a.sub && <span className="text-center text-xs text-zinc-500">{a.sub}</span>}
    </figure>
  );
}

function Rating({ a, env }: { a: Record<string, string>; env: BlockEnv }) {
  const t = useT();
  const max = Number(a.max) || 5;
  const value = Math.round(Number(a.value) || 0);
  const edit = !!(a.row && a.prop && env.props.ctx);
  const set = (n: number) => env.props.ctx?.set(Number(a.row), a.prop, n === value ? 0 : n);
  return (
    <span className="inline-flex items-center gap-0.5" role={edit ? "radiogroup" : "img"} aria-label={t("{n} of {max}", { n: value, max })} onClick={(e) => edit && e.stopPropagation()}>
      {Array.from({ length: max }, (_, i) =>
        edit ? (
          <button key={i} type="button" role="radio" aria-checked={value === i + 1} aria-label={String(i + 1)} className={`text-base leading-none ${i < value ? "text-amber-500" : "text-zinc-300 hover:text-amber-300 dark:text-zinc-600"}`} onClick={() => set(i + 1)}>
            ★
          </button>
        ) : (
          <span key={i} aria-hidden className={`text-base leading-none ${i < value ? "text-amber-500" : "text-zinc-300 dark:text-zinc-600"}`}>
            ★
          </span>
        ),
      )}
    </span>
  );
}

function CopyButton({ a }: { a: Record<string, string> }) {
  const t = useT();
  return (
    <button
      type="button"
      className="btn btn-sm print:hidden"
      title={a.text}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(a.text ?? "").then(
          () => toast(t("Copied."), { tone: "ok" }),
          () => toast(t("Couldn't copy."), { tone: "error" }),
        );
      }}
    >
      {a.label || t("Copy")}
    </button>
  );
}
