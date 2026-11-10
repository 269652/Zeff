"use client";

import { confirmAction } from "@/components/confirm";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { formatNumber, type Labels, type Property, type Row } from "../model";
import type { ViewAppMeta } from "../view-apps";
import { navOf, renderView, viewDefaults, type ViewNavEntry, type VNode } from "../view-template";
import type { ActionEnv, AppViewProps, ViewAppModule } from "./app-view";
import { draw, Level, type DrawExt } from "./card-template";
import { ChannelLogo } from "@/components/ChannelLogo";
import { toggleTaskAction } from "../actions";
import { askWorkspace } from "./chat-client";
import { WS_CHANGED } from "./ChatPanel";
import { TodoMark } from "./todo-mark";
import { Cell } from "./cells";
import { EmptyState, Sparkline, viewBlock } from "./view-blocks";
import { LookupField } from "./view-lookup";
import { AskBox, DossierBox } from "./view-notebook";
import { FlowData, runFlowButton, transitionButton, TransitionsBlock } from "./view-flows";
import { WidgetBlock } from "./widget-node";
import { useBlockDefs } from "./use-blocks";
import { useWidgetOutputs } from "./use-outputs";

/**
 * A view drawn from its template (view-template.ts): the nodes as this page's own components — tiles, tabs, lists, a table of cells,
 * charts, buttons that act on the rows, the app's parts and the plugins' widgets. The view's state (tabs, search, the row picked) lives
 * here; what the app loads (app.*) comes from its hook.
 */

type Props = AppViewProps & { src: string; onErrors?: (errors: { line: number; message: string }[]) => void; module: ViewAppModule; meta: ViewAppMeta; /** A row's own page: the row it is. */ current?: Row };

