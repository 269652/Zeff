"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { formatNumber, type Labels, type Property, type Row } from "../model";
import type { ViewAppMeta } from "../view-apps";
import { renderView, viewDefaults, type VNode } from "../view-template";
import type { AppViewProps, ViewAppModule } from "./app-view";
import { draw, Level, type DrawExt } from "./card-template";
import { Cell } from "./cells";
import { WidgetBlock } from "./widget-node";

/**
 * A view drawn from its template (view-template.ts): the nodes as this page's own components — tiles, tabs, lists, a table of cells,
 * charts, buttons that act on the rows, the app's parts and the plugins' widgets. The view's state (tabs, search, the row picked) lives
 * here; what the app loads (app.*) comes from its hook.
 */

type Props = AppViewProps & { src: string; onErrors?: (errors: { line: number; message: string }[]) => void; module: ViewAppModule; meta: ViewAppMeta };

const TONE: Record<string, string> = { good: "text-emerald-700 dark:text-emerald-400", warn: "text-amber-700 dark:text-amber-400", bad: "text-red-600 dark:text-red-400", muted: "text-zinc-500" };
const BOX_TONE: Record<string, string> = { muted: "bg-zinc-50 dark:bg-zinc-900/40", good: "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20", warn: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20", bad: "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20" };
const json = <T,>(s: string | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function TemplateView({ src, onErrors, module, meta, ...props }: Props) {
  const t = useT();
  const router = useRouter();
  const schema = props.data.schema;
  const defaults = useMemo(() => viewDefaults(src), [src]);
  const [own, setOwn] = useState<Record<string, string>>({});
  const state = useMemo(() => ({ ...defaults, ...own }), [defaults, own]);
  const setState = (name: string, value: string) => setOwn((s) => ({ ...s, [name]: value }));
  const app = module.useAppData(props, state);
  const labels: Labels = useMemo(() => ({ person: (id) => props.data.labels.people[id] ?? `#${id}`, page: (id) => props.data.labels.pages[id]?.title ?? `#${id}`, todo: (id) => props.data.labels.todos[id] ?? `T-${id}` }), [props.data.labels]);
  const r = useMemo(
    () => renderView(src, { rows: props.rows, props: schema.properties, titleName: schema.titleName, state, app: app.data, db: { id: props.data.id, title: props.data.title }, labels, locale: typeof navigator !== "undefined" ? navigator.language : "de-DE" }, { parts: meta.parts, actions: meta.actions }),
    [src, props.rows, schema, state, app.data, props.data.id, props.data.title, labels, meta],
  );
  const errKey = JSON.stringify(r.errors);
  useEffect(() => onErrors?.(JSON.parse(errKey)), [errKey, onErrors]);

  const byId = useMemo(() => new Map(props.rows.map((x) => [x.id, x])), [props.rows]);
  const propOf = (id: string): Property | undefined => schema.properties.find((p) => p.id === id);

  /** What a button does. */
  const run = async (a: Record<string, string>) => {
    if (a.confirm && !window.confirm(a.confirm)) return;
    const rowId = a.row ? Number(a.row) : null;
    const row = rowId ? byId.get(rowId) : undefined;
    const valueFor = (p: Property | undefined, v: string | undefined): unknown => {
      if (v === undefined) return null;
      if (!p) return v;
      if (p.type === "number") return v === "" ? null : Number(v);
      if (p.type === "checkbox") return v === "true";
      if (p.type === "multi_select" || p.type === "person" || p.type === "relation") return json(v, v ? [v] : []);
      return v;
    };
    try {
      switch (a.action) {
        case "new": {
          const id = await props.rowOps?.add(json<Record<string, unknown>>(a.values, {}));
          if (id) props.openRow(id);
          return;
        }
        case "open":
          return void (rowId && props.openRow(rowId));
        case "set":
          return void (rowId && a.prop && props.ctx?.set(rowId, a.prop, valueFor(propOf(a.prop), a.value)));
        case "toggle":
          return void (row && a.prop && props.ctx?.set(row.id, a.prop, row.cells[a.prop] !== true));
        case "delete":
          return void (rowId && (await props.rowOps?.remove(rowId)));
        case "duplicate":
          return void (rowId && (await props.rowOps?.duplicate(rowId)));
        case "hide":
          return void (rowId && props.rowOps?.hide(rowId));
        case "state":
          return void (a.state && setState(a.state, a.value ?? ""));
        case "select":
          return void (rowId && setState("selected", String(rowId)));
        case "url":
          return void (a.href && (a.href.startsWith("/") ? router.push(a.href) : window.open(a.href, "_blank", "noopener")));
        case "print":
          return window.print();
        case "reload":
          props.reload();
          return app.reload();
        default: {
          const fn = module.actions?.[a.action];
          if (fn) fn({ props, state, setState, app: app.data, reloadApp: app.reload, rowId, attrs: a });
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: "error" });
    }
  };

  const cols = (a: Record<string, string>): CSSProperties => {
    const n = Math.max(1, Math.min(8, Number(a.cols) || 3));
    const gap = (Number(a.gap) || 3) * 4;
    const min = Number(a.min) || 180;
    return { gap, gridTemplateColumns: `repeat(auto-fit, minmax(max(min(100%, ${min}px), calc((100% - ${(n - 1) * gap}px) / ${n})), 1fr))` };
  };

  const ext: DrawExt = (n, key, kids) => {
    const a = n.a;
    switch (n.t) {
      case "grid":
        return (
          <div key={key} className="grid" style={cols(a)}>
            {n.c.map((c, i) => (
              <div key={i} className="min-w-0">
                {draw(c, i, ext)}
              </div>
            ))}
          </div>
        );
      case "section":
        return a.collapsible === "true" ? (
          <details key={key} open={a.open !== "false"} className="group space-y-2">
            <summary className="cursor-pointer text-sm font-semibold select-none">{a.title}</summary>
            <div className="space-y-3 pt-2">{kids(n.c)}</div>
          </details>
        ) : (
          <section key={key} className="space-y-2 break-inside-avoid">
            {a.title && <h2 className="text-sm font-semibold">{a.title}</h2>}
            <div className="space-y-3">{kids(n.c)}</div>
          </section>
        );
      case "box":
        return (
          <div key={key} className={`space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 ${BOX_TONE[a.tone ?? ""] ?? ""}`}>
            {a.title && <h3 className="text-sm font-semibold">{a.title}</h3>}
            {kids(n.c)}
          </div>
        );
      case "heading": {
        const cls = a.level === "1" ? "text-2xl font-semibold" : a.level === "3" ? "text-sm font-semibold" : "text-lg font-semibold";
        return (
          <div key={key} role="heading" aria-level={Number(a.level) || 2} className={cls}>
            {kids(n.c)}
          </div>
        );
      }
      case "text":
        return (
          <div key={key} className={`text-sm ${TONE[a.tone ?? ""] ?? ""}`}>
            {kids(n.c)}
          </div>
        );
      case "tile":
        return (
          <div key={key} className="h-full rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="text-xs font-medium text-zinc-500">{a.label}</div>
            <div className={`mt-0.5 text-xl font-semibold tracking-tight tabular-nums ${TONE[a.tone ?? ""] ?? ""}`}>{a.value || "—"}</div>
            {a.sub && <div className="mt-0.5 text-xs text-zinc-500">{a.sub}</div>}
          </div>
        );
      case "tabs": {
        const opts = json<[string, string][]>(a.options, []);
        return (
          <div key={key} className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 print:hidden dark:bg-zinc-800/70" role="tablist">
            {opts.map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={a.current === v} className={`rounded-md px-3 py-1 text-sm font-medium transition ${a.current === v ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`} onClick={() => setState(a.bind, v)}>
                {label}
              </button>
            ))}
          </div>
        );
      }
      case "select": {
        const opts = json<[string, string][]>(a.options, []);
        return (
          <label key={key} className="inline-flex items-center gap-1.5 text-sm print:hidden">
            {a.label && <span className="text-xs text-zinc-500">{a.label}</span>}
            <select className="input w-auto py-1 text-sm" value={a.current} onChange={(e) => setState(a.bind, e.target.value)}>
              {opts.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        );
      }
      case "search":
        return <input key={key} type="search" className="input w-44 py-1 text-sm print:hidden" placeholder={a.placeholder ?? t("Search …")} aria-label={a.placeholder ?? t("Search")} value={a.current} onChange={(e) => setState(a.bind, e.target.value)} />;
      case "toggle":
        return (
          <label key={key} className="inline-flex items-center gap-1.5 text-sm print:hidden">
            <input type="checkbox" className="accent-indigo-600" checked={a.current === "true"} onChange={(e) => setState(a.bind, e.target.checked ? "true" : "")} />
            {a.label}
          </label>
        );
      case "list":
      case "cards": {
        const items = n.c.filter((c): c is Extract<VNode, object> => typeof c !== "string");
        if (!items.length) return a.empty ? <p key={key} className="text-sm text-zinc-500">{a.empty}</p> : null;
        const active = (it: Extract<VNode, object>) => it.a.row && it.a.row === state.selected;
        const click = (it: Extract<VNode, object>) => (it.a.row ? () => (a.select === "true" ? setState("selected", it.a.row) : a.open === "true" ? props.openRow(Number(it.a.row)) : undefined) : undefined);
        const clickable = a.select === "true" || a.open === "true";
        if (n.t === "cards")
          return (
            <div key={key} className="grid" style={cols({ cols: a.cols ?? "3", min: "200" })}>
              {items.map((it, i) => (
                <div key={it.a.row ?? i} className={`min-w-0 rounded-xl border p-3 text-sm ${active(it) ? "border-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-900" : "border-zinc-200 dark:border-zinc-800"} ${clickable ? "cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700" : ""}`} onClick={click(it)}>
                  <div className="flex flex-col gap-1">{kids(it.c)}</div>
                </div>
              ))}
            </div>
          );
        return (
          <ul key={key} className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {items.map((it, i) => (
              <li key={it.a.row ?? i} className={`px-3 py-2 text-sm ${active(it) ? "bg-indigo-50/70 dark:bg-indigo-950/40" : ""} ${clickable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50" : ""}`} onClick={click(it)}>
                <div className="flex flex-col gap-1">{kids(it.c)}</div>
              </li>
            ))}
          </ul>
        );
      }
      case "table":
        return <RowsTable key={key} columns={json<string[]>(a.columns, [])} rows={json<number[]>(a.rows, []).map((id) => byId.get(id)).filter((x): x is Row => !!x)} sum={a.sum} empty={a.empty} props={props} />;
      case "chart":
        return <MiniChart key={key} kind={a.kind} data={json<{ label: string; value: number; color?: string }[]>(a.data, [])} />;
      case "selected":
        return (
          <div key={key} className="space-y-2">
            {kids(n.c)}
          </div>
        );
      case "button": {
        const variant = a.variant === "primary" ? "btn btn-primary btn-sm" : a.variant === "danger" ? "btn btn-sm btn-danger" : a.variant === "quiet" ? "rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800" : "btn btn-sm";
        return (
          <button key={key} type="button" className={`${variant} print:hidden`} onClick={(e) => (e.stopPropagation(), void run(a))}>
            {a.label ?? a.action}
          </button>
        );
      }
      case "field": {
        const row = byId.get(Number(a.row));
        const p = propOf(a.prop);
        if (!row || !p || !props.ctx) return null;
        return (
          <span key={key} className="inline-flex min-w-24 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-zinc-500">{p.name}</span>
            <Cell p={p} row={row} ctx={props.ctx} className="rounded-md" />
          </span>
        );
      }
      case "part": {
        const { name, row: rowAttr, ...attrs } = a;
        const Part = module.parts[name];
        if (!Part) return null;
        return <Part key={key} {...props} attrs={attrs} state={state} setState={setState} app={app.data} reloadApp={app.reload} rowId={rowAttr ? Number(rowAttr) : null}>{n.c.length ? kids(n.c) : undefined}</Part>;
      }
      case "widget": {
        const { id, title, ...config } = a;
        const conf = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v]));
        return <WidgetBlock key={key} id={id} config={conf} title={title} />;
      }
      default:
        return undefined;
    }
  };

  return (
    <div className="space-y-5" data-print-root>
      <Level nodes={r.nodes} ext={ext} />
    </div>
  );
}

