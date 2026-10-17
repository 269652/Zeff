"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { blockChoicesAction, blockDataAction, blockPickAction, databasesAction, taskDoneAction } from "../actions";
import type { ChartResult, DocumentLine, EventLine, MetricResult, PersonLine, TaskLine } from "../blocks";
import { GripBar } from "./app-nodes";
import { BarChart, ColumnChart, LineChart, PieChart } from "./charts";
import { WS_CHANGED } from "./ChatPanel";

/**
 * The data blocks of a page (slash menu → "Data"): a figure, a chart, the next appointments, a list of todos, a document, people.
 * Each keeps only what to look at - a database, a view whose filter applies, a field, a calculation - and shows what Zeff holds
 * now: the numbers are read when the page is shown, again when the workspace changes, and never stored in the page.
 */

type Kind = "metric" | "chart" | "events" | "tasks" | "document" | "people";

/** A block's data: read when it appears and when what it looks at changes (`key`), again after the assistant changed the workspace. */
function useBlockData<T>(kind: Kind, spec: object, ready: boolean, key: string, every = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const specRef = useRef(spec);
  useEffect(() => {
    specRef.current = spec;
  });
  const load = useCallback(async () => {
    if (!ready) return;
    const mine = ++seq.current;
    const r = await blockDataAction(kind as never, specRef.current as never);
    if (mine !== seq.current) return;
    if (r.ok) {
      setData(r.data as T);
      setError("");
    } else setError(r.error);
  }, [kind, ready]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read when what the block looks at changes
    void load();
  }, [load, key]);
  useEffect(() => {
    window.addEventListener(WS_CHANGED, load);
    const timer = every ? setInterval(load, every) : undefined;
    return () => {
      window.removeEventListener(WS_CHANGED, load);
      if (timer) clearInterval(timer);
    };
  }, [load, every]);
  return { data, error, reload: load };
}

/** The databases to point a block at, and the views and fields of the one picked. */
function useDatabases(on: boolean) {
  const [list, setList] = useState<{ id: number; title: string }[]>([]);
  useEffect(() => {
    if (on) void databasesAction().then((r) => r.ok && setList(r.databases.map((d) => ({ id: d.id, title: d.title }))));
  }, [on]);
  return list;
}
function useChoices(dbId: number, on: boolean) {
  const [c, setC] = useState<{ views: { id: string; name: string }[]; properties: { id: string; name: string; type: string }[] } | null>(null);
  useEffect(() => {
    if (!on || !dbId) return;
    let live = true;
    void blockChoicesAction(dbId).then((r) => live && r.ok && setC({ views: r.views, properties: r.properties }));
    return () => {
      live = false;
    };
  }, [dbId, on]);
  return c;
}

/** The frame of a block: its grip while editing, a settings toggle, the content. */
function Shell({ nodeProps, label, open, setOpen, settings, children }: { nodeProps: NodeViewProps; label: string; open: boolean; setOpen: (o: boolean) => void; settings: React.ReactNode; children: React.ReactNode }) {
  const t = useT();
  const { editor, node, getPos, deleteNode } = nodeProps;
  return (
    <NodeViewWrapper className="ws-app-block ws-module-block my-2" contentEditable={false} data-app-block={label}>
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label={label} />
      {editor.isEditable && (
        <div className="mb-1">
          <button type="button" className="text-xs text-zinc-500 hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
            ⚙ {t("Settings")}
          </button>
          {open && <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{settings}</div>}
        </div>
      )}
      {children}
    </NodeViewWrapper>
  );
}

const sel = "input w-auto py-0.5 text-xs";
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <div className={`rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>{children}</div>;
const Note = ({ children }: { children: React.ReactNode }) => <p className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700">{children}</p>;

function nodeFactory(name: string, attrs: Record<string, unknown>, View: React.ComponentType<NodeViewProps>) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    addAttributes() {
      return Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { default: v }]));
    },
    parseHTML() {
      return [{ tag: `div[data-${name}]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { [`data-${name}`]: "" })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(View as never);
    },
  });
}