const TONE: Record<string, string> = { good: "text-emerald-700 dark:text-emerald-400", warn: "text-amber-700 dark:text-amber-400", bad: "text-red-600 dark:text-red-400", muted: "text-zinc-500" };
const BOX_TONE: Record<string, string> = { muted: "bg-zinc-50 dark:bg-zinc-900/40", good: "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20", warn: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20", bad: "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20" };
const json = <T,>(s: string | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function TemplateView({ src, onErrors, module, meta, current, ...props }: Props) {
  const t = useT();
  const router = useRouter();
  const schema = props.data.schema;
  const defaults = useMemo(() => viewDefaults(src), [src]);
  const [own, setOwn] = useState<Record<string, string>>({});
  // In the tree, the entry picked there (?nav=state=value) is the view's state — read with it, not set after it is drawn.
  const asked = useSearchParams().get("nav");
  const inTree = props.view.nav === "workspace";
  const fromTree = useMemo((): Record<string, string> => {
    const i = asked?.indexOf("=") ?? -1;
    return inTree && asked && i > 0 ? { [asked.slice(0, i)]: asked.slice(i + 1) } : {};
  }, [inTree, asked]);
  const state = useMemo(() => ({ ...defaults, ...own, ...fromTree }), [defaults, own, fromTree]);
  const setState = useCallback((name: string, value: string) => setOwn((s) => ({ ...s, [name]: value })), []);
  const app = module.useAppData(props, state);
  const blocks = useBlockDefs();
  const outputs = useWidgetOutputs();
  // What flows gave (a <data>'s output, a button's into=): data.<name>.
  const [flowData, setFlowData] = useState<Record<string, unknown>>({});
  const setData = useCallback((_name: string, patch: Record<string, unknown>) => setFlowData((d) => ({ ...d, ...patch })), []);
  const labels: Labels = useMemo(() => ({ person: (id) => props.data.labels.people[id] ?? `#${id}`, page: (id) => props.data.labels.pages[id]?.title ?? `#${id}`, todo: (id) => props.data.labels.todos[id] ?? `T-${id}` }), [props.data.labels]);
  // What the rows' pages say (their first lines — a task ticked or not, a list's bullet): `text` in a row.
  const previews = props.data.extras?.previews;
  const texts = useMemo(() => Object.fromEntries(Object.entries(previews ?? {}).map(([id, lines]) => [id, lines.map((l) => (l.kind === "task" ? `${l.checked ? "☑" : "☐"} ${l.text}` : l.text)).join("\n")])), [previews]);
  const r = useMemo(
    () => renderView(src, { rows: props.rows, props: schema.properties, titleName: schema.titleName, state, app: app.data, data: flowData, db: { id: props.data.id, title: props.data.title }, labels, locale: typeof navigator !== "undefined" ? navigator.language : "de-DE", current, texts, outputs }, { parts: meta.parts, actions: meta.actions, blocks }),
    [src, props.rows, schema, state, app.data, flowData, props.data.id, props.data.title, labels, meta, current, texts, blocks, outputs],
  );
  // Its sidebar (a <nav>): beside the view — or, the view's setting, in the Workspace tree, whose entry picked (?nav=) sets the state.
  const nav = useMemo(() => navOf(r.nodes), [r.nodes]);
  const go = (e: ViewNavEntry) => (e.row ? props.openRow(e.row) : e.state ? setState(e.state, e.value ?? "") : e.href ? router.push(e.href) : undefined);

  // The toolbar's New, when the app takes it over: run with the view as it is at the click.
  const envRef = useRef<ActionEnv | null>(null);
  useEffect(() => {
    envRef.current = { props, state: r.state, setState, app: app.data, reloadApp: app.reload, rowId: null, attrs: {}, t };
  });
  const takeNew = props.onNew;
  const appNew = module.onNew;
  useEffect(() => {
    if (!takeNew || !appNew) return;
    takeNew(() => envRef.current && appNew(envRef.current));
    return () => takeNew(null);
  }, [takeNew, appNew]);
  const errKey = JSON.stringify(r.errors);
  useEffect(() => onErrors?.(JSON.parse(errKey)), [errKey, onErrors]);

  const byId = useMemo(() => new Map(props.rows.map((x) => [x.id, x])), [props.rows]);
  const propOf = (id: string): Property | undefined => schema.properties.find((p) => p.id === id);

  /** What a button does. */
  const run = async (a: Record<string, string>) => {
    if (a.confirm && !confirmAction(a.confirm)) return;
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
          return void (rowId && setState(a.selkey || "selected", String(rowId)));
        case "url":
          // Zeff's own pages in place, a mail written in the mail program, anything else in a new tab.
          return void (a.href && (a.href.startsWith("/") ? router.push(a.href) : a.href.startsWith("mailto:") ? (window.location.href = a.href) : window.open(a.href, "_blank", "noopener")));
        case "assistant": {
          if (!a.request?.trim()) return;
          toast(t("The assistant is on it …"), { ms: 5000 });
          const r = await askWorkspace([{ role: "user", text: a.request }], props.data.id);
          props.reload();
          app.reload();
          return toast(r.ok ? r.reply || t("Done.") : r.error, { tone: r.ok ? "ok" : "error" });
        }
        case "run":
          return await runFlowButton(a, { row: rowId, setData, setState, reload: () => (props.reload(), app.reload()), t });
        case "transition":
          return await transitionButton(a, { row: rowId, reload: () => (props.reload(), app.reload()), t });
        case "print":
          return window.print();
        case "reload":
          props.reload();
          return app.reload();
        default: {
          const fn = module.actions?.[a.action];
          if (fn) fn({ props, state, setState, app: app.data, reloadApp: app.reload, rowId, attrs: a, t });
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
      case "row":
      case "col": {
        // (A column of a fixed width — what follows it starts at the same place in every row; align=end puts its content at the
        // right edge, so a shorter one leaves room on its left.)
        if (n.t === "col" && Number(a.width) > 0) {
          const inner = draw({ ...n, a: { ...a, width: "" } }, key, ext);
          return (
            <div key={key} className="min-w-0 shrink-0" style={{ width: Math.min(800, Number(a.width)) }} title={a.tip || undefined}>
              {inner}
            </div>
          );
        }
        if (a.fill !== "true" && !a.tip && !a.max) return undefined;
        // (Taking the room left — and letting what is in it be cut to one line; max=70ch: not wider than that.)
        const inner = draw({ ...n, a: { ...a, fill: "", tip: "", max: "" } }, key, ext);
        const max = /^\d+(?:\.\d+)?(?:ch|px|rem|%)$/.test(a.max ?? "") ? a.max : undefined;
        return (
          <div key={key} className={a.fill === "true" ? "min-w-0 flex-1" : ""} style={max ? { maxWidth: max } : undefined} title={a.tip || undefined}>
            {inner}
          </div>
        );
      }
      case "truncate":
        return (
          <span key={key} className="block min-w-0 truncate" title={a.tip || undefined}>
            {kids(n.c)}
          </span>
        );
      case "strike":
        return (
          <s key={key} className="text-zinc-400">
            {kids(n.c)}
          </s>
        );
      case "mono":
        return (
          <span key={key} className="font-mono text-xs" title={a.tip || undefined}>
            {kids(n.c)}
          </span>
        );
      case "b":
      case "small":
      case "muted":
        if (!a.tip) return undefined;
        return (
          <span key={key} title={a.tip}>
            {draw({ ...n, a: { ...a, tip: "" } }, key, ext)}
          </span>
        );
      case "split": {
        // Two side by side (on a phone one under the other): in a ratio, or a side column of a fixed width.
        const w = Number(a.width) || 0;
        const fr: Record<string, string> = { "1:1": "1fr 1fr", "1:2": "1fr 2fr", "2:1": "2fr 1fr", "2:3": "2fr 3fr", "3:2": "3fr 2fr", "1:3": "1fr 3fr", "3:1": "3fr 1fr" };
        const columns = w ? (a.side === "left" ? `${w}px minmax(0,1fr)` : `minmax(0,1fr) ${w}px`) : (fr[a.ratio ?? ""] ?? "1fr 2fr").replace(/(\d)fr/g, "minmax(0,$1fr)");
        return (
          <div key={key} className="ws-split" style={{ "--split": columns } as CSSProperties}>
            {n.c
              .filter((c) => typeof c !== "string" || c.trim())
              .map((c, i) => (
                <div key={i} className="min-w-0">
                  {draw(c, i, ext)}
                </div>
              ))}
          </div>
        );
      }
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
          <Fold key={key} title={a.title} open={a.open === "wide" ? "wide" : a.open !== "false"}>
            <div className="space-y-3 pt-2" style={scrolls(a)}>
              {kids(n.c)}
            </div>
          </Fold>
        ) : (
          <section key={key} className="space-y-2 break-inside-avoid">
            {(a.title || a.aside) && (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">{a.title}</h2>
                {a.aside && <span className="text-xs text-zinc-500">{a.aside}</span>}
              </div>
            )}
            <div className="space-y-3" style={scrolls(a)}>
              {kids(n.c)}
            </div>
          </section>
        );
      case "box":
        return (
          <div key={key} className={`space-y-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 ${BOX_TONE[a.tone ?? ""] ?? ""}`} style={scrolls(a)}>
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
          <div key={key} className={`text-sm ${a.pre === "true" ? "whitespace-pre-line" : ""} ${TONE[a.tone ?? ""] ?? ""}`} title={a.tip || undefined}>
            {kids(n.c)}
          </div>
        );
      case "todomark":
        return <TodoMark key={key} mark={props.data.extras?.todoMarks?.[Number(a.row)]} />;
      case "data":
        return <FlowData key={key} a={a} setData={setData} row={current?.id} />;
      case "transitions":
        return <TransitionsBlock key={key} row={Number(a.row)} history={a.history === "true"} reload={props.reload} />;
      case "task": {
        // A box of a row's checklist: the n-th task of its page, ticked there.
        const rowId = Number(a.row);
        const index = (previews?.[rowId] ?? []).filter((l) => l.kind === "task")[Number(a.n)]?.index;
        return <TaskBox key={key} rowId={rowId} index={index} checked={a.checked === "true"} label={a.label ?? ""} editable={!!props.ctx?.editable} done={() => props.reload()} />;
      }
      case "tile":
        return (
          <div key={key} className="h-full rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-xs dark:border-zinc-800 dark:bg-zinc-900" title={a.tip || undefined}>
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-500">
              <span className="truncate">{a.label}</span>
              {a.icon && <span aria-hidden>{a.icon}</span>}
            </div>
            {/* (A tile of content alone — a ring, a part — has no value line.) */}
            {(a.value !== undefined || a.spark || !n.c.length) && (
              <div className="mt-1 flex items-end justify-between gap-2">
                <div className={`text-2xl leading-7 font-semibold tracking-tight tabular-nums ${TONE[a.tone ?? ""] ?? ""}`}>{a.value || "—"}</div>
                {a.spark && <Sparkline values={json<number[]>(a.spark, [])} />}
              </div>
            )}
            {a.trend && <div className={`mt-0.5 text-xs font-medium tabular-nums ${a.trend.startsWith("-") || a.trend.startsWith("−") ? TONE.bad : TONE.good}`}>{a.trend}</div>}
            {(a.sub || n.c.length > 0) && (
              <div className="mt-0.5 text-xs text-zinc-500">
                {a.sub}
                {n.c.length > 0 && <span className="inline">{n.c.map((c, i) => draw(c, i, ext))}</span>}
              </div>
            )}
          </div>
        );
      case "dot":
        return <span key={key} className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: paint(a.color) }} aria-hidden />;
      case "bar": {
        if (!a.fill) return undefined;
        const value = Number(a.value) || 0;
        const max = Number(a.max) || 1;
        return (
          <span key={key} className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
            <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: paint(a.fill) }} />
          </span>
        );
      }
      case "printonly":
        return (
          <div key={key} className="hidden print:block">
            {kids(n.c)}
          </div>
        );
      case "noprint":
        return (
          <div key={key} className="print:hidden">
            {kids(n.c)}
          </div>
        );
      case "datatable": {
        const cols = json<{ label: string; align?: string; foot?: string; nowrap?: string; width?: string }[]>(a.cols, []);
        const rows = n.c.filter((c): c is Extract<VNode, object> => typeof c !== "string");
        const align = (c: { align?: string }) => (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left");
        if (!rows.length) return a.empty ? <p key={key} className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-sm text-zinc-400 dark:border-zinc-800">{a.empty}</p> : null;
        return (
          // (On a phone each row a card — its first column the head, the others "label … value" — see .ws-datatable.)
          <div key={key} className="overflow-x-auto rounded-xl border border-zinc-200 max-sm:overflow-visible max-sm:border-0 dark:border-zinc-800 print:overflow-visible print:rounded-none print:border-0">
            <table className="ws-datatable w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900/60">
                  {cols.map((c, i) => (
                    <th key={i} className={`px-3 py-2 ${align(c)} ${c.nowrap === "true" ? "whitespace-nowrap" : ""}`} style={c.width ? { width: Number(c.width) } : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((tr, ri) => (
                  <tr key={tr.a.row ?? ri} className="group align-top transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40">
                    {tr.c.map((td, ci) => (
                      <td key={ci} data-label={cols[ci]?.label || undefined} className={`px-3 py-3 ${align(cols[ci] ?? {})} ${cols[ci]?.nowrap === "true" ? "whitespace-nowrap" : ""}`}>
                        {typeof td === "string" ? td : <div className={`flex flex-col gap-0.5 ${cols[ci]?.align === "right" ? "items-end" : ""}`}><Level nodes={td.c} ext={ext} /></div>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {cols.some((c) => c.foot) && (
                <tfoot>
                  <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold dark:border-zinc-800 dark:bg-zinc-900/60">
                    {cols.map((c, i) => (
                      <td key={i} data-label={i > 0 && c.foot ? c.label || undefined : undefined} className={`px-3 py-2.5 whitespace-nowrap tabular-nums ${align(c)} ${c.foot ? "" : "max-sm:hidden"}`}>
                        {c.foot}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        );
      }
      case "tabs": {
        const opts = json<[string, string, string?][]>(a.options, []);
        return (
          <div key={key} className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 print:hidden dark:bg-zinc-800/70" role="tablist">
            {opts.map(([v, label, count]) => {
              // A label "logo-<channel> Name": the channel's mark alone, its name the tab's tooltip and accessible name.
              const logo = /^logo-(\S+)\s+(.*)$/.exec(label);
              return (
              <button key={v} type="button" role="tab" aria-selected={a.current === v} aria-label={logo ? `${logo[2]}${count ? ` (${count})` : ""}` : undefined} title={logo?.[2]} className={`inline-flex items-center rounded-md px-3 py-1 text-sm font-medium transition ${a.current === v ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`} onClick={() => setState(a.bind, v)}>
                {logo ? <ChannelLogo name={logo[1]} className="size-[18px]" /> : label}
                {count !== undefined && <span className="ml-1 text-xs font-normal text-zinc-400 tabular-nums">{count}</span>}
              </button>
              );
            })}
          </div>
        );
      }
      case "select": {
        const opts = json<[string, string, string?][]>(a.options, []);
        if (a.search === "true") return <SearchSelect key={key} options={opts} value={a.current ?? ""} label={a.label} onPick={(v) => setState(a.bind, v)} />;
        return (
          <label key={key} className="inline-flex items-center gap-1.5 text-sm print:hidden">
            {a.label && <span className="text-xs text-zinc-500">{a.label}</span>}
            <select className="input w-auto py-1 text-sm" value={a.current} onChange={(e) => setState(a.bind, e.target.value)}>
              {opts.map(([v, label, count]) => (
                <option key={v} value={v}>
                  {label}
                  {count !== undefined ? ` (${count})` : ""}
                </option>
              ))}
            </select>
          </label>
        );
      }
      case "search":
        return <input key={key} type="search" className="input w-44 py-1 text-sm print:hidden" placeholder={a.placeholder ?? t("Search …")} aria-label={a.placeholder ?? t("Search")} value={a.current} onChange={(e) => setState(a.bind, e.target.value)} />;
      case "ask":
        return <AskBox key={key} a={a} dbId={props.data.id} openRow={props.openRow} />;
      case "dossier":
        return <DossierBox key={key} a={a} dbId={props.data.id} rowsKey={props.rows.map((x) => `${x.id}:${x.updatedAt}`).join()} />;
      case "logo":
        return <ChannelLogo key={key} name={a.name ?? ""} className={a.size === "lg" ? "size-5" : "size-4"} />;
      case "lookup":
        return <LookupField key={key} a={a} dbId={props.data.id} reload={props.reload} openRow={props.openRow} />;
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
        if (!items.length) return a.empty ? <EmptyState key={key} text={a.empty} /> : null;
        const selkey = a.selkey || "selected";
        const active = (it: Extract<VNode, object>) => it.a.row && it.a.row === r.state[selkey];
        const click = (it: Extract<VNode, object>) => (it.a.row ? () => (a.select === "true" ? setState(selkey, it.a.row) : a.open === "true" ? props.openRow(Number(it.a.row)) : undefined) : undefined);
        const clickable = a.select === "true" || a.open === "true";
        if (n.t === "cards")
          return (
            <div key={key} className="grid" style={cols({ cols: a.cols ?? "3", min: "200" })}>
              {items.map((it, i) => (
                <div key={it.a.row ?? i} className={`min-w-0 rounded-xl border bg-white p-3 text-sm shadow-xs transition dark:bg-zinc-900 ${active(it) ? "border-indigo-400 ring-2 ring-indigo-200 dark:ring-indigo-900" : "border-zinc-200 dark:border-zinc-800"} ${clickable ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : ""}`} onClick={click(it)}>
                  <div className="flex flex-col gap-1">{kids(it.c)}</div>
                </div>
              ))}
            </div>
          );
        // grid="max-content minmax(0,70ch) 1fr max-content": the rows share one grid — each column as wide as its widest
        // cell in any row; an item's one <row> gives its parts as the cells.
        const template = /^[\w\s().,%-]+$/.test(a.grid ?? "") ? a.grid : "";
        if (template)
          return (
            // (On a phone one column: the cells of a row one under the other.)
            <ul key={key} className="ws-list-grid grid divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" style={{ "--cols": template } as CSSProperties}>
              {items.map((it, i) => {
                const parts = it.c.filter((c) => typeof c !== "string" || c.trim());
                const one = parts.length === 1 && typeof parts[0] !== "string" && parts[0].t === "row" ? parts[0] : null;
                const cells = one ? one.c.filter((c) => typeof c !== "string" || c.trim()) : parts;
                return (
                  <li
                    key={it.a.row ?? i}
                    className={`col-span-full grid items-start ${a.spacing === "roomy" ? "px-4 py-3" : "px-3 py-2"} text-sm ${active(it) ? "bg-indigo-50/70 dark:bg-indigo-950/40" : ""} ${clickable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50" : ""}`}
                    style={{ gridTemplateColumns: "subgrid", columnGap: one ? (Number(one.a.gap) || 3) * 4 : 12, rowGap: 6 }}
                    onClick={click(it)}
                  >
                    {kids(cells)}
                  </li>
                );
              })}
            </ul>
          );
        return (
          <ul key={key} className="ws-list divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {items.map((it, i) => (
              <li key={it.a.row ?? i} className={`${a.spacing === "roomy" ? "px-4 py-3" : "px-3 py-2"} text-sm ${active(it) ? "bg-indigo-50/70 dark:bg-indigo-950/40" : ""} ${clickable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50" : ""}`} onClick={click(it)}>
                <div className={`flex flex-col ${a.spacing === "roomy" ? "gap-2" : "gap-1"}`}>{kids(it.c)}</div>
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
        // A label that is only a sign (‹ ›): its tip is the button's name, and it is wide enough to hit (24 px).
        const sign = !!a.label && !/\p{L}/u.test(a.label);
        const variant = a.variant === "link" ? "truncate text-left font-medium hover:underline" : a.variant === "primary" ? "btn btn-primary btn-sm" : a.variant === "danger" ? "btn btn-sm btn-danger" : a.variant === "quiet" ? "rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800" : "btn btn-sm";
        return (
          <button
            key={key}
            type="button"
            disabled={a.disabled === "true"}
            title={a.tip || (a.keys ? `${a.label ?? a.action} (${a.keys})` : undefined)}
            aria-keyshortcuts={a.keys || undefined}
            aria-label={sign && a.tip ? a.tip : undefined}
            className={`${variant} ${sign ? "min-w-7 justify-center" : ""} ${a.wide === "true" ? "w-full justify-center" : ""} ${a.print === "true" ? "" : "print:hidden"} ${a.action === "print" ? "max-sm:hidden" : ""}`}
            onClick={(e) => (e.stopPropagation(), void run(a))}
          >
            {a.icon && <span aria-hidden>{a.icon}</span>}
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
        return <Part key={key} {...props} attrs={attrs} state={r.state} setState={setState} app={app.data} reloadApp={app.reload} rowId={rowAttr ? Number(rowAttr) : null}>{n.c.length ? kids(n.c) : undefined}</Part>;
      }
      case "nav":
      case "entry":
        return null; // (drawn beside the view, below — or in the tree)
      case "widget": {
        const { id, title, ...config } = a;
        const conf = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v]));
        return <WidgetBlock key={key} id={id} config={conf} title={title} />;
      }
      default:
        return viewBlock(n, key, kids, { props, state: r.state, setState, run: (x) => void run(x) });
    }
  };

  if (nav && !inTree && props.view.nav !== "off")
    return (
      <div className="flex flex-col gap-5 md:flex-row md:items-start" data-print-root>
        <ViewNav title={nav.title} entries={nav.entries} active={(e) => (e.state ? (r.state[e.state] ?? "") === (e.value ?? "") : false)} onPick={go} />
        <div className="min-w-0 flex-1 space-y-5">
          <Level nodes={r.nodes} ext={ext} />
        </div>
      </div>
    );
  return (
    <div className="space-y-5" data-print-root>
      <Level nodes={r.nodes} ext={ext} />
    </div>
  );
}

/** A view's sidebar: its entries (under their headings), the one picked marked, a count on the right. */
function ViewNav({ title, entries, active, onPick }: { title: string; entries: ViewNavEntry[]; active: (e: ViewNavEntry) => boolean; onPick: (e: ViewNavEntry) => void }) {
  return (
    <nav className="w-full shrink-0 md:sticky md:top-2 md:w-56 print:hidden">
      {title && <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase">{title}</div>}
      <ul className="space-y-0.5">
        {entries.map((e, i) => {
          // A heading where a group starts.
          const heading = e.group && e.group !== entries.slice(0, i).findLast((x) => x.group)?.group ? e.group : "";
          const on = active(e);
          return (
            <li key={e.id}>
              {heading && <div className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{heading}</div>}
              <button type="button" onClick={() => onPick(e)} aria-current={on || undefined} className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${on ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
                {e.icon && <span className="shrink-0">{e.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                {e.n > 0 && <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{e.n}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
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

/** A section or box at most `scroll` rem high — what is more scrolls in it. */
const scrolls = (a: Record<string, string>): CSSProperties | undefined => (a.scroll ? { maxHeight: `${Number(a.scroll)}rem`, overflowY: "auto" } : undefined);
/** A template's colour: #hex as it is, a name as the chips' colours. */
const paint = (c: string | undefined) => (!c ? "#a1a1aa" : c.startsWith("#") ? c : (CHART_COLORS[c] ?? "#a1a1aa"));
const CHART_COLORS: Record<string, string> = { gray: "#a1a1aa", brown: "#a16207", orange: "#f97316", yellow: "#eab308", green: "#22c55e", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899", red: "#ef4444" };
const PALETTE = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7", "#ec4899", "#84cc16"];

/** A small chart of a template's data: bars, columns, a line or a pie. */
function MiniChart({ kind = "bar", data }: { kind?: string; data: { label: string; value: number; color?: string }[] }) {
  if (!data.length) return null;
  const colorOf = (d: { color?: string }, i: number) => (d.color ? (d.color.startsWith("#") ? d.color : (CHART_COLORS[d.color] ?? PALETTE[i % PALETTE.length])) : PALETTE[i % PALETTE.length]);
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

/** A <select search=true>: typed to find — the matching options under it (arrows, Enter, Esc); the first option with no value is its placeholder. */
function SearchSelect({ options, value, label, onPick }: { options: [string, string, string?][]; value: string; label?: string; onPick: (v: string) => void }) {
  const t = useT();
  const [query, setQuery] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const blank = options.find(([v]) => v === "");
  const real = options.filter(([v]) => v !== "");
  const current = real.find(([v]) => v === value);
  const q = (query ?? "").trim().toLowerCase();
  const found = query === null ? [] : real.filter(([, l]) => l.toLowerCase().includes(q)).slice(0, 8);
  const pick = (v: string) => {
    onPick(v);
    setQuery(null);
  };
  return (
    <div className="relative min-w-0 flex-1 print:hidden">
      <input
        className="input w-full py-1 text-sm"
        role="combobox"
        aria-expanded={found.length > 0}
        aria-autocomplete="list"
        aria-label={label ?? blank?.[1] ?? t("Search …")}
        placeholder={blank?.[1] ?? t("Search …")}
        value={query ?? current?.[1] ?? ""}
        onFocus={(e) => (setQuery(""), setHi(0), e.currentTarget.select())}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onChange={(e) => (setQuery(e.target.value), setHi(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(h + 1, found.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
          else if (e.key === "Enter" && found[hi]) (e.preventDefault(), pick(found[hi][0]), e.currentTarget.blur());
          else if (e.key === "Escape") (setQuery(null), e.currentTarget.blur());
        }}
      />
      {query !== null && (
        <ul role="listbox" className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {found.length ? (
            found.map(([v, l], i) => (
              <li key={v} role="option" aria-selected={i === hi}>
                <button type="button" className={`block w-full truncate px-3 py-1 text-left ${i === hi ? "bg-indigo-50 dark:bg-indigo-950/50" : ""}`} onMouseDown={(e) => (e.preventDefault(), pick(v))} onMouseEnter={() => setHi(i)}>
                  {l}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-1 text-zinc-500">{t("No match")}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** A section that folds: open or not — or "wide": open on a wide screen, folded on a phone (decided once it is shown). */
function Fold({ title, open, children }: { title: string; open: boolean | "wide"; children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(open !== false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the window's width is known only in the browser
    if (open === "wide" && window.matchMedia("(max-width: 639px)").matches) setOpen(false);
  }, [open]);
  return (
    <details open={isOpen} onToggle={(e) => setOpen(e.currentTarget.open)} className="group space-y-2">
      <summary className="cursor-pointer text-sm font-semibold select-none">{title}</summary>
      {children}
    </details>
  );
}

/** A box of a row's checklist in a view: ticks the item in the row's page itself (and the view shows it at once). */
function TaskBox({ rowId, index, checked, label, editable, done }: { rowId: number; index: number | undefined; checked: boolean; label: string; editable: boolean; done: () => void }) {
  // (Ticked here until the view brings the page's own state — then that.)
  const [on, setOn] = useState<{ was: boolean; v: boolean } | null>(null);
  const shown = on && on.was === checked ? on.v : checked;
  const tick = (next: boolean) => {
    if (index === undefined) return;
    setOn({ was: checked, v: next });
    void toggleTaskAction(rowId, index, next).then((r) => {
      if (!r.ok) {
        toast(r.error, { tone: "error" });
        return setOn(null);
      }
      window.dispatchEvent(new Event(WS_CHANGED));
      done();
    });
  };
  return (
    <input
      type="checkbox"
      className="mr-1.5 size-3.5 translate-y-0.5 accent-indigo-600"
      checked={shown}
      disabled={!editable || index === undefined}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => tick(e.target.checked)}
    />
  );
}