/** The rows as a table: the columns named (their cells editable), the title opens a row, a sum under one column. */
function RowsTable({ columns, rows, sum, empty, props }: { columns: string[]; rows: Row[]; sum?: string; empty?: string; props: AppViewProps }) {
  const t = useT();
  const schema = props.data.schema;
  const cols = columns.map((id) => (id === "title" ? null : (schema.properties.find((p) => p.id === id) ?? null)));
  if (!rows.length) return <p className="text-sm text-zinc-500">{empty ?? t("No rows.")}</p>;
  const sumProp = sum ? schema.properties.find((p) => p.id === sum) : undefined;
  const total = sumProp ? rows.reduce((n, r) => n + (Number(r.cells[sumProp.id]) || 0), 0) : 0;
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900/60">
            {cols.map((p, i) => (
              <th key={p?.id ?? `t${i}`} className={`px-3 py-2 ${p?.type === "number" ? "text-right" : ""}`}>
                {p ? p.name : schema.titleName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40">
              {cols.map((p, i) =>
                p ? (
                  <td key={p.id} className={p.type === "number" ? "text-right tabular-nums" : ""}>
                    {props.ctx ? <Cell p={p} row={r} ctx={props.ctx} /> : null}
                  </td>
                ) : (
                  <td key={`t${i}`} className="px-3 py-2">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => props.openRow(r.id)}>
                      {r.icon ? `${r.icon} ` : ""}
                      {r.title || t("Untitled")}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {sumProp && (
          <tfoot>
            <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold dark:border-zinc-800 dark:bg-zinc-900/60">
              {cols.map((p, i) => (
                <td key={p?.id ?? `t${i}`} className={`px-3 py-2 ${p?.type === "number" ? "text-right tabular-nums" : ""}`}>
                  {p?.id === sumProp.id ? formatNumber(sumProp, total) : i === 0 ? t("Total") : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const CHART_COLORS: Record<string, string> = { gray: "#a1a1aa", brown: "#a16207", orange: "#f97316", yellow: "#eab308", green: "#22c55e", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899", red: "#ef4444" };
const PALETTE = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7", "#ec4899", "#84cc16"];

/** A small chart of a template's data: bars, columns, a line or a pie. */
function MiniChart({ kind = "bar", data }: { kind?: string; data: { label: string; value: number; color?: string }[] }) {
  if (!data.length) return null;
  const colorOf = (d: { color?: string }, i: number) => (d.color ? (CHART_COLORS[d.color] ?? PALETTE[i % PALETTE.length]) : PALETTE[i % PALETTE.length]);
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (kind === "pie") {
    const total = data.reduce((n, d) => n + Math.max(0, d.value), 0) || 1;
    const upTo = (i: number) => data.slice(0, i).reduce((n, d) => n + Math.max(0, d.value), 0);
    const stops = data.map((d, i) => `${colorOf(d, i)} ${(upTo(i) / total) * 360}deg ${(upTo(i + 1) / total) * 360}deg`);
    return (
      <div className="flex flex-wrap items-center gap-4">
        <div className="size-32 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops.join(", ")})` }} aria-hidden />
        <ul className="space-y-1 text-xs">
          {data.map((d, i) => (
            <li key={d.label} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: colorOf(d, i) }} />
              {d.label} <span className="text-zinc-500 tabular-nums">{fmt(d.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (kind === "column" || kind === "line") {
    const w = 100 / data.length;
    return (
      <div>
        <svg viewBox="0 0 100 50" className="h-40 w-full" preserveAspectRatio="none" aria-hidden>
          {kind === "column" ? data.map((d, i) => <rect key={d.label} x={i * w + w * 0.15} width={w * 0.7} y={50 - (d.value / max) * 48} height={(d.value / max) * 48} fill={colorOf(d, i)} rx={0.6} />) : <polyline fill="none" stroke="#6366f1" strokeWidth={0.8} vectorEffect="non-scaling-stroke" points={data.map((d, i) => `${i * w + w / 2},${50 - (d.value / max) * 48}`).join(" ")} />}
        </svg>
        <div className="flex text-[10px] text-zinc-500">
          {data.map((d) => (
            <span key={d.label} className="flex-1 truncate text-center" title={`${d.label}: ${fmt(d.value)}`}>
              {d.label}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <ul className="space-y-1.5 text-xs">
      {data.map((d, i) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2">
          <span className="truncate">{d.label}</span>
          <span className="h-2.5 rounded-sm" style={{ width: `${Math.max(1, (d.value / max) * 100)}%`, background: colorOf(d, i) }} />
          <span className="text-zinc-500 tabular-nums">{fmt(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}