// ---------------------------------------------------------------------------
// A figure
// ---------------------------------------------------------------------------

function MetricView(p: NodeViewProps) {
  const t = useT();
  const { node, updateAttributes } = p;
  const dbId = Number(node.attrs.dbId) || 0;
  const viewId = String(node.attrs.viewId ?? "");
  const calc = String(node.attrs.calc ?? "count");
  const prop = String(node.attrs.prop ?? "");
  const label = String(node.attrs.label ?? "");
  const style = String(node.attrs.style ?? "number");
  const [open, setOpen] = useState(!dbId);
  const dbs = useDatabases(p.editor.isEditable);
  const c = useChoices(dbId, p.editor.isEditable);
  const needsProp = !["count", "share"].includes(calc);
  const { data, error } = useBlockData<MetricResult>("metric", { dbId, viewId: viewId || undefined, calc, prop: prop || undefined }, !!dbId && (!needsProp || !!prop), `${dbId}|${viewId}|${calc}|${prop}`, 60000);
  const pct = data ? (calc === "share" ? data.value : data.total ? (data.rows / data.total) * 100 : 0) : 0;
  return (
    <Shell
      nodeProps={p}
      label="figure"
      open={open}
      setOpen={setOpen}
      settings={
        <>
          <select className={sel} value={dbId || ""} onChange={(e) => updateAttributes({ dbId: Number(e.target.value) || null, viewId: "", prop: "" })} aria-label={t("Database")}>
            <option value="">{t("Pick a database …")}</option>
            {dbs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <select className={sel} value={viewId} onChange={(e) => updateAttributes({ viewId: e.target.value })} aria-label={t("Which rows (a view's filter)")}>
            <option value="">{t("All rows")}</option>
            {(c?.views ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {t("Filter of “{name}”", { name: v.name })}
              </option>
            ))}
          </select>
          <select className={sel} value={calc} onChange={(e) => updateAttributes({ calc: e.target.value })} aria-label={t("Calculate")}>
            <option value="count">{t("Number of rows")}</option>
            <option value="share">{t("Share of all rows (%)")}</option>
            <option value="sum">{t("Sum")}</option>
            <option value="avg">{t("Average")}</option>
            <option value="min">{t("Smallest")}</option>
            <option value="max">{t("Largest")}</option>
            <option value="unique">{t("Different values")}</option>
          </select>
          {needsProp && (
            <select className={sel} value={prop} onChange={(e) => updateAttributes({ prop: e.target.value })} aria-label={t("Field")}>
              <option value="">{t("Pick a field …")}</option>
              {(c?.properties ?? []).filter((x) => x.type !== "title").map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
          <input className="input w-36 py-0.5 text-xs" value={label} onChange={(e) => updateAttributes({ label: e.target.value })} placeholder={t("Label")} aria-label={t("Label")} />
          <select className={sel} value={style} onChange={(e) => updateAttributes({ style: e.target.value })} aria-label={t("Look")}>
            <option value="number">{t("Figure")}</option>
            <option value="progress">{t("With a progress bar")}</option>
          </select>
        </>
      }
    >
      {!dbId ? (
        <Note>{t("A figure from a database — pick which")}</Note>
      ) : error ? (
        <p className="alert-error text-sm">{error}</p>
      ) : (
        <Card className="inline-block min-w-52 max-w-full">
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label || (data ? `${data.database}${data.view ? ` · ${data.view}` : ""}` : "…")}</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">{data ? data.text : "…"}</p>
          {data && (
            <p className="mt-0.5 text-xs text-zinc-500">
              {calc === "count" || calc === "share" ? t("{n} of {total} rows", { n: data.rows, total: data.total }) : `${data.propName} · ${t("{n} rows", { n: data.rows })}`}
            </p>
          )}
          {style === "progress" && data && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            </div>
          )}
        </Card>
      )}
    </Shell>
  );
}

export const ZeffMetric = nodeFactory("zeffMetric", { dbId: null, viewId: "", calc: "count", prop: "", label: "", style: "number" }, MetricView);

// ---------------------------------------------------------------------------
// A chart
// ---------------------------------------------------------------------------

function ChartBlockView(p: NodeViewProps) {
  const t = useT();
  const { node, updateAttributes } = p;
  const dbId = Number(node.attrs.dbId) || 0;
  const viewId = String(node.attrs.viewId ?? "");
  const type = String(node.attrs.type ?? "bar");
  const groupBy = String(node.attrs.groupBy ?? "");
  const calc = String(node.attrs.calc ?? "count");
  const prop = String(node.attrs.prop ?? "");
  const bucket = String(node.attrs.bucket ?? "month");
  const limit = Number(node.attrs.limit) || 12;
  const title = String(node.attrs.title ?? "");
  const [open, setOpen] = useState(!dbId || !groupBy);
  const dbs = useDatabases(p.editor.isEditable);
  const c = useChoices(dbId, p.editor.isEditable);
  const group = c?.properties.find((x) => x.id === groupBy);
  const needsProp = calc !== "count";
  const { data, error } = useBlockData<ChartResult>("chart", { dbId, viewId: viewId || undefined, type, groupBy, calc, prop: prop || undefined, bucket, limit }, !!dbId && !!groupBy && (!needsProp || !!prop), `${dbId}|${viewId}|${type}|${groupBy}|${calc}|${prop}|${bucket}|${limit}`, 120000);
  const Chart = type === "pie" ? PieChart : type === "column" ? ColumnChart : type === "line" ? LineChart : BarChart;
  return (
    <Shell
      nodeProps={p}
      label="chart"
      open={open}
      setOpen={setOpen}
      settings={
        <>
          <select className={sel} value={dbId || ""} onChange={(e) => updateAttributes({ dbId: Number(e.target.value) || null, viewId: "", groupBy: "", prop: "" })} aria-label={t("Database")}>
            <option value="">{t("Pick a database …")}</option>
            {dbs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <select className={sel} value={viewId} onChange={(e) => updateAttributes({ viewId: e.target.value })} aria-label={t("Which rows (a view's filter)")}>
            <option value="">{t("All rows")}</option>
            {(c?.views ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {t("Filter of “{name}”", { name: v.name })}
              </option>
            ))}
          </select>
          <select className={sel} value={type} onChange={(e) => updateAttributes({ type: e.target.value })} aria-label={t("Chart")}>
            <option value="bar">{t("Bars")}</option>
            <option value="column">{t("Columns")}</option>
            <option value="line">{t("Line")}</option>
            <option value="pie">{t("Pie")}</option>
          </select>
          <select className={sel} value={groupBy} onChange={(e) => updateAttributes({ groupBy: e.target.value })} aria-label={t("Group by")}>
            <option value="">{t("Group by …")}</option>
            {(c?.properties ?? []).filter((x) => !["title", "rollup", "formula", "ai", "created_time", "updated_time"].includes(x.type)).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          {group?.type === "date" && (
            <select className={sel} value={bucket} onChange={(e) => updateAttributes({ bucket: e.target.value })} aria-label={t("By")}>
              <option value="day">{t("Day")}</option>
              <option value="week">{t("Week")}</option>
              <option value="month">{t("Month")}</option>
              <option value="year">{t("Year")}</option>
            </select>
          )}
          <select className={sel} value={calc} onChange={(e) => updateAttributes({ calc: e.target.value })} aria-label={t("Measure")}>
            <option value="count">{t("Number of rows")}</option>
            <option value="sum">{t("Sum")}</option>
            <option value="avg">{t("Average")}</option>
          </select>
          {needsProp && (
            <select className={sel} value={prop} onChange={(e) => updateAttributes({ prop: e.target.value })} aria-label={t("Field")}>
              <option value="">{t("Pick a field …")}</option>
              {(c?.properties ?? []).filter((x) => ["number", "rollup", "formula"].includes(x.type)).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
          <input className="input w-36 py-0.5 text-xs" value={title} onChange={(e) => updateAttributes({ title: e.target.value })} placeholder={t("Title")} aria-label={t("Title")} />
          <label className="flex items-center gap-1">
            {t("At most")}
            <input type="number" min={1} max={40} className="input w-16 py-0.5 text-xs" value={limit} onChange={(e) => updateAttributes({ limit: Number(e.target.value) || 12 })} />
          </label>
        </>
      }
    >
      {!dbId || !groupBy ? (
        <Note>{t("A chart from a database — pick which and what to group by")}</Note>
      ) : error ? (
        <p className="alert-error text-sm">{error}</p>
      ) : (
        <Card>
          <p className="mb-3 text-sm font-medium">
            {title || (data ? `${data.valueName} ${t("by")} ${data.groupName}` : "…")}
            {data && !title && <span className="ml-2 text-xs font-normal text-zinc-400">{data.database}</span>}
          </p>
          {!data ? <p className="text-sm text-zinc-400">…</p> : data.points.length ? <Chart points={data.points} unit={data.unit} /> : <p className="text-sm text-zinc-400">{t("Nothing to show — no rows match.")}</p>}
        </Card>
      )}
    </Shell>
  );
}

export const ZeffChart = nodeFactory("zeffChart", { dbId: null, viewId: "", type: "bar", groupBy: "", calc: "count", prop: "", bucket: "month", limit: 12, title: "" }, ChartBlockView);

// ---------------------------------------------------------------------------
// The next appointments
// ---------------------------------------------------------------------------

const clock = (s: string) => s.slice(11, 16);
const dayLabel = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(today.getTime() + 864e5);
  return same(d, today) ? "·today" : same(d, tomorrow) ? "·tomorrow" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
};

function EventsView(p: NodeViewProps) {
  const t = useT();
  const { node, updateAttributes } = p;
  const days = Number(node.attrs.days) || 7;
  const q = String(node.attrs.q ?? "");
  const calendar = String(node.attrs.calendar ?? "");
  const limit = Number(node.attrs.limit) || 8;
  const title = String(node.attrs.title ?? "");
  const [open, setOpen] = useState(false);
  const { data, error } = useBlockData<{ events: EventLine[]; href: string | null }>("events", { days, q: q || undefined, calendar: calendar || undefined, limit }, true, `${days}|${q}|${calendar}|${limit}`, 60000);
  const groups = new Map<string, EventLine[]>();
  for (const e of data?.events ?? []) groups.set(e.day, [...(groups.get(e.day) ?? []), e]);
  return (
    <Shell
      nodeProps={p}
      label="appointments"
      open={open}
      setOpen={setOpen}
      settings={
        <>
          <label className="flex items-center gap-1">
            {t("Next")}
            <input type="number" min={1} max={120} className="input w-16 py-0.5 text-xs" value={days} onChange={(e) => updateAttributes({ days: Number(e.target.value) || 7 })} />
            {t("days")}
          </label>
          <input className="input w-40 py-0.5 text-xs" value={q} onChange={(e) => updateAttributes({ q: e.target.value })} placeholder={t("Only with the words …")} aria-label={t("Words")} />
          <input className="input w-32 py-0.5 text-xs" value={calendar} onChange={(e) => updateAttributes({ calendar: e.target.value })} placeholder={t("Calendar (name)")} aria-label={t("Calendar")} />
          <label className="flex items-center gap-1">
            {t("At most")}
            <input type="number" min={1} max={50} className="input w-16 py-0.5 text-xs" value={limit} onChange={(e) => updateAttributes({ limit: Number(e.target.value) || 8 })} />
          </label>
          <input className="input w-36 py-0.5 text-xs" value={title} onChange={(e) => updateAttributes({ title: e.target.value })} placeholder={t("Title")} aria-label={t("Title")} />
        </>
      }
    >
      {error ? (
        <p className="alert-error text-sm">{error}</p>
      ) : (
        <Card>
          <div className="mb-2 flex items-baseline gap-2">
            <p className="text-sm font-medium">📅 {title || t("Next appointments")}</p>
            {data?.href && (
              <Link href={data.href} className="ml-auto text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                {t("Open the calendar")}
              </Link>
            )}
          </div>
          {!data ? (
            <p className="text-sm text-zinc-400">…</p>
          ) : !data.events.length ? (
            <p className="text-sm text-zinc-400">{t("Nothing coming up.")}</p>
          ) : (
            <div className="space-y-2">
              {[...groups.entries()].map(([day, list]) => (
                <div key={day} className="grid grid-cols-[5.5rem_1fr] gap-2">
                  <p className="pt-0.5 text-xs font-semibold text-zinc-500">{dayLabel(day) === "·today" ? t("Today") : dayLabel(day) === "·tomorrow" ? t("Tomorrow") : dayLabel(day)}</p>
                  <ul className="space-y-1">
                    {list.map((e) => (
                      <li key={e.id} className="flex items-baseline gap-2 text-sm">
                        <span className="mt-1 size-2 shrink-0 self-start rounded-full" style={{ background: e.color }} />
                        <span className="w-24 shrink-0 text-xs text-zinc-500 tabular-nums">{e.allDay ? t("all day") : `${clock(e.start)}–${clock(e.end)}`}</span>
                        <span className="min-w-0 flex-1 truncate" title={e.title}>
                          {e.title}
                        </span>
                        {e.location && <span className="hidden max-w-40 truncate text-xs text-zinc-400 sm:block">{e.location}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </Shell>
  );
}

export const ZeffEvents = nodeFactory("zeffEvents", { days: 7, q: "", calendar: "", limit: 8, title: "" }, EventsView);

// ---------------------------------------------------------------------------
// A list of todos
// ---------------------------------------------------------------------------

function TasksView(p: NodeViewProps) {
  const t = useT();
  const { node, updateAttributes } = p;
  const q = String(node.attrs.q ?? "");
  const ticket = String(node.attrs.ticket ?? "");
  const status = String(node.attrs.status ?? "open");
  const limit = Number(node.attrs.limit) || 10;
  const title = String(node.attrs.title ?? "");
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<Record<number, boolean>>({});
  const { data, error, reload } = useBlockData<{ tasks: TaskLine[]; total: number }>("tasks", { q: q || undefined, ticket: ticket || undefined, status, limit }, true, `${q}|${ticket}|${status}|${limit}`, 60000);
  const tick = async (id: number, done: boolean) => {
    setLocal((cur) => ({ ...cur, [id]: done }));
    const r = await taskDoneAction(id, done);
    if (!r.ok) {
      toast(r.error, { tone: "error" });
      setLocal((cur) => ({ ...cur, [id]: !done }));
    } else setTimeout(() => void reload().then(() => setLocal({})), 400);
  };
  return (
    <Shell
      nodeProps={p}
      label="todos"
      open={open}
      setOpen={setOpen}
      settings={
        <>
          <input className="input w-28 py-0.5 text-xs" value={ticket} onChange={(e) => updateAttributes({ ticket: e.target.value })} placeholder={t("Ticket (PROJ-1)")} aria-label={t("Ticket")} />
          <input className="input w-40 py-0.5 text-xs" value={q} onChange={(e) => updateAttributes({ q: e.target.value })} placeholder={t("Only with the words …")} aria-label={t("Words")} />
          <select className={sel} value={status} onChange={(e) => updateAttributes({ status: e.target.value })} aria-label={t("Which")}>
            <option value="open">{t("Open")}</option>
            <option value="done">{t("Done")}</option>
            <option value="all">{t("All")}</option>
          </select>
          <label className="flex items-center gap-1">
            {t("At most")}
            <input type="number" min={1} max={60} className="input w-16 py-0.5 text-xs" value={limit} onChange={(e) => updateAttributes({ limit: Number(e.target.value) || 10 })} />
          </label>
          <input className="input w-36 py-0.5 text-xs" value={title} onChange={(e) => updateAttributes({ title: e.target.value })} placeholder={t("Title")} aria-label={t("Title")} />
        </>
      }
    >
      {error ? (
        <p className="alert-error text-sm">{error}</p>
      ) : (
        <Card>
          <p className="mb-2 text-sm font-medium">
            ☑ {title || t("Todos")}
            {data && <span className="ml-2 text-xs font-normal text-zinc-400">{data.total > data.tasks.length ? t("{n} of {total}", { n: data.tasks.length, total: data.total }) : data.total}</span>}
          </p>
          {!data ? (
            <p className="text-sm text-zinc-400">…</p>
          ) : !data.tasks.length ? (
            <p className="text-sm text-zinc-400">{t("Nothing here.")}</p>
          ) : (
            <ul className="space-y-1">
              {data.tasks.map((x) => {
                const done = local[x.id] ?? x.done;
                return (
                  <li key={x.id} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1 size-4 shrink-0 accent-indigo-600" checked={done} onChange={(e) => void tick(x.id, e.target.checked)} aria-label={x.text} />
                    <span className={`min-w-0 flex-1 ${done ? "text-zinc-400 line-through" : ""}`}>
                      <Link href={`/todos#todo-${x.id}`} className="hover:underline">
                        {x.text}
                      </Link>
                    </span>
                    {x.ticket && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-xs text-zinc-500 dark:bg-zinc-800">{x.ticket}</span>}
                    {x.due && <span className="shrink-0 text-xs text-zinc-400">{x.due}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </Shell>
  );
}

export const ZeffTasks = nodeFactory("zeffTasks", { q: "", ticket: "", status: "open", limit: 10, title: "" }, TasksView);

// ---------------------------------------------------------------------------
// A document
// ---------------------------------------------------------------------------

const KIND_ICON: Record<string, string> = { pdf: "📕", office: "📘", text: "📄", image: "🖼️", audio: "🎧", other: "📎" };
const sizeText = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** A search box over a list of things to pick (documents, people). */
function Picker({ kind, onPick }: { kind: "document" | "person"; onPick: (id: number) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<{ id: number; label: string }[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => void blockPickAction(kind, q).then((r) => r.ok && setItems(r.items)), 200);
    return () => clearTimeout(timer);
  }, [kind, q]);
  return (
    <div className="w-full space-y-1">
      <input className="input py-0.5 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "document" ? t("Search documents …") : t("Search people …")} aria-label={t("Search")} />
      <ul className="max-h-40 overflow-y-auto">
        {items.map((i) => (
          <li key={i.id}>
            <button type="button" className="w-full truncate rounded px-1.5 py-0.5 text-left text-xs hover:bg-zinc-200 dark:hover:bg-zinc-800" onClick={() => onPick(i.id)}>
              {i.label}
            </button>
          </li>
        ))}
        {!items.length && <li className="px-1.5 text-xs text-zinc-400">{t("Nothing found")}</li>}
      </ul>
    </div>
  );
}

function DocumentView(p: NodeViewProps) {
  const t = useT();
  const { node, updateAttributes } = p;
  const docId = Number(node.attrs.docId) || 0;
  const [open, setOpen] = useState(!docId);
  const { data, error } = useBlockData<DocumentLine>("document", { docId }, !!docId, String(docId));
  return (
    <Shell nodeProps={p} label="document" open={open} setOpen={setOpen} settings={<Picker kind="document" onPick={(id) => (updateAttributes({ docId: id }), setOpen(false))} />}>
      {!docId ? (
        <Note>{t("A document from Documents — pick which")}</Note>
      ) : error ? (
        <p className="alert-error text-sm">{error}</p>
      ) : !data ? (
        <p className="text-sm text-zinc-400">…</p>
      ) : (
        <Card className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <div className="aspect-[4/3] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
            {data.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- a stored file of the documents folder
              <img src={`/api/documents/${data.id}/file`} alt="" className="size-full object-contain" />
            ) : data.kind === "pdf" ? (
              <iframe src={`/api/documents/${data.id}/file#toolbar=0`} title={data.name} className="size-full bg-white" />
            ) : (
              <div className="flex size-full items-center justify-center text-6xl">{KIND_ICON[data.kind] ?? "📎"}</div>
            )}
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-semibold break-words">
              {data.name} {data.unread && <span className="ml-1 rounded-full bg-indigo-600 px-1.5 text-[11px] font-normal text-white">{t("Unread")}</span>}
            </p>
            <p className="text-xs text-zinc-500">
              {sizeText(data.size)} · {new Date(data.addedAt).toLocaleDateString()}
              {data.from ? ` · ✉ ${data.from}` : ""}
            </p>
            {data.abstract && <p className="line-clamp-5 text-sm text-zinc-700 dark:text-zinc-300">{data.abstract}</p>}
            {data.concepts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {data.concepts.slice(0, 8).map((c) => (
                  <span key={c} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                    {c}
                  </span>
                ))}
              </div>
            )}
            <a href={`/api/documents/${data.id}/file?open=1`} target="_blank" rel="noreferrer" className="btn btn-sm inline-flex">
              {t("Open")}
            </a>
          </div>
        </Card>
      )}
    </Shell>
  );
}

export const ZeffDocument = nodeFactory("zeffDocument", { docId: null }, DocumentView);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function PeopleView(p: NodeViewProps) {
  const t = useT();
  const { node, updateAttributes } = p;
  const ids = (Array.isArray(node.attrs.ids) ? (node.attrs.ids as unknown[]) : []).map(Number).filter((n) => n > 0);
  const q = String(node.attrs.q ?? "");
  const limit = Number(node.attrs.limit) || 8;
  const title = String(node.attrs.title ?? "");
  const [open, setOpen] = useState(!ids.length && !q);
  const { data, error } = useBlockData<PersonLine[]>("people", { ids, q: q || undefined, limit }, true, `${ids.join(",")}|${q}|${limit}`, 120000);
  return (
    <Shell
      nodeProps={p}
      label="people"
      open={open}
      setOpen={setOpen}
      settings={
        <>
          <div className="w-full space-y-1">
            <p>{t("Pick people — or leave empty for your starred ones, or search by name:")}</p>
            <div className="flex flex-wrap gap-1">
              {ids.map((id) => (
                <button key={id} type="button" className="rounded-full bg-zinc-200 px-2 py-0.5 dark:bg-zinc-700" onClick={() => updateAttributes({ ids: ids.filter((x) => x !== id) })} title={t("Remove")}>
                  {data?.find((x) => x.id === id)?.name ?? `#${id}`} ✕
                </button>
              ))}
            </div>
            <Picker kind="person" onPick={(id) => updateAttributes({ ids: [...new Set([...ids, id])] })} />
          </div>
          <input className="input w-40 py-0.5 text-xs" value={q} onChange={(e) => updateAttributes({ q: e.target.value })} placeholder={t("Name contains …")} aria-label={t("Name")} />
          <input className="input w-36 py-0.5 text-xs" value={title} onChange={(e) => updateAttributes({ title: e.target.value })} placeholder={t("Title")} aria-label={t("Title")} />
        </>
      }
    >
      {error ? (
        <p className="alert-error text-sm">{error}</p>
      ) : (
        <div>
          {title && <p className="mb-2 text-sm font-medium">👥 {title}</p>}
          {!data ? (
            <p className="text-sm text-zinc-400">…</p>
          ) : !data.length ? (
            <Note>{t("No people match — star some in People, or pick them here.")}</Note>
          ) : (
            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
              {data.map((x) => (
                <li key={x.id}>
                  <Link href={x.href} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 transition hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" aria-hidden>
                      {x.name
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase())
                        .join("")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {x.starred && "★ "}
                        {x.name}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">{x.next ? `${x.next.on}${x.next.kind ? ` · ${x.next.kind}` : ""}` : x.emails[0] ?? ""}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Shell>
  );
}

export const ZeffPeople = nodeFactory("zeffPeople", { ids: [], q: "", limit: 8, title: "" }, PeopleView);

export const DATA_BLOCKS = [ZeffMetric, ZeffChart, ZeffEvents, ZeffTasks, ZeffDocument, ZeffPeople];
